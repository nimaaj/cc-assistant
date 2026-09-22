import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AssistantRepository } from "./assistant-repository.js";

const paths: string[] = [];

afterEach(() => {
  for (const path of paths.splice(0)) {
    rmSync(path, { force: true });
    rmSync(`${path}-shm`, { force: true });
    rmSync(`${path}-wal`, { force: true });
  }
});

describe("assistant repository", () => {
  it("persists schedules, abilities, notifications, browser jobs, and workspace folders", () => {
    const databasePath = join(tmpdir(), `cc-assistant-state-${randomUUID()}.sqlite`);
    paths.push(databasePath);
    let store = new AssistantRepository(databasePath);
    const schedule = store.createSchedule({
      name: "Stand up",
      triggerKind: "interval",
      trigger: { everyMs: 60_000 },
      actionKind: "reminder",
      action: { title: "Move", body: "Stand and stretch" },
    });
    expect(schedule.nextRunAt).not.toBeNull();
    expect(store.listSchedules()).toHaveLength(1);
    expect(() => store.createSchedule({
      name: "Unsafe catch-all", triggerKind: "system_notification", trigger: {},
      actionKind: "reminder", action: { title: "Loop" },
    })).toThrow("requires an app, title, or body filter");
    const disabled = store.updateSchedule(schedule.id, { enabled: false, expectedRevision: schedule.revision });
    expect(disabled).toMatchObject({ enabled: false, nextRunAt: null, revision: 2 });
    expect(() => store.updateSchedule(schedule.id, { enabled: true, expectedRevision: schedule.revision }))
      .toThrow("has changed since it was loaded");

    store.installAbility({
      manifestVersion: 1,
      id: "say-hello",
      name: "Say hello",
      description: "Print a greeting",
      inputSchema: { type: "object" },
      execution: { kind: "command", executable: "printf", args: ["Hello ${input.name}"] },
    });
    expect(store.getAbility("say-hello")?.name).toBe("Say hello");

    store.createNotification("Test", "Body", "test");
    expect(store.listNotifications()).toHaveLength(1);

    const job = store.createBrowserJob("slack", "list_unreads", {});
    expect(store.claimBrowserJob()?.id).toBe(job.id);
    expect(store.completeBrowserJob(job.id, { count: 2 }).status).toBe("succeeded");

    const folder = store.createWorkspaceFolder({ name: "Current project", icon: "code" });
    expect(store.listWorkspaceFolders()).toMatchObject([{ id: folder.id, name: "Current project", icon: "code" }]);
    const moved = store.moveWorkspaceItem({ itemType: "task", itemId: randomUUID(), folderId: folder.id });
    expect(moved).toMatchObject({ itemType: "task", folderId: folder.id });
    const renamed = store.updateWorkspaceFolder(folder.id, {
      name: "Active project", icon: "rocket", expectedRevision: folder.revision,
    });
    expect(renamed).toMatchObject({ name: "Active project", icon: "rocket", revision: 2 });
    expect(() => store.updateWorkspaceFolder(folder.id, {
      name: "Stale update", expectedRevision: folder.revision,
    })).toThrow("has changed since it was loaded");
    const positioned = store.setWorkspaceItemLayout({
      itemType: "task", itemId: moved?.itemId ?? "missing", x: -144, y: 288,
    });
    expect(positioned).toMatchObject({ x: -144, y: 288 });
    store.setWorkspaceItemLayout({ itemType: "folder", itemId: folder.id, x: 360, y: 72 });
    const trashed = store.trashWorkspaceItem({ itemType: "task", itemId: moved?.itemId ?? "missing" });
    expect(trashed).toMatchObject({ itemType: "task", itemId: moved?.itemId });
    expect(store.listWorkspaceItemPlacements()).toHaveLength(0);
    store.close();
    store = new AssistantRepository(databasePath);
    expect(store.listSchedules()).toMatchObject([{ id: schedule.id, enabled: false, revision: 2 }]);
    expect(store.getAbility("say-hello")?.name).toBe("Say hello");
    expect(store.listNotifications()).toHaveLength(1);
    expect(store.getBrowserJob(job.id)?.status).toBe("succeeded");
    expect(store.getWorkspaceFolder(folder.id)).toMatchObject({ name: "Active project", revision: 2 });
    expect(store.listWorkspaceItemPlacements()).toHaveLength(0);
    expect(store.listWorkspaceTrashedItems()).toMatchObject([{ itemType: "task", itemId: moved?.itemId }]);
    store.restoreWorkspaceItem({ itemType: "task", itemId: moved?.itemId ?? "missing" });
    expect(store.listWorkspaceTrashedItems()).toHaveLength(0);
    expect(store.listWorkspaceItemLayouts()).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemType: "task", itemId: moved?.itemId, x: -144, y: 288 }),
      expect.objectContaining({ itemType: "folder", itemId: folder.id, x: 360, y: 72 }),
    ]));
    store.deleteWorkspaceFolder(folder.id);
    expect(store.listWorkspaceFolders()).toHaveLength(0);
    expect(store.listWorkspaceItemPlacements()).toHaveLength(0);
    store.clearWorkspaceItemLayouts();
    expect(store.listWorkspaceItemLayouts()).toHaveLength(0);
    store.close();
  });

  it("unfiles items and rejects unknown destination folders", () => {
    const databasePath = join(tmpdir(), `cc-assistant-state-${randomUUID()}.sqlite`);
    paths.push(databasePath);
    const store = new AssistantRepository(databasePath);
    const folder = store.createWorkspaceFolder({ name: "Later", icon: "archive" });
    const itemId = randomUUID();
    store.moveWorkspaceItem({ itemType: "memory", itemId, folderId: folder.id });
    expect(store.moveWorkspaceItem({ itemType: "memory", itemId, folderId: null })).toBeNull();
    expect(store.listWorkspaceItemPlacements()).toHaveLength(0);
    expect(() => store.moveWorkspaceItem({ itemType: "task", itemId, folderId: randomUUID() }))
      .toThrow("was not found");
    store.close();
  });
});
