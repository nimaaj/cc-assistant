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
    expect(String((proposed.run.metadata.args as string[])[1])).toContain('Payload JSON: "Migration finished."');
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
});
