import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DaemonConfig } from "./config.js";
import { ClaudeSessionControlService, type ClaudeCliRunner } from "./claude-session-control-service.js";
import { ExecutionRepository } from "./execution-repository.js";
import { ExecutionService } from "./execution-service.js";
import { TaskRepository } from "./task-repository.js";

const databases: string[] = [];

afterEach(() => {
  for (const path of databases.splice(0)) {
    rmSync(path, { force: true });
    rmSync(`${path}-shm`, { force: true });
    rmSync(`${path}-wal`, { force: true });
  }
});

function setup(runner: ClaudeCliRunner) {
  const databasePath = join(tmpdir(), `cc-assistant-claude-control-${randomUUID()}.sqlite`);
  databases.push(databasePath);
  new TaskRepository(databasePath).close();
  const repository = new ExecutionRepository(databasePath);
  const config: DaemonConfig = {
    host: "127.0.0.1", port: 4317, dataDir: tmpdir(), databasePath,
    accessToken: "test-token-with-at-least-thirty-two-characters", accessTokenPath: "unused",
    allowedRoots: [tmpdir()],
  };
  return { repository, service: new ClaudeSessionControlService(new ExecutionService(repository, config), config, runner) };
}

const inventory = [{
  id: "abc12345", cwd: "/tmp/project", kind: "background", startedAt: 1_789_000_000_000,
  sessionId: "abc12345-0000-4000-8000-000000000000", name: "api-worker",
  state: "working", pid: 4242, status: "busy",
}];

describe("Claude session control service", () => {
  it("reads and normalizes the supported Claude Code JSON inventory", async () => {
    const calls: string[][] = [];
    const runner: ClaudeCliRunner = async (args) => { calls.push(args); return { stdout: JSON.stringify(inventory), stderr: "" }; };
    const { repository, service } = setup(runner);

    expect(await service.list(true)).toEqual([expect.objectContaining({
      id: "abc12345", name: "api-worker", waitingFor: null, status: "busy",
    })]);
    expect(calls).toEqual([["agents", "--json", "--all"]]);
    repository.close();
  });

  it("creates an approval-backed, tool-limited cross-session delivery run", async () => {
    const runner: ClaudeCliRunner = async () => ({ stdout: JSON.stringify(inventory), stderr: "" });
    const { repository, service } = setup(runner);
    const proposed = await service.propose({ action: "message", target: "api-worker", message: "Migration finished." });

    expect(proposed.run).toMatchObject({ kind: "command", status: "waiting_approval" });
    expect(proposed.approval).toMatchObject({
      actionType: "claude_session_control",
      payload: { action: "message", message: "Migration finished." },
    });
    expect(proposed.run.metadata.args).toEqual(expect.arrayContaining(["ListAgents", "SendMessage"]));
    expect(proposed.run.metadata.args).toEqual(expect.arrayContaining(["--max-turns", "5"]));
    expect(proposed.run.metadata.resultProtocol).toBe("claude_delivery_v1");
    const prompt = String((proposed.run.metadata.args as string[])[1]);
    expect(prompt).toContain('Payload JSON: "Migration finished."');
    expect(prompt).toContain("<cc_assistant_delivery_result>");
    expect(prompt).toContain("ListAgents peer refs and inventory session IDs use different namespaces");
    expect(prompt).not.toContain("Expected target session ID JSON");
    repository.close();
  });

  it("routes dispatcher input to the newest live main controller with a structured envelope", async () => {
    const controllerInventory = [
      { ...inventory[0], id: "old11111", sessionId: "old11111-0000-4000-8000-000000000000", name: "cc-assistant-controller", startedAt: 10 },
      { ...inventory[0], id: "new22222", sessionId: "new22222-0000-4000-8000-000000000000", name: "cc-assistant-controller-new22222", startedAt: 20 },
    ];
    const runner: ClaudeCliRunner = async () => ({ stdout: JSON.stringify(controllerInventory), stderr: "" });
    const { repository, service } = setup(runner);
    const proposed = await service.proposeDispatcher({
      input: "Remember the Linux version and environment here.",
      source: "web",
      context: {},
    });

    expect(proposed.target.id).toBe("new22222");
    expect(proposed.approval).toMatchObject({
      actionType: "claude_session_control",
      payload: {
        dispatcher: {
          source: "web",
          request: "Remember the Linux version and environment here.",
        },
      },
    });
    const envelope = String((proposed.approval.payload as { message: unknown }).message);
    expect(envelope).toContain("CC_ASSISTANT_DISPATCH_V1");
    expect(envelope).toContain("Remember the Linux version and environment here.");
    const envelopeJson = JSON.parse(envelope.split("\n").at(-1)!) as {
      origin: { prompt: string; parent: { itemType: string; itemId: string }; createdBy: { itemType: string; itemId: string } };
    };
    expect(envelopeJson.origin).toEqual({
      prompt: "Remember the Linux version and environment here.",
      parent: { itemType: "run", itemId: proposed.run.id },
      createdBy: { itemType: "claude_session", itemId: "new22222-0000-4000-8000-000000000000" },
    });
    expect(proposed.run.prompt).toBe("Remember the Linux version and environment here.");
    repository.close();
  });

  it("rejects dispatcher delivery when every live main controller has an ambiguous name", async () => {
    const controllerInventory = [
      { ...inventory[0], id: "old11111", sessionId: "old11111-0000-4000-8000-000000000000", name: "cc-assistant-controller", startedAt: 10 },
      { ...inventory[0], id: "new22222", sessionId: "new22222-0000-4000-8000-000000000000", name: "cc-assistant-controller", startedAt: 20 },
    ];
    const runner: ClaudeCliRunner = async () => ({ stdout: JSON.stringify(controllerInventory), stderr: "" });
    const { repository, service } = setup(runner);

    await expect(service.proposeDispatcher({ input: "Report status", source: "web", context: {} }))
      .rejects.toThrow("ambiguous names");
    expect(repository.listRuns()).toHaveLength(0);
    repository.close();
  });

  it("targets lifecycle commands by the resolved background short ID", async () => {
    const runner: ClaudeCliRunner = async () => ({ stdout: JSON.stringify(inventory), stderr: "" });
    const { repository, service } = setup(runner);
    const proposed = await service.propose({ action: "stop", target: "api-worker" });
    expect(proposed.run.metadata).toMatchObject({
      executable: "claude", args: ["stop", "abc12345"], sessionControlAction: "stop",
    });
    repository.close();
  });

  it("dispatches the requested Claude permission mode explicitly", async () => {
    const runner: ClaudeCliRunner = async () => ({ stdout: JSON.stringify(inventory), stderr: "" });
    const { repository, service } = setup(runner);
    const proposed = await service.propose({
      action: "dispatch", cwd: "/tmp", prompt: "Continue the controller work.",
      name: "cc-assistant-controller", permissionMode: "bypassPermissions",
    });
    expect(proposed.run.metadata.args).toEqual([
      "--bg", "--name", "cc-assistant-controller", "--permission-mode", "bypassPermissions",
      "Continue the controller work.",
    ]);
    repository.close();
  });
});
