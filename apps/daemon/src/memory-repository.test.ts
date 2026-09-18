import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRepository, MemoryRevisionConflictError } from "./memory-repository.js";

const paths: string[] = [];
function path(): string { const value = join(tmpdir(), `cc-memory-${randomUUID()}.sqlite`); paths.push(value); return value; }
afterEach(() => { for (const value of paths.splice(0)) for (const suffix of ["", "-shm", "-wal"]) rmSync(`${value}${suffix}`, { force: true }); });

describe("MemoryRepository", () => {
  it("generates collision-safe slugs, normalizes metadata, and persists across restart", () => {
    const databasePath = path();
    let store = new MemoryRepository(databasePath);
    const first = store.create({ title: "Project Orchid", body: "Canonical notes", tags: ["Work", "work", " Deploy "], aliases: ["Orchid", "orchid"] });
    const second = store.create({ title: "Project Orchid", body: "A distinct page" });
    expect(first).toMatchObject({ slug: "project-orchid", tags: ["deploy", "work"], aliases: ["orchid"], status: "active" });
    expect(second.slug).toBe("project-orchid-2");
    store.close();
    store = new MemoryRepository(databasePath);
    expect(store.get(first.id)?.body).toBe("Canonical notes");
    expect(store.list()).toHaveLength(2);
    store.close();
  });

  it("extracts unresolved links, resolves them later, and returns backlinks", () => {
    const store = new MemoryRepository(path());
    const source = store.create({ title: "Architecture", body: "See [[Release Plan]] and [[Unknown Page|later]]." });
    expect(store.links(source.id).outgoing).toMatchObject([
      { slug: "release-plan", resolved: false },
      { slug: "unknown-page", label: "later", resolved: false },
    ]);
    const target = store.create({ title: "Release Plan", body: "Ship carefully." });
    expect(store.links(source.id).outgoing[0]).toMatchObject({ slug: "release-plan", resolved: true, recordId: target.id });
    expect(store.links(target.id).backlinks).toMatchObject([{ slug: "architecture", recordId: source.id }]);
    store.close();
  });

  it("enforces revisions, keeps history, synchronizes FTS, and archives", () => {
    const store = new MemoryRepository(path());
    const created = store.create({ title: "Deploy decision", body: "Use blue green deployments.", summary: "Release approach" });
    expect(store.search("blue green")[0]?.memory.id).toBe(created.id);
    const updated = store.update(created.id, { body: "Use canary deployments instead.", expectedRevision: 1 });
    expect(() => store.update(created.id, { body: "stale", expectedRevision: 1 })).toThrow(MemoryRevisionConflictError);
    expect(store.search("blue green")).toHaveLength(0);
    expect(store.search("canary")[0]?.memory.id).toBe(created.id);
    expect(store.revisions(created.id).map((revision) => revision.revision)).toEqual([2, 1]);
    const archived = store.archive(created.id, updated.revision);
    expect(archived.status).toBe("archived");
    expect(store.search("canary")).toHaveLength(0);
    expect(store.search("canary", { status: "archived" })).toHaveLength(1);
    expect(store.list()).toHaveLength(0);
    expect(store.list({ includeArchived: true })).toHaveLength(1);
    store.close();
  });

  it("handles empty and punctuation-heavy search and deterministically bounds recall", () => {
    const store = new MemoryRepository(path());
    const linked = store.create({ title: "Linked Reference", body: "L".repeat(400) });
    const primary = store.create({ title: "C++ Quotes", body: `punctuation-safe phrase ${"P".repeat(800)} [[${linked.slug}]]`, aliases: ["compiler notes"] });
    expect(store.search(`C++ "quotes" (punctuation-safe)`)[0]?.memory.id).toBe(primary.id);
    expect(store.search("", { limit: 1 })).toHaveLength(1);
    const first = store.recall("punctuation safe", { limit: 2, characterLimit: 500, expandLinks: true });
    const second = store.recall("punctuation safe", { limit: 2, characterLimit: 500, expandLinks: true });
    expect(first).toEqual(second);
    expect(first.totalCharacters).toBeLessThanOrEqual(500);
    expect(first.items[0]).toMatchObject({ id: primary.id, truncated: true });
    store.close();
  });

  it("upgrades the original minimal memory schema without losing data", () => {
    const databasePath = path();
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`CREATE TABLE memories (id TEXT PRIMARY KEY, slug TEXT UNIQUE, title TEXT, body TEXT,
      tags_json TEXT, created_at TEXT, updated_at TEXT, revision INTEGER);
      CREATE VIRTUAL TABLE memories_fts USING fts5(memory_id UNINDEXED,title,body,tags);`);
    const id = randomUUID();
    const now = new Date().toISOString();
    legacy.prepare("INSERT INTO memories VALUES (?,?,?,?,?,?,?,?)").run(id, "legacy", "Legacy", "old searchable body", "[]", now, now, 1);
    legacy.close();
    const store = new MemoryRepository(databasePath);
    expect(store.get("legacy")).toMatchObject({ id, kind: "note", status: "active" });
    expect(store.search("searchable")[0]?.memory.id).toBe(id);
    expect(store.revisions(id)).toHaveLength(1);
    store.close();
  });

  it("applies project and tag filters before the FTS result limit", () => {
    const store = new MemoryRepository(path());
    for (let index = 0; index < 105; index += 1) {
      store.create({
        title: `Common decoy ${index}`, body: "shared search phrase", project: "other", tags: ["decoy"],
      });
    }
    const target = store.create({
      title: "Filtered target", body: "shared search phrase", project: "wanted", tags: ["important"],
    });

    expect(store.search("shared search phrase", { project: "wanted", tag: "important", limit: 1 }))
      .toMatchObject([{ memory: { id: target.id, project: "wanted", tags: ["important"] } }]);
    store.close();
  });

  it("paginates memory lists without overlap", () => {
    const store = new MemoryRepository(path());
    for (let index = 0; index < 5; index += 1) store.create({ title: `Page ${index}`, body: `Body ${index}` });
    const first = store.list({ limit: 2, offset: 0 });
    const second = store.list({ limit: 2, offset: 2 });
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(new Set([...first, ...second].map((memory) => memory.id)).size).toBe(4);
    store.close();
  });
});
