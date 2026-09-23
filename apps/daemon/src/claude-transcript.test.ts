import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ClaudeSession } from "@cc-assistant/shared";
import { formatClaudeTranscript, readObservedClaudeTranscript } from "./claude-transcript.js";

function observed(id: string, transcriptPath: string): ClaudeSession {
  return {
    id, transcriptPath, cwd: "/tmp/project", model: "test", agentType: null,
    permissionMode: "auto", status: "ended", lastEvent: "SessionEnd",
    startedAt: "2026-09-23T00:00:00.000Z", lastEventAt: "2026-09-23T00:01:00.000Z",
    endedAt: "2026-09-23T00:01:00.000Z",
  };
}

describe("Claude transcript fallback", () => {
  it("formats user and assistant text without exposing thinking or tool results", () => {
    const jsonl = [
      { type: "user", timestamp: "2026-09-23T00:00:00.000Z", message: { content: "Inspect the project" } },
      { type: "assistant", timestamp: "2026-09-23T00:00:01.000Z", message: { content: [{ type: "thinking", thinking: "private" }, { type: "tool_use", name: "Read" }] } },
      { type: "user", message: { content: [{ type: "tool_result", content: "secret output" }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "Inspection complete." }] } },
    ].map((value) => JSON.stringify(value)).join("\n");
    const result = formatClaudeTranscript(jsonl);
    expect(result).toContain("Inspect the project");
    expect(result).toContain("[tool: Read]");
    expect(result).toContain("Inspection complete.");
    expect(result).not.toContain("private");
    expect(result).not.toContain("secret output");
  });

  it("reads only a matching transcript under the configured Claude projects root", async () => {
    const root = await mkdtemp(join(tmpdir(), "cc-assistant-transcript-"));
    const projectsRoot = join(root, ".claude", "projects");
    const project = join(projectsRoot, "-tmp-project");
    const id = "00000000-0000-4000-8000-000000000123";
    const transcriptPath = join(project, `${id}.jsonl`);
    await mkdir(project, { recursive: true });
    await writeFile(transcriptPath, `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Recovered output" }] } })}\n`);
    await expect(readObservedClaudeTranscript(observed(id, transcriptPath), { projectsRoot }))
      .resolves.toContain("Recovered output");

    const outside = join(root, `${id}.jsonl`);
    await writeFile(outside, "{}\n");
    await expect(readObservedClaudeTranscript(observed(id, outside), { projectsRoot }))
      .rejects.toThrow("outside Claude's project transcript directory");
    await rm(root, { recursive: true, force: true });
  });
});
