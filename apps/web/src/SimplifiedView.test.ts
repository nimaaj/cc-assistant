import { describe, expect, it } from "vitest";
import type { ClaudeAgentSession } from "@cc-assistant/shared";
import {
  arrangeCanvasItems,
  automaticFolderName,
  canvasNodeRefreshSignature,
  contextSelectionIds,
  defaultCanvasPosition,
  graphBranchNodeIds,
  placementKey,
  sessionStatus,
  shouldArchiveCanvasItem,
  shouldArchiveClaudeSession,
  visibleArchiveCount,
} from "./SimplifiedView.js";

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

  it("changes its render signature when a folder badge count changes", () => {
    const node = { id: "folder:test", data: { count: 1, arrange: items[0]! } };
    expect(canvasNodeRefreshSignature([node]))
      .not.toBe(canvasNodeRefreshSignature([{ ...node, data: { ...node.data, count: 2 } }]));
  });
});

describe("canvas context selection", () => {
  it("preserves a remembered multi-selection when a selected icon is right-clicked", () => {
    expect(contextSelectionIds("second", new Set(["first", "second"]))).toEqual(["first", "second"]);
  });

  it("targets only an unselected icon when it is right-clicked", () => {
    expect(contextSelectionIds("third", new Set(["first", "second"]))).toEqual(["third"]);
  });

  it("selects an entire directed provenance branch without looping on cycles", () => {
    const createdAt = "2026-09-23T12:00:00.000Z";
    const links = [
      { from: { itemType: "claude_session" as const, itemId: "controller" }, to: { itemType: "run" as const, itemId: "run-1" }, relation: "created" as const, createdAt },
      { from: { itemType: "run" as const, itemId: "run-1" }, to: { itemType: "memory" as const, itemId: "memory-1" }, relation: "derived" as const, createdAt },
      { from: { itemType: "memory" as const, itemId: "memory-1" }, to: { itemType: "run" as const, itemId: "run-1" }, relation: "related" as const, createdAt },
      { from: { itemType: "run" as const, itemId: "hidden" }, to: { itemType: "task" as const, itemId: "hidden-task" }, relation: "derived" as const, createdAt },
    ];
    expect(graphBranchNodeIds("item:claude_session:controller", links, new Set([
      "item:claude_session:controller", "item:run:run-1", "item:memory:memory-1",
    ]))).toEqual([
      "item:claude_session:controller", "item:run:run-1", "item:memory:memory-1",
    ]);
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

  it("moves sessions without a live process out of the base workspace", () => {
    expect(shouldArchiveClaudeSession(session({ pid: null, state: "blocked" }))).toBe(true);
    expect(shouldArchiveClaudeSession(session({ pid: 42, state: "blocked" }))).toBe(false);
  });

  it("does not count trashed completed items in the visible Archive badge", () => {
    expect(visibleArchiveCount(new Set(["task:done", "run:done"]), new Set(["run:done"]))).toBe(1);
  });
});
