import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserJob,
  createSchedule,
  installAbility,
  listAbilities,
  proposeCommand,
  readClipboardImage,
  updateSchedule,
} from "./api.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("web API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preserves exact browser and command payloads", async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ accepted: true }, 202)));
    vi.stubGlobal("fetch", fetch);

    await createBrowserJob({
      adapter: "slack",
      action: "send_message",
      input: { channelName: "release-coordination", text: "Ship after approval" },
    });
    await proposeCommand({
      title: "Inspect status",
      executable: "git",
      args: ["status", "--short"],
      cwd: "/workspace/project",
    });

    expect(fetch).toHaveBeenNthCalledWith(1, "/api/browser/jobs", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        adapter: "slack",
        action: "send_message",
        input: { channelName: "release-coordination", text: "Ship after approval" },
      }),
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/runs/command", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        title: "Inspect status",
        executable: "git",
        args: ["status", "--short"],
        cwd: "/workspace/project",
      }),
    }));
  });

  it("parses schedule create and revision-safe update responses", async () => {
    const schedule = {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Focus reminder",
      enabled: true,
      triggerKind: "interval",
      trigger: { everyMs: 3600000 },
      actionKind: "reminder",
      action: { title: "Focus", body: "Check current task" },
      nextRunAt: "2026-09-17T18:00:00.000Z",
      lastRunAt: null,
      createdAt: "2026-09-17T17:00:00.000Z",
      updatedAt: "2026-09-17T17:00:00.000Z",
      revision: 1,
    };
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ schedule }, 201))
      .mockResolvedValueOnce(jsonResponse({ schedule: { ...schedule, enabled: false, nextRunAt: null, revision: 2 } }));
    vi.stubGlobal("fetch", fetch);

    await expect(createSchedule({
      name: schedule.name,
      triggerKind: "interval",
      trigger: schedule.trigger,
      actionKind: "reminder",
      action: schedule.action,
    })).resolves.toMatchObject({ name: schedule.name, revision: 1 });
    await expect(updateSchedule(schedule.id, { enabled: false, expectedRevision: 1 }))
      .resolves.toMatchObject({ enabled: false, revision: 2 });
  });

  it("validates ability and clipboard responses before exposing them to the UI", async () => {
    const ability = {
      manifestVersion: 1,
      id: "say-hello",
      name: "Say hello",
      description: "Print a greeting",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false,
      },
      execution: { kind: "command", executable: "printf", args: ["Hello %s", "${input.name}"], timeoutMs: 1000 },
    } as const;
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ abilities: [ability] }))
      .mockResolvedValueOnce(jsonResponse({ ability }, 201))
      .mockResolvedValueOnce(jsonResponse({ image: { mimeType: "image/png", dataUrl: "data:image/png;base64,AA==" } }));
    vi.stubGlobal("fetch", fetch);

    await expect(listAbilities()).resolves.toMatchObject([{ id: "say-hello" }]);
    await expect(installAbility(ability)).resolves.toMatchObject({ id: "say-hello" });
    await expect(readClipboardImage()).resolves.toEqual({ mimeType: "image/png", dataUrl: "data:image/png;base64,AA==" });
  });
});
