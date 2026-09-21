import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { buildApp } from "./app.js";
import type { BrowserAgentQuery } from "./browser-automation-service.js";
import type { DaemonConfig } from "./config.js";

const databasePath = join(tmpdir(), `cc-assistant-test-${randomUUID()}.sqlite`);

const fakeBrowserQuery: BrowserAgentQuery = () => {
  const iterator = (async function* (): AsyncGenerator<SDKMessage> {
    yield {
      type: "result", subtype: "success", is_error: false, session_id: "fake-browser-session",
      result: "completed", structured_output: { ok: true, summary: "Completed", data: { sent: true } },
      total_cost_usd: 0.01, num_turns: 1,
    } as SDKMessage;
  })();
  return Object.assign(iterator, { close() {} });
};

function config(): DaemonConfig {
  return {
    host: "127.0.0.1",
    port: 4317,
    dataDir: ".",
    databasePath,
    accessToken: "test-token-with-at-least-thirty-two-characters",
    accessTokenPath: "unused",
    allowedRoots: ["/tmp"],
  };
}

describe("daemon API", () => {
  it("requires authentication and supports the task lifecycle", async () => {
    const webRoot = mkdtempSync(join(tmpdir(), "cc-assistant-web-"));
    mkdirSync(join(webRoot, "assets"));
    writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>CC Assistant fixture</title>");
    writeFileSync(join(webRoot, "assets", "app.js"), "globalThis.fixture = true;");
    const app = await buildApp({ config: config(), browserAgentQuery: fakeBrowserQuery, webRoot });

    const dashboard = await app.inject({ method: "GET", url: "/" });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.headers["content-type"]).toContain("text/html");
    expect(dashboard.headers["cache-control"]).toBe("no-cache");
    expect(dashboard.body).toContain("CC Assistant fixture");

    const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toContain("text/javascript");
    expect(asset.headers["cache-control"]).toContain("immutable");

    const missingAsset = await app.inject({ method: "GET", url: "/assets/missing.js" });
    expect(missingAsset.statusCode).toBe(404);

    const unauthorized = await app.inject({ method: "GET", url: "/api/tasks" });
    expect(unauthorized.statusCode).toBe(401);

    const session = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: { token: config().accessToken },
    });
    expect(session.statusCode).toBe(204);
    const cookie = session.headers["set-cookie"];
    expect(cookie).toBeTypeOf("string");

    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: cookie as string },
      payload: { title: "First integrated task" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().task.title).toBe("First integrated task");

    const listed = await app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { cookie: cookie as string },
    });
    expect(listed.json().tasks).toHaveLength(1);

    const hook = await app.inject({
      method: "POST",
      url: "/api/hooks/claude",
      headers: { cookie: cookie as string },
      payload: {
        session_id: "session-test-1",
        transcript_path: "/tmp/session-test-1.jsonl",
        cwd: "/tmp/project",
        hook_event_name: "SessionStart",
        source: "startup",
        model: "claude-test",
      },
    });
    expect(hook.statusCode).toBe(200);
    expect(hook.json().session.status).toBe("idle");

    const sessions = await app.inject({
      method: "GET",
      url: "/api/sessions",
      headers: { cookie: cookie as string },
    });
    expect(sessions.json().sessions).toMatchObject([
      { id: "session-test-1", status: "idle", model: "claude-test" },
    ]);

    const proposed = await app.inject({
      method: "POST",
      url: "/api/runs/command",
      headers: { cookie: cookie as string },
      payload: {
        title: "Safe test command",
        executable: process.execPath,
        args: ["-e", "process.stdout.write('hello from command')"],
        cwd: "/tmp",
      },
    });
    expect(proposed.statusCode).toBe(202);
    expect(proposed.json().run.status).toBe("waiting_approval");

    const approved = await app.inject({
      method: "POST",
      url: `/api/approvals/${proposed.json().approval.id}/resolve`,
      headers: { cookie: cookie as string },
      payload: { decision: "approved" },
    });
    expect(approved.statusCode).toBe(200);

    let commandStatus = "running";
    for (let attempt = 0; attempt < 50 && commandStatus === "running"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const response = await app.inject({
        method: "GET",
        url: `/api/runs/${proposed.json().run.id}`,
        headers: { cookie: cookie as string },
      });
      commandStatus = response.json().run.status as string;
    }
    expect(commandStatus).toBe("succeeded");

    const logs = await app.inject({
      method: "GET",
      url: `/api/runs/${proposed.json().run.id}/logs`,
      headers: { cookie: cookie as string },
    });
    expect(logs.json().logs.map((log: { message: string }) => log.message).join("\n")).toContain("Starting node");

    const mismatchedBrowserAction = await app.inject({
      method: "POST",
      url: "/api/browser/jobs",
      headers: { cookie: cookie as string },
      payload: { adapter: "google_calendar", action: "read_channel", input: { channelName: "general" } },
    });
    expect(mismatchedBrowserAction.statusCode).toBe(400);

    const invalidCalendarRange = await app.inject({
      method: "POST",
      url: "/api/browser/jobs",
      headers: { cookie: cookie as string },
      payload: {
        adapter: "google_calendar",
        action: "create_event",
        input: { title: "Backwards", start: "2026-09-17T12:00:00.000Z", end: "2026-09-17T11:00:00.000Z" },
      },
    });
    expect(invalidCalendarRange.statusCode).toBe(400);

    const browserProposal = await app.inject({
      method: "POST",
      url: "/api/browser/jobs",
      headers: { cookie: cookie as string },
      payload: { adapter: "slack", action: "send_message", input: { channelName: "test", text: "Hello" } },
    });
    expect(browserProposal.json().run.status).toBe("waiting_approval");
    const browserApproved = await app.inject({
      method: "POST",
      url: `/api/approvals/${browserProposal.json().approval.id}/resolve`,
      headers: { cookie: cookie as string },
      payload: { decision: "approved" },
    });
    expect(browserApproved.statusCode).toBe(200);
    let browserRunStatus = "running";
    for (let attempt = 0; attempt < 50 && browserRunStatus === "running"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const browserRun = await app.inject({
        method: "GET",
        url: `/api/runs/${browserProposal.json().run.id}`,
        headers: { cookie: cookie as string },
      });
      browserRunStatus = browserRun.json().run.status as string;
    }
    expect(browserRunStatus).toBe("succeeded");

    const deniedBrowserProposal = await app.inject({
      method: "POST",
      url: "/api/browser/jobs",
      headers: { cookie: cookie as string },
      payload: { adapter: "google_calendar", action: "create_event", input: {
        title: "Must not be created",
        start: "2026-09-18T13:00:00.000Z",
        end: "2026-09-18T13:30:00.000Z",
      } },
    });
    expect(deniedBrowserProposal.json().run.status).toBe("waiting_approval");
    await app.inject({
      method: "POST",
      url: `/api/approvals/${deniedBrowserProposal.json().approval.id}/resolve`,
      headers: { cookie: cookie as string },
      payload: { decision: "denied", note: "Test denial" },
    });
    const deniedRun = await app.inject({
      method: "GET",
      url: `/api/runs/${deniedBrowserProposal.json().run.id}`,
      headers: { cookie: cookie as string },
    });
    expect(deniedRun.json().run).toMatchObject({ status: "cancelled", error: "Test denial" });
    const allBrowserJobs = await app.inject({ method: "GET", url: "/api/browser/jobs", headers: { cookie: cookie as string } });
    expect(allBrowserJobs.json().jobs.some((job: { runId: string | null }) => job.runId === deniedBrowserProposal.json().run.id)).toBe(false);

    const reminder = await app.inject({
      method: "POST",
      url: "/api/schedules",
      headers: { cookie: cookie as string },
      payload: {
        name: "Integration reminder",
        triggerKind: "at",
        trigger: { at: new Date(Date.now() - 1_000).toISOString() },
        actionKind: "reminder",
        action: { title: "Reminder fired", body: "durably" },
      },
    });
    expect(reminder.statusCode).toBe(201);
    let notificationCount = 0;
    for (let attempt = 0; attempt < 30 && notificationCount === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const notifications = await app.inject({
        method: "GET",
        url: "/api/notifications",
        headers: { cookie: cookie as string },
      });
      notificationCount = notifications.json().notifications.length as number;
    }
    expect(notificationCount).toBe(1);

    const invalidMemory = await app.inject({
      method: "POST", url: "/api/memories", headers: { cookie: cookie as string }, payload: { title: "" },
    });
    expect(invalidMemory.statusCode).toBe(400);
    const createdMemory = await app.inject({
      method: "POST", url: "/api/memories", headers: { cookie: cookie as string },
      payload: { title: "API memory", body: "Links to [[Missing Page]].", tags: ["Test"] },
    });
    expect(createdMemory.statusCode).toBe(201);
    expect(createdMemory.json().memory.slug).toBe("api-memory");
    const memoryId = createdMemory.json().memory.id as string;
    const staleMemory = await app.inject({
      method: "PATCH", url: `/api/memories/${memoryId}`, headers: { cookie: cookie as string },
      payload: { body: "stale", expectedRevision: 99 },
    });
    expect(staleMemory.statusCode).toBe(409);
    const memoryLinks = await app.inject({
      method: "GET", url: `/api/memories/${memoryId}/links`, headers: { cookie: cookie as string },
    });
    expect(memoryLinks.json().outgoing).toMatchObject([{ slug: "missing-page", resolved: false }]);
    const recall = await app.inject({
      method: "POST", url: "/api/memories/recall", headers: { cookie: cookie as string },
      payload: { query: "API memory", limit: 3, characterLimit: 1000 },
    });
    expect(recall.json().items[0].id).toBe(memoryId);
    const revisions = await app.inject({
      method: "GET", url: `/api/memories/${memoryId}/revisions`, headers: { cookie: cookie as string },
    });
    expect(revisions.json().revisions).toHaveLength(1);
    const tags = await app.inject({
      method: "GET", url: "/api/memories/tags", headers: { cookie: cookie as string },
    });
    expect(tags.json().tags).toEqual([{ tag: "test", count: 1 }]);
    const exported = await app.inject({
      method: "GET", url: "/api/memories/export", headers: { cookie: cookie as string },
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.json().files[0]).toMatchObject({ path: "memories/api-memory.md" });
    const preview = await app.inject({
      method: "POST", url: "/api/memories/import/preview", headers: { cookie: cookie as string },
      payload: { files: exported.json().files },
    });
    expect(preview.json().summary).toMatchObject({ unchanged: 1, conflict: 0, invalid: 0 });
    const changedFiles = exported.json().files.map((file: { path: string; content: string }) => ({
      ...file, content: file.content.replace("Links to [[Missing Page]].", "Updated through Markdown import."),
    }));
    const appliedImport = await app.inject({
      method: "POST", url: "/api/memories/import", headers: { cookie: cookie as string },
      payload: { files: changedFiles },
    });
    expect(appliedImport.statusCode).toBe(200);
    expect(appliedImport.json().plan.summary).toMatchObject({ update: 1, conflict: 0, invalid: 0 });
    expect(appliedImport.json().memories[0]).toMatchObject({
      id: memoryId, revision: 2, body: "Updated through Markdown import.",
    });
    const missingMemory = await app.inject({
      method: "GET", url: "/api/memories/does-not-exist", headers: { cookie: cookie as string },
    });
    expect(missingMemory.statusCode).toBe(404);

    const createdFolder = await app.inject({
      method: "POST", url: "/api/workspace/folders", headers: { cookie: cookie as string },
      payload: { name: "Integration folder", icon: "briefcase" },
    });
    expect(createdFolder.statusCode).toBe(201);
    const folderId = createdFolder.json().folder.id as string;
    const movedItem = await app.inject({
      method: "PUT", url: "/api/workspace/placements", headers: { cookie: cookie as string },
      payload: { itemType: "task", itemId: created.json().task.id, folderId },
    });
    expect(movedItem.json().placement).toMatchObject({ itemType: "task", folderId });
    const listedFolders = await app.inject({
      method: "GET", url: "/api/workspace/folders", headers: { cookie: cookie as string },
    });
    expect(listedFolders.json().folders).toMatchObject([{ id: folderId, icon: "briefcase" }]);
    const deletedFolder = await app.inject({
      method: "DELETE", url: `/api/workspace/folders/${folderId}`, headers: { cookie: cookie as string },
    });
    expect(deletedFolder.statusCode).toBe(204);
    const listedPlacements = await app.inject({
      method: "GET", url: "/api/workspace/placements", headers: { cookie: cookie as string },
    });
    expect(listedPlacements.json().placements).toEqual([]);

    await app.close();
    rmSync(databasePath, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
    rmSync(`${databasePath}-wal`, { force: true });
    rmSync(webRoot, { recursive: true, force: true });
  });
});
