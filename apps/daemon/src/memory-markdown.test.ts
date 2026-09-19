import { describe, expect, it } from "vitest";
import { MemoryRecordSchema } from "@cc-assistant/shared";
import { parseMemoryMarkdown, serializeMemoryMarkdown } from "./memory-markdown.js";

describe("memory Markdown interchange", () => {
  it("round-trips every editable field deterministically", () => {
    const memory = MemoryRecordSchema.parse({
      id: "38f581e2-cf22-4e42-a0ca-c12fa408be8f",
      slug: "communication-style",
      title: "Communication style",
      body: "Prefer concise answers.\n\nSee [[System Settings]].",
      summary: "How to communicate with the user",
      kind: "preference",
      tags: ["user preferences", "communicated style"],
      aliases: ["Writing style"],
      project: null,
      status: "active",
      provenance: {
        sourceType: "conversation",
        sourceUri: null,
        sourceRef: "session-42",
        capturedAt: "2026-09-19T14:00:00.000Z",
      },
      createdAt: "2026-09-19T14:00:00.000Z",
      updatedAt: "2026-09-19T14:00:00.000Z",
      revision: 3,
    });
    const markdown = serializeMemoryMarkdown(memory);
    expect(parseMemoryMarkdown("memories/communication-style.md", markdown)).toMatchObject({
      id: memory.id, slug: memory.slug, title: memory.title, body: memory.body,
      revision: memory.revision, provenance: memory.provenance,
    });
    expect(serializeMemoryMarkdown(memory)).toBe(markdown);
  });

  it("rejects unknown metadata and non-Markdown paths", () => {
    const invalid = "---\ncc_memory_format: 1\nunknown: true\n---\nBody\n";
    expect(() => parseMemoryMarkdown("memory.md", invalid)).toThrow("Unknown frontmatter field");
    expect(() => parseMemoryMarkdown("memory.txt", invalid)).toThrow("must end in .md");
  });
});
