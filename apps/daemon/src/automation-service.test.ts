import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AssistantRepository } from "./assistant-repository.js";
import { AutomationService } from "./automation-service.js";
import type { DaemonConfig } from "./config.js";
import { ExecutionRepository } from "./execution-repository.js";
import { ExecutionService } from "./execution-service.js";
import { TaskRepository } from "./task-repository.js";

const paths: string[] = [];
afterEach(() => { for (const value of paths.splice(0)) for (const suffix of ["", "-shm", "-wal"]) rmSync(`${value}${suffix}`, { force: true }); });

function setup() {
  const databasePath = join(tmpdir(), `cc-automation-${randomUUID()}.sqlite`);
  paths.push(databasePath);
  new TaskRepository(databasePath).close();
  const assistant = new AssistantRepository(databasePath);
  const executionRepository = new ExecutionRepository(databasePath);
  const config: DaemonConfig = { host: "127.0.0.1", port: 4317, dataDir: tmpdir(), databasePath,
    accessToken: "test-token-with-at-least-thirty-two-characters", accessTokenPath: "unused", allowedRoots: [tmpdir()] };
  const execution = new ExecutionService(executionRepository, config);
  return { assistant, executionRepository, automation: new AutomationService(assistant, execution, { notify: async () => {}, readClipboardImage: async () => ({ mimeType: "image/png", base64: "" }) }, config) };
}

describe("AutomationService", () => {
  it("validates ability inputs and proposes a shell-free approved command", () => {
    const { assistant, executionRepository, automation } = setup();
    assistant.installAbility({ manifestVersion: 1, id: "greet-person", name: "Greet person", description: "test",
      inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
      execution: { kind: "command", executable: "printf", args: ["Hello %s", "${input.name}"] } });
    expect(() => automation.invokeAbility("greet-person", {})).toThrow("Missing required ability input");
    const proposed = automation.invokeAbility("greet-person", { name: "Nima" });
    expect(proposed.approval.actionType).toBe("run_command");
    expect(executionRepository.getRun(proposed.run.id)).toMatchObject({ status: "waiting_approval", metadata: { executable: "printf", args: ["Hello %s", "Nima"] } });
    assistant.close(); executionRepository.close();
  });

  it("rejects unsupported or internally inconsistent ability schemas during installation", () => {
    const { assistant, executionRepository } = setup();
    expect(() => assistant.installAbility({
      manifestVersion: 1, id: "unsupported-schema", name: "Unsupported", description: "test",
      inputSchema: { type: "object", properties: { name: { type: "string", minLength: 2 } } },
      execution: { kind: "command", executable: "printf", args: [] },
    })).toThrow();
    expect(() => assistant.installAbility({
      manifestVersion: 1, id: "missing-property", name: "Missing property", description: "test",
      inputSchema: { type: "object", properties: {}, required: ["name"] },
      execution: { kind: "command", executable: "printf", args: [] },
    })).toThrow("Required ability inputs must be declared in properties");
    assistant.close(); executionRepository.close();
  });

  it("fires matching system-notification triggers once within the cooldown", async () => {
    const { assistant, executionRepository, automation } = setup();
    assistant.createSchedule({ name: "Build alert", triggerKind: "system_notification",
      trigger: { title: "build failed", cooldownMs: 60_000 }, actionKind: "reminder",
      action: { title: "Investigate build", body: "Open the CI log" } });
    expect(await automation.ingestSystemNotification({ title: "The BUILD FAILED on main" })).toHaveLength(1);
    expect(assistant.listNotifications()).toHaveLength(1);
    expect(await automation.ingestSystemNotification({ title: "The BUILD FAILED on main" })).toHaveLength(0);
    assistant.close(); executionRepository.close();
  });

  it("fires an overdue reminder after repository restart and disables the one-shot schedule", async () => {
    const databasePath = join(tmpdir(), `cc-automation-restart-${randomUUID()}.sqlite`);
    paths.push(databasePath);
    new TaskRepository(databasePath).close();
    let assistant = new AssistantRepository(databasePath);
    const schedule = assistant.createSchedule({
      name: "Durable reminder", triggerKind: "at",
      trigger: { at: new Date(Date.now() - 5_000).toISOString() },
      actionKind: "reminder", action: { title: "Persisted", body: "Fired after restart" },
    });
    assistant.close();

    assistant = new AssistantRepository(databasePath);
    const executionRepository = new ExecutionRepository(databasePath);
    const config: DaemonConfig = {
      host: "127.0.0.1", port: 4317, dataDir: tmpdir(), databasePath,
      accessToken: "test-token-with-at-least-thirty-two-characters", accessTokenPath: "unused",
      allowedRoots: [tmpdir()],
    };
    const execution = new ExecutionService(executionRepository, config);
    const delivered: Array<{ title: string; body: string }> = [];
    const automation = new AutomationService(assistant, execution, {
      notify: async (title, body) => { delivered.push({ title, body }); },
      readClipboardImage: async () => ({ mimeType: "image/png", base64: "" }),
    }, config);

    await automation.tick();
    expect(delivered).toEqual([{ title: "Persisted", body: "Fired after restart" }]);
    expect(assistant.listNotifications()).toMatchObject([{ title: "Persisted", source: `schedule:${schedule.id}` }]);
    expect(assistant.getSchedule(schedule.id)).toMatchObject({ enabled: false, nextRunAt: null });

    assistant.close();
    executionRepository.close();
  });

  it("routes scheduled dispatcher actions through the main controller approval path", async () => {
    const databasePath = join(tmpdir(), `cc-automation-dispatcher-${randomUUID()}.sqlite`);
    paths.push(databasePath);
    new TaskRepository(databasePath).close();
    const assistant = new AssistantRepository(databasePath);
    const executionRepository = new ExecutionRepository(databasePath);
    const config: DaemonConfig = {
      host: "127.0.0.1", port: 4317, dataDir: tmpdir(), databasePath,
      accessToken: "test-token-with-at-least-thirty-two-characters", accessTokenPath: "unused",
      allowedRoots: [tmpdir()],
    };
    const requests: unknown[] = [];
    const automation = new AutomationService(
      assistant,
      new ExecutionService(executionRepository, config),
      { notify: async () => {}, readClipboardImage: async () => ({ mimeType: "image/png", base64: "" }) },
      config,
      { proposeDispatcher: async (input) => { requests.push(input); } },
    );
    const schedule = assistant.createSchedule({
      name: "Environment inventory",
      triggerKind: "at",
      trigger: { at: new Date(Date.now() - 1_000).toISOString() },
      actionKind: "dispatcher",
      action: { request: "Inventory this machine and update the environment memory." },
    });

    await automation.tick();
    expect(requests).toEqual([expect.objectContaining({
      input: "Inventory this machine and update the environment memory.",
      source: "schedule",
      context: expect.objectContaining({ scheduleId: schedule.id, scheduleName: schedule.name }),
    })]);
    expect(assistant.getSchedule(schedule.id)).toMatchObject({ enabled: false, nextRunAt: null });
    assistant.close();
    executionRepository.close();
  });
});
