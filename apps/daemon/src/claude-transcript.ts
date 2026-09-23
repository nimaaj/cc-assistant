import { open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative, sep } from "node:path";
import type { ClaudeSession } from "@cc-assistant/shared";

const DEFAULT_MAX_BYTES = 2_000_000;

function textFromContent(content: unknown): string[] {
  if (typeof content === "string") return content.trim() ? [content.trim()] : [];
  if (!Array.isArray(content)) return [];
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const value = block as Record<string, unknown>;
    if (value.type === "text" && typeof value.text === "string" && value.text.trim()) {
      parts.push(value.text.trim());
    } else if (value.type === "tool_use" && typeof value.name === "string") {
      parts.push(`[tool: ${value.name}]`);
    }
  }
  return parts;
}

/** Turn Claude's JSONL event stream into a bounded, readable conversation transcript. */
export function formatClaudeTranscript(jsonl: string): string {
  const output: string[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try { entry = JSON.parse(line) as Record<string, unknown>; }
    catch { continue; }
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    const message = entry.message;
    if (!message || typeof message !== "object") continue;
    const record = message as Record<string, unknown>;
    const parts = textFromContent(record.content);
    if (parts.length === 0) continue;
    const timestamp = typeof entry.timestamp === "string" ? ` ${entry.timestamp}` : "";
    output.push(`[${String(entry.type).toUpperCase()}${timestamp}]\n${parts.join("\n")}`);
  }
  return output.join("\n\n");
}

export async function readObservedClaudeTranscript(
  session: ClaudeSession,
  options: { projectsRoot?: string; maxBytes?: number } = {},
): Promise<string> {
  if (!session.transcriptPath) throw new Error("No hook-recorded transcript path is available");
  const projectsRoot = await realpath(options.projectsRoot ?? join(homedir(), ".claude", "projects"));
  const transcriptPath = await realpath(session.transcriptPath);
  const inside = relative(projectsRoot, transcriptPath);
  if (!inside || inside.startsWith(`..${sep}`) || inside === "..") {
    throw new Error("The hook-recorded transcript is outside Claude's project transcript directory");
  }
  if (basename(transcriptPath) !== `${session.id}.jsonl`) {
    throw new Error("The hook-recorded transcript filename does not match the Claude session ID");
  }

  const handle = await open(transcriptPath, "r");
  try {
    const { size } = await handle.stat();
    const maxBytes = Math.max(1, Math.min(options.maxBytes ?? DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES));
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(Math.min(size, maxBytes));
    if (buffer.length === 0) return "";
    await handle.read(buffer, 0, buffer.length, start);
    let jsonl = buffer.toString("utf8");
    if (start > 0) jsonl = jsonl.slice(Math.max(0, jsonl.indexOf("\n") + 1));
    return formatClaudeTranscript(jsonl);
  } finally {
    await handle.close();
  }
}
