import { describe, expect, it } from "vitest";
import type { ClaudeAgentSession } from "@cc-assistant/shared";
import { placementKey, sessionStatus } from "./SimplifiedView.js";

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
});
