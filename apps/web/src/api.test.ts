import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserJob,
  createSchedule,
  createWorkspaceFolder,
  deleteWorkspaceFolder,
  dispatchInput,
  installAbility,
  listAbilities,
  listWorkspaceFolders,
  listWorkspaceItemPlacements,
  listWorkspaceItemLayouts,
  listWorkspaceTrashedItems,
  moveWorkspaceItem,
  resetWorkspaceItemLayouts,
  restoreWorkspaceItem,
  setWorkspaceItemLayout,
  trashWorkspaceItem,
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

  it("sends validated workspace context and parses the proposed run and approval", async () => {
    const now = "2026-09-21T12:00:00.000Z";
    const proposal = {
      run: { id: "00000000-0000-4000-8000-000000000010", taskId: null, kind: "command", status: "waiting_approval", title: "Dispatch", prompt: "Remember it", cwd: "/workspace", sessionId: null, result: null, error: null, metadata: {}, createdAt: now, startedAt: null, completedAt: null, revision: 1 },
      approval: { id: "00000000-0000-4000-8000-000000000011", runId: "00000000-0000-4000-8000-000000000010", actionType: "session_control", summary: "Dispatch", payload: {}, status: "pending", createdAt: now, resolvedAt: null, resolutionNote: null },
      target: { id: "controller", sessionId: "00000000-0000-4000-8000-000000000012", name: "cc-assistant-controller-test", cwd: "/workspace", kind: "background", startedAt: 1, state: "working", pid: 42, status: "busy", waitingFor: null },
    };
    const fetch = vi.fn().mockResolvedValue(jsonResponse(proposal, 202));
    vi.stubGlobal("fetch", fetch);

    await expect(dispatchInput("Remember the Linux version and environment here.", undefined, {
      workspaceFolderId: "00000000-0000-4000-8000-000000000013",
    })).resolves.toMatchObject({ run: { id: proposal.run.id }, approval: { id: proposal.approval.id } });

    expect(fetch).toHaveBeenCalledWith("/api/dispatcher", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ input: "Remember the Linux version and environment here.", context: { workspaceFolderId: "00000000-0000-4000-8000-000000000013" } }),
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

  it("uses validated workspace folder and placement contracts", async () => {
    const folder = {
      id: "00000000-0000-4000-8000-000000000090",
      name: "Research",
      icon: "idea",
      createdAt: "2026-09-21T10:00:00.000Z",
      updatedAt: "2026-09-21T10:00:00.000Z",
      revision: 1,
    };
    const placement = {
      itemType: "task",
      itemId: "00000000-0000-4000-8000-000000000091",
      folderId: folder.id,
      updatedAt: "2026-09-21T10:01:00.000Z",
    };
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ folders: [folder] }))
      .mockResolvedValueOnce(jsonResponse({ folder }, 201))
      .mockResolvedValueOnce(jsonResponse({ placements: [placement] }))
      .mockResolvedValueOnce(jsonResponse({ placement }))
      .mockResolvedValueOnce(jsonResponse({ layouts: [{ ...placement, x: 20, y: 40 }] }))
      .mockResolvedValueOnce(jsonResponse({ layout: { ...placement, x: 20, y: 40 } }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ itemType: "task", itemId: placement.itemId, trashedAt: "2026-09-21T10:02:00.000Z" }] }))
      .mockResolvedValueOnce(jsonResponse({ item: { itemType: "task", itemId: placement.itemId, trashedAt: "2026-09-21T10:02:00.000Z" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);

    await expect(listWorkspaceFolders()).resolves.toMatchObject([{ name: "Research", icon: "idea" }]);
    await expect(createWorkspaceFolder({ name: "Research", icon: "idea" })).resolves.toMatchObject(folder);
    await expect(listWorkspaceItemPlacements()).resolves.toMatchObject([placement]);
    await expect(moveWorkspaceItem({ itemType: "task", itemId: placement.itemId, folderId: folder.id }))
      .resolves.toMatchObject(placement);
    await expect(listWorkspaceItemLayouts()).resolves.toMatchObject([{ x: 20, y: 40 }]);
    await expect(setWorkspaceItemLayout({ itemType: "task", itemId: placement.itemId, x: 20, y: 40 }))
      .resolves.toMatchObject({ x: 20, y: 40 });
    await expect(listWorkspaceTrashedItems()).resolves.toMatchObject([{ itemType: "task", itemId: placement.itemId }]);
    await expect(trashWorkspaceItem({ itemType: "task", itemId: placement.itemId })).resolves.toMatchObject({ itemType: "task" });
    await expect(restoreWorkspaceItem({ itemType: "task", itemId: placement.itemId })).resolves.toBeUndefined();
    await expect(resetWorkspaceItemLayouts()).resolves.toBeUndefined();
    await expect(deleteWorkspaceFolder(folder.id)).resolves.toBeUndefined();
  });
});
