import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PermissionResult, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { AssistantRepository } from "./assistant-repository.js";
import { BrowserAutomationService, type BrowserAgentQuery } from "./browser-automation-service.js";
import type { DaemonConfig } from "./config.js";
import { ExecutionRepository } from "./execution-repository.js";
import { TaskRepository } from "./task-repository.js";

const paths: string[] = [];

afterEach(() => {
  for (const path of paths.splice(0)) {
    rmSync(path, { force: true });
    rmSync(`${path}-shm`, { force: true });
    rmSync(`${path}-wal`, { force: true });
  }
});

async function until(check: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
}

describe("Claude-in-Chrome browser automation", () => {
  it("executes queued jobs with only Claude in Chrome tools and structured output", async () => {
    const databasePath = join(tmpdir(), `cc-assistant-browser-${randomUUID()}.sqlite`);
    paths.push(databasePath);
    new TaskRepository(databasePath).close();
    const assistantRepository = new AssistantRepository(databasePath);
    const executionRepository = new ExecutionRepository(databasePath);
    let chromePermission: PermissionResult | null | undefined;
    let deniedPermission: PermissionResult | null | undefined;
    let capturedOptions: Parameters<BrowserAgentQuery>[0]["options"];
    const fakeQuery: BrowserAgentQuery = (params) => {
      capturedOptions = params.options;
      const iterator = (async function* (): AsyncGenerator<SDKMessage> {
        const canUseTool = params.options?.canUseTool;
        if (!canUseTool) throw new Error("Expected a browser permission callback");
        const context = { signal: new AbortController().signal, toolUseID: "tool-1", requestId: "request-1" };
        chromePermission = await canUseTool("mcp__claude-in-chrome__computer", { action: "snapshot" }, context);
        deniedPermission = await canUseTool("Bash", { command: "echo unsafe" }, { ...context, toolUseID: "tool-2", requestId: "request-2" });
        yield {
          type: "result", subtype: "success", is_error: false, session_id: "browser-session",
          result: "done", structured_output: {
            ok: true, summary: "Found two unread channels", data: { unreads: ["general", "project"] },
          }, total_cost_usd: 0.02, num_turns: 2,
        } as SDKMessage;
      })();
      return Object.assign(iterator, { close() {} });
    };
    const config: DaemonConfig = {
      host: "127.0.0.1", port: 4317, dataDir: tmpdir(), databasePath,
      accessToken: "test-token-with-at-least-thirty-two-characters", accessTokenPath: "unused",
      allowedRoots: [tmpdir()],
      browser: { enabled: true, useClaudeLogin: true, model: "sonnet", effort: "low", maxTurns: 7, maxBudgetUsd: 0.25 },
    };
    const service = new BrowserAutomationService(assistantRepository, executionRepository, config, fakeQuery);
    const job = assistantRepository.createBrowserJob("slack", "list_unreads", {});
    service.start();
    service.submit(job.id);

    await until(() => assistantRepository.getBrowserJob(job.id)?.status === "succeeded", "Browser job did not finish");
    expect(assistantRepository.getBrowserJob(job.id)?.result).toMatchObject({ ok: true, data: { unreads: ["general", "project"] } });
    expect(chromePermission).toMatchObject({ behavior: "allow", toolUseID: "tool-1" });
    expect(deniedPermission).toMatchObject({ behavior: "deny", interrupt: true, toolUseID: "tool-2" });
    expect(capturedOptions).toMatchObject({
      tools: [], allowedTools: ["mcp__claude-in-chrome__*"], extraArgs: { chrome: null },
      maxTurns: 7, maxBudgetUsd: 0.25, permissionMode: "dontAsk",
    });
    expect(capturedOptions?.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(service.status()).toMatchObject({ backend: "claude_in_chrome", state: "ready", lastError: null });

    await service.shutdown();
    assistantRepository.close();
    executionRepository.close();
  });

  it("persists an approved browser write result on its owning run", async () => {
    const databasePath = join(tmpdir(), `cc-assistant-browser-write-${randomUUID()}.sqlite`);
    paths.push(databasePath);
    new TaskRepository(databasePath).close();
    const assistantRepository = new AssistantRepository(databasePath);
    const executionRepository = new ExecutionRepository(databasePath);
    let capturedPrompt = "";
    const fakeQuery: BrowserAgentQuery = (params) => {
      capturedPrompt = String(params.prompt);
      const iterator = (async function* (): AsyncGenerator<SDKMessage> {
        yield {
          type: "result", subtype: "success", is_error: false, session_id: "browser-write-session",
          result: "done", structured_output: {
            ok: true, summary: "Message sent and verified", data: { sent: true, channelName: "test-channel" },
          }, total_cost_usd: 0.03, num_turns: 3,
        } as SDKMessage;
      })();
      return Object.assign(iterator, { close() {} });
    };
    const config: DaemonConfig = {
      host: "127.0.0.1", port: 4317, dataDir: tmpdir(), databasePath,
      accessToken: "test-token-with-at-least-thirty-two-characters", accessTokenPath: "unused",
      allowedRoots: [tmpdir()],
    };
    const run = executionRepository.createRun({
      kind: "browser", status: "queued", title: "Approved Slack send", cwd: tmpdir(),
      metadata: { adapter: "slack", action: "send_message" },
    });
    const job = assistantRepository.createBrowserJob("slack", "send_message", {
      channelName: "test-channel", text: "Exact approved text",
    }, run.id);
    const service = new BrowserAutomationService(assistantRepository, executionRepository, config, fakeQuery);
    service.start();

    await until(() => executionRepository.getRun(run.id)?.status === "succeeded", "Browser write run did not finish");
    expect(capturedPrompt).toContain('"channelName":"test-channel"');
    expect(capturedPrompt).toContain('"text":"Exact approved text"');
    expect(capturedPrompt).toContain("already received an external one-time user approval");
    expect(executionRepository.getRun(run.id)).toMatchObject({
      status: "succeeded", sessionId: "browser-write-session",
      metadata: { browserJobId: job.id, browserBackend: "claude_in_chrome", totalCostUsd: 0.03, numTurns: 3 },
    });

    await service.shutdown();
    assistantRepository.close();
    executionRepository.close();
  });

  it("fails closed when the browser worker cannot verify the requested action", async () => {
    const databasePath = join(tmpdir(), `cc-assistant-browser-fail-${randomUUID()}.sqlite`);
    paths.push(databasePath);
    new TaskRepository(databasePath).close();
    const assistantRepository = new AssistantRepository(databasePath);
    const executionRepository = new ExecutionRepository(databasePath);
    const fakeQuery: BrowserAgentQuery = () => {
      const iterator = (async function* (): AsyncGenerator<SDKMessage> {
        yield {
          type: "result", subtype: "success", is_error: false, session_id: "browser-fail-session",
          result: "not verified", structured_output: {
            ok: false, summary: "The target channel was ambiguous", data: { candidates: ["team", "team-old"] },
          }, total_cost_usd: 0.01, num_turns: 1,
        } as SDKMessage;
      })();
      return Object.assign(iterator, { close() {} });
    };
    const config: DaemonConfig = {
      host: "127.0.0.1", port: 4317, dataDir: tmpdir(), databasePath,
      accessToken: "test-token-with-at-least-thirty-two-characters", accessTokenPath: "unused",
      allowedRoots: [tmpdir()],
    };
    const job = assistantRepository.createBrowserJob("slack", "read_channel", { channelName: "team" });
    const service = new BrowserAutomationService(assistantRepository, executionRepository, config, fakeQuery);
    service.start();

    await until(() => assistantRepository.getBrowserJob(job.id)?.status === "failed", "Ambiguous browser job did not fail");
    expect(assistantRepository.getBrowserJob(job.id)?.error).toBe("The target channel was ambiguous");
    expect(service.status()).toMatchObject({ state: "error", lastError: "The target channel was ambiguous" });

    await service.shutdown();
    assistantRepository.close();
    executionRepository.close();
  });

  it("rejects a nominally successful browser write without the required verification flag", async () => {
    const databasePath = join(tmpdir(), `cc-assistant-browser-unverified-write-${randomUUID()}.sqlite`);
    paths.push(databasePath);
    new TaskRepository(databasePath).close();
    const assistantRepository = new AssistantRepository(databasePath);
    const executionRepository = new ExecutionRepository(databasePath);
    const fakeQuery: BrowserAgentQuery = () => {
      const iterator = (async function* (): AsyncGenerator<SDKMessage> {
        yield {
          type: "result", subtype: "success", is_error: false, session_id: "unverified-write-session",
          result: "done", structured_output: {
            ok: true, summary: "I think the message was sent", data: {},
          }, total_cost_usd: 0.01, num_turns: 1,
        } as SDKMessage;
      })();
      return Object.assign(iterator, { close() {} });
    };
    const config: DaemonConfig = {
      host: "127.0.0.1", port: 4317, dataDir: tmpdir(), databasePath,
      accessToken: "test-token-with-at-least-thirty-two-characters", accessTokenPath: "unused",
      allowedRoots: [tmpdir()],
    };
    const run = executionRepository.createRun({
      kind: "browser", status: "queued", title: "Unverified Slack send", cwd: tmpdir(),
      metadata: { adapter: "slack", action: "send_message" },
    });
    const job = assistantRepository.createBrowserJob("slack", "send_message", {
      channelName: "test-channel", text: "Exact text",
    }, run.id);
    const service = new BrowserAutomationService(assistantRepository, executionRepository, config, fakeQuery);
    service.start();

    await until(() => assistantRepository.getBrowserJob(job.id)?.status === "failed", "Unverified write did not fail");
    expect(assistantRepository.getBrowserJob(job.id)?.error).toBe("Slack worker did not verify message delivery with data.sent=true");
    expect(executionRepository.getRun(run.id)).toMatchObject({
      status: "failed", error: "Slack worker did not verify message delivery with data.sent=true",
    });

    await service.shutdown();
    assistantRepository.close();
    executionRepository.close();
  });

  it("reconstructs an approved browser job after a restart window", async () => {
    const databasePath = join(tmpdir(), `cc-assistant-browser-recovery-${randomUUID()}.sqlite`);
    paths.push(databasePath);
    new TaskRepository(databasePath).close();
    const assistantRepository = new AssistantRepository(databasePath);
    const executionRepository = new ExecutionRepository(databasePath);
    const run = executionRepository.createRun({
      kind: "browser", status: "waiting_approval", title: "Recover Calendar write", cwd: tmpdir(),
      metadata: {
        adapter: "google_calendar", action: "create_event",
        input: { title: "Recovered", start: "2026-09-18T13:00:00.000Z", end: "2026-09-18T13:30:00.000Z" },
      },
    });
    const approval = executionRepository.createApproval({
      runId: run.id, actionType: "browser_action", summary: "Create event", payload: run.metadata,
    });
    executionRepository.resolveApproval(approval.id, "approved");
    const fakeQuery: BrowserAgentQuery = () => {
      const iterator = (async function* (): AsyncGenerator<SDKMessage> {
        yield {
          type: "result", subtype: "success", is_error: false, session_id: "recovered-session",
          result: "done", structured_output: { ok: true, summary: "Created", data: { created: true } },
          total_cost_usd: 0.02, num_turns: 2,
        } as SDKMessage;
      })();
      return Object.assign(iterator, { close() {} });
    };
    const config: DaemonConfig = {
      host: "127.0.0.1", port: 4317, dataDir: tmpdir(), databasePath,
      accessToken: "test-token-with-at-least-thirty-two-characters", accessTokenPath: "unused",
      allowedRoots: [tmpdir()],
    };
    const service = new BrowserAutomationService(assistantRepository, executionRepository, config, fakeQuery);
    service.start();

    await until(() => executionRepository.getRun(run.id)?.status === "succeeded", "Recovered browser run did not finish");
    expect(assistantRepository.listBrowserJobs()).toMatchObject([{
      runId: run.id, adapter: "google_calendar", action: "create_event", status: "succeeded",
    }]);

    await service.shutdown();
    assistantRepository.close();
    executionRepository.close();
  });
});
