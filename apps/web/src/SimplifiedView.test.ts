import { describe, expect, it } from "vitest";
import type { ClaudeAgentSession } from "@cc-assistant/shared";
import { arrangeCanvasItems, automaticFolderName, defaultCanvasPosition, placementKey, sessionStatus, shouldArchiveCanvasItem } from "./SimplifiedView.js";

function session(overrides: Partial<ClaudeAgentSession> = {}): ClaudeAgentSession {
  return {
    id: "controller1",
    sessionId: "controller1-0000-4000-8000-000000000000",
    name: "cc-assistant-controller-controller1",
    cwd: "/tmp/project",
    kind: "background",
    startedAt: 1,
    state: "blocked",
    pid: 42,
    status: "idle",
    waitingFor: null,
    ...overrides,
  };
}

describe("simplified session status", () => {
  it("shows a prompt-ready blocked process as idle", () => {
    expect(sessionStatus(session())).toBe("idle");
  });

  it("keeps permission prompts and active work conspicuous", () => {
    expect(sessionStatus(session({ waitingFor: "permission prompt" }))).toBe("attention");
    expect(sessionStatus(session({ state: "working", status: "busy" }))).toBe("running");
  });
});

describe("workspace placement keys", () => {
  it("keeps item types distinct when identifiers overlap", () => {
    expect(placementKey("task", "same-id")).toBe("task:same-id");
    expect(placementKey("run", "same-id")).not.toBe(placementKey("task", "same-id"));
  });

  it("creates a deterministic collision-free starting grid", () => {
    expect(defaultCanvasPosition(0, 4)).toEqual({ x: 340, y: 72 });
    expect(defaultCanvasPosition(3, 4)).toEqual({ x: 790, y: 72 });
    expect(defaultCanvasPosition(4, 4)).toEqual({ x: 340, y: 194 });
  });

  it("derives concise names for drag-created folders", () => {
    expect(automaticFolderName("Investigate flaky integration test", "Document release process"))
      .toBe("Investigate flaky integration + Document release process");
    expect(automaticFolderName("Same task", "same task")).toBe("Same task");
  });
});

describe("canvas auto arrangement", () => {
  const items = [
    { id: "old-task", title: "Old task", category: "Task", status: "idle" as const, time: 1 },
    { id: "new-run", title: "New run", category: "Run", status: "running" as const, time: 3 },
    { id: "approval", title: "Approval", category: "Approval", status: "attention" as const, time: 2 },
  ];

  it("groups status and category arrangements into distinct horizontal bands", () => {
    const byStatus = arrangeCanvasItems(items, "status");
    expect(byStatus.approval!.y).toBeLessThan(byStatus["new-run"]!.y);
    expect(byStatus["new-run"]!.y).toBeLessThan(byStatus["old-task"]!.y);

    const byCategory = arrangeCanvasItems(items, "category");
    expect(byCategory.approval!.y).toBeLessThan(byCategory["new-run"]!.y);
    expect(byCategory["new-run"]!.y).toBeLessThan(byCategory["old-task"]!.y);
  });

  it("places newest items first in the time arrangement", () => {
    const byTime = arrangeCanvasItems(items, "time");
    expect(byTime["new-run"]).toEqual({ x: 340, y: 112 });
    expect(byTime.approval!.x).toBeGreaterThan(byTime["new-run"]!.x);
  });
});

describe("automatic canvas archive", () => {
  it("archives terminal work while keeping useful and failed records visible", () => {
    expect(shouldArchiveCanvasItem("run", "succeeded")).toBe(true);
    expect(shouldArchiveCanvasItem("task", "cancelled")).toBe(true);
    expect(shouldArchiveCanvasItem("claude_session", "stopped")).toBe(true);
    expect(shouldArchiveCanvasItem("browser_job", "failed")).toBe(false);
    expect(shouldArchiveCanvasItem("memory", "active")).toBe(false);
  });
});
