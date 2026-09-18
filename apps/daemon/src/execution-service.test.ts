import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { PermissionResult, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, it } from "vitest";
import type { DaemonConfig } from "./config.js";
import { ExecutionRepository } from "./execution-repository.js";
import { ExecutionService, type AgentQuery } from "./execution-service.js";
import { TaskRepository } from "./task-repository.js";

const paths: string[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const path of paths.splice(0)) {
    rmSync(path, { force: true });
    rmSync(`${path}-shm`, { force: true });
    rmSync(`${path}-wal`, { force: true });
  }
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

async function until(check: () => boolean, message: string, attempts = 100): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
}

describe("execution service", () => {
  it("parks a managed Claude tool request until its approval is resolved", async () => {
    const databasePath = join(tmpdir(), `cc-assistant-execution-${randomUUID()}.sqlite`);
    paths.push(databasePath);
    new TaskRepository(databasePath).close();
    const repository = new ExecutionRepository(databasePath);
    let permissionResult: PermissionResult | null | undefined;
    let capturedOptions: Parameters<AgentQuery>[0]["options"];
    const fakeQuery: AgentQuery = (params) => {
      capturedOptions = params.options;
      const iterator = (async function* (): AsyncGenerator<SDKMessage> {
        yield { type: "system", subtype: "init", session_id: "fake-session" } as SDKMessage;
        const callback = params.options?.canUseTool;
        if (!callback) throw new Error("Expected permission callback");
        permissionResult = await callback("Write", { file_path: "/tmp/example.txt" }, {
          signal: new AbortController().signal,
          title: "Write /tmp/example.txt",
          toolUseID: "tool-1",
          requestId: "request-1",
        });
        yield {
          type: "result", subtype: "success", is_error: false, session_id: "fake-session",
          result: "Finished", total_cost_usd: 0.01, num_turns: 1,
        } as SDKMessage;
      })();
      return Object.assign(iterator, { close() {} });
    };
    const config: DaemonConfig = {
      host: "127.0.0.1", port: 4317, dataDir: tmpdir(), databasePath,
      accessToken: "test-token-with-at-least-thirty-two-characters", accessTokenPath: "unused",
      allowedRoots: [tmpdir()],
    };
    const service = new ExecutionService(repository, config, fakeQuery);
    const run = service.startAgent({ title: "Fake agent", prompt: "Do a thing", cwd: tmpdir() });

    await until(() => repository.listApprovals("pending").length === 1, "Approval was not created");
    expect(repository.getRun(run.id)?.status).toBe("waiting_approval");
    const approval = repository.listApprovals("pending")[0];
    if (!approval) throw new Error("Expected pending approval");
    service.resolveApproval(approval.id, { decision: "approved" });

    await until(() => repository.getRun(run.id)?.status === "succeeded", "Agent did not finish");
    expect(permissionResult).toMatchObject({ behavior: "allow", toolUseID: "tool-1" });
    expect(capturedOptions?.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(repository.getRun(run.id)).toMatchObject({ sessionId: "fake-session", result: "Finished" });
    repository.close();
  });

  it("expires an unstarted command approval when the run is cancelled", () => {
    const databasePath = join(tmpdir(), `cc-assistant-execution-${randomUUID()}.sqlite`);
    paths.push(databasePath);
    new TaskRepository(databasePath).close();
    const repository = new ExecutionRepository(databasePath);
    const config: DaemonConfig = {
      host: "127.0.0.1", port: 4317, dataDir: tmpdir(), databasePath,
      accessToken: "test-token-with-at-least-thirty-two-characters", accessTokenPath: "unused",
      allowedRoots: [tmpdir()],
    };
    const service = new ExecutionService(repository, config);
    expect(() => service.proposeCommand({
      title: "Path override", executable: "node", args: [], cwd: tmpdir(), env: { PATH: "/tmp/malicious" },
    })).toThrow("execution-control environment variables are not accepted");
    expect(() => service.proposeCommand({
      title: "Secret", executable: "node", args: [], cwd: tmpdir(), env: { API_TOKEN: "secret" },
    })).toThrow("Secret-like or execution-control environment variables are not accepted");
    expect(() => service.proposeCommand({
      title: "Escaped root", executable: "node", args: [], cwd: "/",
    })).toThrow("outside allowed roots");
    const proposed = service.proposeCommand({
      title: "Never run", executable: process.execPath, args: ["-e", "process.exit(0)"], cwd: tmpdir(),
    });

    expect(service.cancel(proposed.run.id).status).toBe("cancelled");
    expect(repository.getApproval(proposed.approval.id)).toMatchObject({
      status: "expired", resolutionNote: "Run cancelled by the user",
    });
    repository.close();
  });

  it("terminates and fails commands that exceed their timeout", async () => {
    const databasePath = join(tmpdir(), `cc-assistant-execution-${randomUUID()}.sqlite`);
    paths.push(databasePath);
    new TaskRepository(databasePath).close();
    const repository = new ExecutionRepository(databasePath);
    const config: DaemonConfig = {
      host: "127.0.0.1", port: 4317, dataDir: tmpdir(), databasePath,
      accessToken: "test-token-with-at-least-thirty-two-characters", accessTokenPath: "unused",
      allowedRoots: [tmpdir()],
    };
    const service = new ExecutionService(repository, config);
    const proposed = service.proposeCommand({
      title: "Timeout", executable: process.execPath,
      args: ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], cwd: tmpdir(), timeoutMs: 100,
    });
    service.resolveApproval(proposed.approval.id, { decision: "approved" });

    await until(() => repository.getRun(proposed.run.id)?.status === "failed", "Timed-out command did not fail", 600);
    expect(repository.getRun(proposed.run.id)?.error).toContain("timed out after 100ms");
    repository.close();
  });

  it("fails interrupted agent runs and expires their approvals after restart", () => {
    const databasePath = join(tmpdir(), `cc-assistant-execution-${randomUUID()}.sqlite`);
    paths.push(databasePath);
    new TaskRepository(databasePath).close();
    let repository = new ExecutionRepository(databasePath);
    const run = repository.createRun({ kind: "agent", status: "waiting_approval", title: "Interrupted", cwd: tmpdir() });
    const approval = repository.createApproval({ runId: run.id, actionType: "claude_tool", summary: "Write file", payload: {} });
    repository.close();

    repository = new ExecutionRepository(databasePath);
    expect(repository.getRun(run.id)).toMatchObject({ status: "failed", error: "Daemon restarted before the run completed" });
    expect(repository.getApproval(approval.id)).toMatchObject({ status: "expired" });
    repository.close();
  });

  it("fails an approved command interrupted before launch but preserves pending command approval", () => {
    const databasePath = join(tmpdir(), `cc-assistant-command-restart-${randomUUID()}.sqlite`);
    paths.push(databasePath);
    new TaskRepository(databasePath).close();
    let repository = new ExecutionRepository(databasePath);
    const interrupted = repository.createRun({ kind: "command", status: "waiting_approval", title: "Interrupted approved command", cwd: tmpdir() });
    const approved = repository.createApproval({ runId: interrupted.id, actionType: "run_command", summary: "Run it", payload: {} });
    repository.resolveApproval(approved.id, "approved");
    const pendingRun = repository.createRun({ kind: "command", status: "waiting_approval", title: "Still awaiting user", cwd: tmpdir() });
    const pending = repository.createApproval({ runId: pendingRun.id, actionType: "run_command", summary: "Wait", payload: {} });
    repository.close();

    repository = new ExecutionRepository(databasePath);
    expect(repository.getRun(interrupted.id)).toMatchObject({
      status: "failed", error: "Approved command was interrupted before execution began",
    });
    expect(repository.getRun(pendingRun.id)?.status).toBe("waiting_approval");
    expect(repository.getApproval(pending.id)?.status).toBe("pending");
    repository.close();
  });

  it("creates an isolated git worktree for a managed run", async () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), "cc-assistant-agent-repo-"));
    const dataDir = mkdtempSync(join(tmpdir(), "cc-assistant-agent-data-"));
    directories.push(repositoryRoot, dataDir);
    for (const args of [
      ["init"], ["config", "user.email", "cc-assistant@example.invalid"],
      ["config", "user.name", "CC Assistant Test"],
    ]) {
      expect(spawnSync("git", args, { cwd: repositoryRoot }).status).toBe(0);
    }
    writeFileSync(join(repositoryRoot, "README.md"), "fixture\n");
    expect(spawnSync("git", ["add", "README.md"], { cwd: repositoryRoot }).status).toBe(0);
    expect(spawnSync("git", ["commit", "-m", "fixture"], { cwd: repositoryRoot }).status).toBe(0);

    const databasePath = join(dataDir, "assistant.sqlite");
    new TaskRepository(databasePath).close();
    const repository = new ExecutionRepository(databasePath);
    let queryCwd: string | undefined;
    const fakeQuery: AgentQuery = (params) => {
      queryCwd = params.options?.cwd;
      const iterator = (async function* (): AsyncGenerator<SDKMessage> {
        yield {
          type: "result", subtype: "success", is_error: false, session_id: "worktree-session",
          result: "Finished in worktree", total_cost_usd: 0.01, num_turns: 1,
        } as SDKMessage;
      })();
      return Object.assign(iterator, { close() {} });
    };
    const config: DaemonConfig = {
      host: "127.0.0.1", port: 4317, dataDir, databasePath,
      accessToken: "test-token-with-at-least-thirty-two-characters", accessTokenPath: "unused",
      allowedRoots: [repositoryRoot],
    };
    const service = new ExecutionService(repository, config, fakeQuery);
    const run = service.startAgent({
      title: "Worktree test", prompt: "Do nothing", cwd: repositoryRoot, useWorktree: true,
    });

    await until(() => repository.getRun(run.id)?.status === "succeeded", "Worktree agent did not finish", 500);
    const finished = repository.getRun(run.id);
    expect(queryCwd).toBe(join(dataDir, "worktrees", run.id));
    expect(finished?.cwd).toBe(queryCwd);
    expect(finished?.metadata).toMatchObject({
      worktreePath: queryCwd,
      worktreeBranch: `cc-assistant/${run.id.slice(0, 8)}`,
    });
    expect(spawnSync("git", ["branch", "--show-current"], { cwd: queryCwd }).stdout.toString().trim())
      .toBe(`cc-assistant/${run.id.slice(0, 8)}`);

    service.shutdown();
    repository.close();
  });

  it("fails a managed run when the SDK stream ends without a terminal result", async () => {
    const databasePath = join(tmpdir(), `cc-assistant-agent-no-result-${randomUUID()}.sqlite`);
    paths.push(databasePath);
    new TaskRepository(databasePath).close();
    const repository = new ExecutionRepository(databasePath);
    const fakeQuery: AgentQuery = () => {
      const iterator = (async function* (): AsyncGenerator<SDKMessage> {
        yield { type: "system", subtype: "init", session_id: "no-result-session" } as SDKMessage;
      })();
      return Object.assign(iterator, { close() {} });
    };
    const config: DaemonConfig = {
      host: "127.0.0.1", port: 4317, dataDir: tmpdir(), databasePath,
      accessToken: "test-token-with-at-least-thirty-two-characters", accessTokenPath: "unused",
      allowedRoots: [tmpdir()],
    };
    const service = new ExecutionService(repository, config, fakeQuery);
    const run = service.startAgent({ title: "No result", prompt: "End unexpectedly", cwd: tmpdir() });

    await until(() => repository.getRun(run.id)?.status === "failed", "Run without result did not fail");
    expect(repository.getRun(run.id)).toMatchObject({
      status: "failed", error: "Claude run ended without a terminal result", sessionId: "no-result-session",
    });
    repository.close();
  });
});
