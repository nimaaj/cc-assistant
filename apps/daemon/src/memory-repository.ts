import { randomUUID } from "node:crypto";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  AssistantEventSchema,
  CreateMemorySchema,
  IngestMemorySchema,
  MemoryLinkSchema,
  MemoryRecordSchema,
  MemoryRecallResultSchema,
  MemoryRevisionSchema,
  MemorySearchHitSchema,
  UpdateMemorySchema,
  type AssistantEvent,
  type CreateMemoryInput,
  type IngestMemoryInput,
  type MemoryLink,
  type MemoryRecord,
  type MemoryRecallResult,
  type MemoryRevision,
  type MemorySearchHit,
  type MemorySummary,
  type UpdateMemoryInput,
} from "@cc-assistant/shared";

type Row = Record<string, unknown>;

export class MemoryNotFoundError extends Error {}
export class MemoryRevisionConflictError extends Error {}
export class MemorySlugConflictError extends Error {}

export interface MemoryFilters {
  status?: "active" | "archived" | undefined;
  kind?: string | undefined;
  project?: string | undefined;
  tag?: string | undefined;
  includeArchived?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface MemorySearchProvider {
  search(query: string, filters?: MemoryFilters): MemorySearchHit[];
  recall(query: string, options?: MemoryFilters & { characterLimit?: number; expandLinks?: boolean }): MemoryRecallResult;
}

function parseJsonArray(value: unknown): string[] {
  try { return JSON.parse(String(value)) as string[]; } catch { return []; }
}

function mapMemory(row: Row): MemoryRecord {
  return MemoryRecordSchema.parse({
    id: row.id,
    slug: row.slug,
    title: row.title,
    body: row.body,
    summary: row.summary ?? null,
    kind: row.kind ?? "note",
    tags: parseJsonArray(row.tags_json),
    aliases: parseJsonArray(row.aliases_json),
    project: row.project ?? null,
    status: row.status ?? "active",
    provenance: {
      sourceType: row.source_type ?? "manual",
      sourceUri: row.source_uri ?? null,
      capturedAt: row.captured_at ?? row.created_at,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
  });
}

function slugify(value: string): string {
  const slug = value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 150);
  return slug || "memory";
}

function normalized(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].sort();
}

function extractLinks(body: string): Array<{ slug: string; label: string | null }> {
  const links = new Map<string, { slug: string; label: string | null }>();
  for (const match of body.matchAll(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g)) {
    const slug = slugify(match[1] ?? "");
    const label = match[2]?.trim() || null;
    links.set(`${slug}\0${label ?? ""}`, { slug, label });
  }
  return [...links.values()];
}

function ftsExpression(query: string): string | null {
  const tokens = query.normalize("NFKC").match(/[\p{L}\p{N}_-]+/gu) ?? [];
  if (!tokens.length) return null;
  return tokens.slice(0, 20).map((token) => `"${token.replaceAll('"', '""')}"*`).join(" AND ");
}

function summarize(memory: MemoryRecord): MemorySummary {
  const { body: _body, ...summary } = memory;
  return summary;
}

export class MemoryRepository implements MemorySearchProvider {
  readonly #db: DatabaseSync;
  readonly #onEvent: ((event: AssistantEvent) => void) | undefined;

  constructor(databasePath: string, onEvent?: (event: AssistantEvent) => void) {
    this.#db = new DatabaseSync(databasePath);
    this.#onEvent = onEvent;
    this.#migrate();
  }

  close(): void { this.#db.close(); }

  #migrate(): void {
    this.#db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, body TEXT NOT NULL,
        summary TEXT, kind TEXT NOT NULL DEFAULT 'note', tags_json TEXT NOT NULL DEFAULT '[]',
        aliases_json TEXT NOT NULL DEFAULT '[]', project TEXT, status TEXT NOT NULL DEFAULT 'active',
        source_type TEXT NOT NULL DEFAULT 'manual', source_uri TEXT, captured_at TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS memory_links (
        source_id TEXT NOT NULL, target_slug TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
        PRIMARY KEY(source_id, target_slug, label), FOREIGN KEY(source_id) REFERENCES memories(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS memory_links_target_idx ON memory_links(target_slug);
      CREATE TABLE IF NOT EXISTS memory_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id TEXT NOT NULL, revision INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL, changed_at TEXT NOT NULL, source TEXT NOT NULL,
        UNIQUE(memory_id, revision), FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, source TEXT NOT NULL,
        occurred_at TEXT NOT NULL, entity_type TEXT, entity_id TEXT, payload_json TEXT NOT NULL
      );
    `);
    const columns = new Set((this.#db.prepare("PRAGMA table_info(memories)").all() as Array<{ name: string }>).map((column) => column.name));
    const additions: Array<[string, string]> = [
      ["summary", "TEXT"], ["kind", "TEXT NOT NULL DEFAULT 'note'"],
      ["aliases_json", "TEXT NOT NULL DEFAULT '[]'"], ["project", "TEXT"],
      ["status", "TEXT NOT NULL DEFAULT 'active'"], ["source_type", "TEXT NOT NULL DEFAULT 'manual'"],
      ["source_uri", "TEXT"], ["captured_at", "TEXT"],
    ];
    for (const [name, definition] of additions) if (!columns.has(name)) this.#db.exec(`ALTER TABLE memories ADD COLUMN ${name} ${definition}`);
    this.#db.exec("UPDATE memories SET captured_at=created_at WHERE captured_at IS NULL");

    const ftsColumns = (this.#db.prepare("PRAGMA table_info(memories_fts)").all() as Array<{ name: string }>).map((column) => column.name);
    const expected = ["memory_id", "title", "aliases", "summary", "body", "tags"];
    this.#transaction(() => {
      if (ftsColumns.length && ftsColumns.join(",") !== expected.join(",")) this.#db.exec("DROP TABLE memories_fts");
      this.#db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(memory_id UNINDEXED, title, aliases, summary, body, tags)");
      this.#db.exec("DELETE FROM memories_fts");
      for (const memory of this.list({ includeArchived: true, limit: 100_000 })) {
        this.#index(memory);
        this.#syncLinks(memory);
        this.#insertRevision(memory, "migration");
      }
    });
  }

  create(rawInput: CreateMemoryInput, source = "web"): MemoryRecord {
    return this.#create(CreateMemorySchema.parse(rawInput), source, "memory.created");
  }

  ingest(rawInput: IngestMemoryInput, source = "mcp"): MemoryRecord {
    return this.#create(IngestMemorySchema.parse(rawInput), source, "memory.ingested");
  }

  #create(input: ReturnType<typeof CreateMemorySchema.parse>, source: string, eventType: string): MemoryRecord {
    const now = new Date().toISOString();
    const slug = this.#availableSlug(input.slug ?? slugify(input.title));
    const memory = MemoryRecordSchema.parse({
      id: randomUUID(), slug, title: input.title, body: input.body,
      summary: input.summary ?? null, kind: input.kind, tags: normalized(input.tags),
      aliases: normalized(input.aliases), project: input.project ?? null, status: "active",
      provenance: { sourceType: input.sourceType, sourceUri: input.sourceUri ?? null, capturedAt: input.capturedAt ?? now },
      createdAt: now, updatedAt: now, revision: 1,
    });
    this.#transaction(() => {
      this.#db.prepare(`INSERT INTO memories (id,slug,title,body,summary,kind,tags_json,aliases_json,project,status,
        source_type,source_uri,captured_at,created_at,updated_at,revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(memory.id, memory.slug, memory.title, memory.body, memory.summary, memory.kind,
          JSON.stringify(memory.tags), JSON.stringify(memory.aliases), memory.project, memory.status,
          memory.provenance.sourceType, memory.provenance.sourceUri, memory.provenance.capturedAt,
          memory.createdAt, memory.updatedAt, memory.revision);
      this.#index(memory);
      this.#syncLinks(memory);
      this.#insertRevision(memory, source);
    });
    this.#event(eventType, source, memory.id, { memory });
    return memory;
  }

  get(idOrSlug: string): MemoryRecord | undefined {
    const row = this.#db.prepare("SELECT * FROM memories WHERE id=? OR slug=?").get(idOrSlug, idOrSlug) as Row | undefined;
    return row ? mapMemory(row) : undefined;
  }

  list(filters: MemoryFilters = {}): MemoryRecord[] {
    const clauses: string[] = [];
    const values: SQLInputValue[] = [];
    if (filters.status) { clauses.push("status=?"); values.push(filters.status); }
    else if (!filters.includeArchived) clauses.push("status='active'");
    if (filters.kind) { clauses.push("kind=?"); values.push(filters.kind); }
    if (filters.project) { clauses.push("project=?"); values.push(filters.project); }
    if (filters.tag) { clauses.push("EXISTS (SELECT 1 FROM json_each(tags_json) WHERE value=?)"); values.push(filters.tag.toLowerCase()); }
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    values.push(Math.min(Math.max(filters.limit ?? 100, 1), 100_000));
    values.push(Math.max(filters.offset ?? 0, 0));
    return (this.#db.prepare(`SELECT * FROM memories${where} ORDER BY updated_at DESC, slug ASC LIMIT ? OFFSET ?`).all(...values) as Row[]).map(mapMemory);
  }

  update(idOrSlug: string, rawInput: UpdateMemoryInput, source = "web"): MemoryRecord {
    const input = UpdateMemorySchema.parse(rawInput);
    const current = this.get(idOrSlug);
    if (!current) throw new MemoryNotFoundError(`Memory ${idOrSlug} was not found`);
    if (input.expectedRevision !== current.revision) throw new MemoryRevisionConflictError(`Expected revision ${input.expectedRevision}, found ${current.revision}`);
    if (input.slug && input.slug !== current.slug && this.#db.prepare("SELECT 1 FROM memories WHERE slug=?").get(input.slug)) {
      throw new MemorySlugConflictError(`Memory slug ${input.slug} is already in use`);
    }
    const updated = MemoryRecordSchema.parse({
      ...current,
      ...input,
      tags: input.tags ? normalized(input.tags) : current.tags,
      aliases: input.aliases ? normalized(input.aliases) : current.aliases,
      provenance: {
        sourceType: input.sourceType ?? current.provenance.sourceType,
        sourceUri: input.sourceUri !== undefined ? input.sourceUri : current.provenance.sourceUri,
        capturedAt: input.capturedAt ?? current.provenance.capturedAt,
      },
      updatedAt: new Date().toISOString(), revision: current.revision + 1,
    });
    this.#transaction(() => {
      this.#db.prepare(`UPDATE memories SET slug=?,title=?,body=?,summary=?,kind=?,tags_json=?,aliases_json=?,
        project=?,source_type=?,source_uri=?,captured_at=?,updated_at=?,revision=? WHERE id=?`)
        .run(updated.slug, updated.title, updated.body, updated.summary, updated.kind,
          JSON.stringify(updated.tags), JSON.stringify(updated.aliases), updated.project,
          updated.provenance.sourceType, updated.provenance.sourceUri, updated.provenance.capturedAt,
          updated.updatedAt, updated.revision, updated.id);
      this.#db.prepare("DELETE FROM memories_fts WHERE memory_id=?").run(updated.id);
      this.#index(updated);
      this.#syncLinks(updated);
      this.#insertRevision(updated, source);
    });
    this.#event("memory.updated", source, updated.id, { memory: updated });
    return updated;
  }

  archive(idOrSlug: string, expectedRevision: number, source = "web"): MemoryRecord {
    const current = this.get(idOrSlug);
    if (!current) throw new MemoryNotFoundError(`Memory ${idOrSlug} was not found`);
    if (expectedRevision !== current.revision) throw new MemoryRevisionConflictError(`Expected revision ${expectedRevision}, found ${current.revision}`);
    if (current.status === "archived") return current;
    const updated = MemoryRecordSchema.parse({ ...current, status: "archived", updatedAt: new Date().toISOString(), revision: current.revision + 1 });
    this.#transaction(() => {
      this.#db.prepare("UPDATE memories SET status='archived',updated_at=?,revision=? WHERE id=?").run(updated.updatedAt, updated.revision, updated.id);
      this.#insertRevision(updated, source);
    });
    this.#event("memory.archived", source, updated.id, { memory: updated });
    return updated;
  }

  revisions(idOrSlug: string): MemoryRevision[] {
    const memory = this.get(idOrSlug);
    if (!memory) throw new MemoryNotFoundError(`Memory ${idOrSlug} was not found`);
    return (this.#db.prepare("SELECT * FROM memory_revisions WHERE memory_id=? ORDER BY revision DESC").all(memory.id) as Row[])
      .map((row) => MemoryRevisionSchema.parse({ id: row.id, memoryId: row.memory_id, revision: row.revision,
        snapshot: JSON.parse(String(row.snapshot_json)), changedAt: row.changed_at, source: row.source }));
  }

  links(idOrSlug: string): { outgoing: MemoryLink[]; backlinks: MemoryLink[] } {
    const memory = this.get(idOrSlug);
    if (!memory) throw new MemoryNotFoundError(`Memory ${idOrSlug} was not found`);
    const outgoing = (this.#db.prepare(`SELECT l.target_slug,l.label,m.id,m.title FROM memory_links l
      LEFT JOIN memories m ON m.slug=l.target_slug WHERE l.source_id=? ORDER BY l.target_slug,l.label`).all(memory.id) as Row[])
      .map((row) => MemoryLinkSchema.parse({ slug: row.target_slug, label: row.label || null,
        resolved: Boolean(row.id), recordId: row.id ?? null, title: row.title ?? null }));
    const backlinks = (this.#db.prepare(`SELECT m.slug,m.id,m.title FROM memory_links l JOIN memories m ON m.id=l.source_id
      WHERE l.target_slug=? ORDER BY m.slug`).all(memory.slug) as Row[])
      .map((row) => MemoryLinkSchema.parse({ slug: row.slug, label: null, resolved: true, recordId: row.id, title: row.title }));
    return { outgoing, backlinks };
  }

  search(query: string, filters: MemoryFilters = {}): MemorySearchHit[] {
    const expression = ftsExpression(query);
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
    if (!expression) return this.list({ ...filters, limit }).map((memory, index) => MemorySearchHitSchema.parse({
      memory: summarize(memory), snippet: memory.summary ?? memory.body.slice(0, 240), score: 0, rank: index + 1,
    }));
    const clauses = ["memories_fts MATCH ?"];
    const args: SQLInputValue[] = [expression];
    if (filters.status) { clauses.push("m.status=?"); args.push(filters.status); }
    else if (!filters.includeArchived) clauses.push("m.status='active'");
    if (filters.kind) { clauses.push("m.kind=?"); args.push(filters.kind); }
    if (filters.project) { clauses.push("m.project=?"); args.push(filters.project); }
    if (filters.tag) {
      clauses.push("EXISTS (SELECT 1 FROM json_each(m.tags_json) WHERE value=?)");
      args.push(filters.tag.toLowerCase());
    }
    args.push(limit);
    const rows = this.#db.prepare(`SELECT m.*, snippet(memories_fts,4,'[',']',' … ',18) AS snippet,
      bm25(memories_fts,0,8,4,3,1,2) AS bm25_score FROM memories_fts JOIN memories m ON m.id=memories_fts.memory_id
      WHERE ${clauses.join(" AND ")} ORDER BY bm25_score LIMIT ?`).all(...args) as Row[];
    const queryLower = query.trim().toLowerCase();
    const filtered = rows.map((row) => {
      const memory = mapMemory(row);
      let score = -Number(row.bm25_score ?? 0);
      if (memory.title.toLowerCase() === queryLower) score += 100;
      if (memory.aliases.includes(queryLower)) score += 80;
      if (filters.project && memory.project === filters.project) score += 5;
      if (filters.tag && memory.tags.includes(filters.tag.toLowerCase())) score += 3;
      return { memory, snippet: String(row.snippet ?? memory.summary ?? ""), score };
    }).sort((a, b) => b.score - a.score || a.memory.slug.localeCompare(b.memory.slug));
    return filtered.map((hit, index) => MemorySearchHitSchema.parse({ ...hit, memory: summarize(hit.memory), rank: index + 1 }));
  }

  recall(query: string, options: MemoryFilters & { characterLimit?: number; expandLinks?: boolean } = {}): MemoryRecallResult {
    const characterLimit = Math.min(Math.max(options.characterLimit ?? 12_000, 500), 100_000);
    const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
    const hits = this.search(query, { ...options, limit });
    const records: MemoryRecord[] = hits.flatMap((hit) => {
      const memory = this.get(hit.memory.id);
      return memory ? [memory] : [];
    });
    if (options.expandLinks !== false) {
      for (const hit of hits) for (const link of this.links(hit.memory.id).outgoing) {
        if (link.recordId && !records.some((record) => record.id === link.recordId)) {
          const linked = this.get(link.recordId);
          if (linked && (linked.status === "active" || options.includeArchived || options.status === "archived")) records.push(linked);
        }
      }
    }
    const items: Array<Record<string, unknown>> = [];
    let totalCharacters = 0;
    for (const memory of records) {
      if (items.length >= limit || totalCharacters >= characterLimit) break;
      const remaining = characterLimit - totalCharacters;
      const metadata = { id: memory.id, slug: memory.slug, title: memory.title, revision: memory.revision,
        summary: memory.summary, project: memory.project, provenance: memory.provenance, updatedAt: memory.updatedAt };
      const metadataCharacters = JSON.stringify(metadata).length;
      if (remaining <= metadataCharacters) break;
      const body = memory.body.slice(0, remaining - metadataCharacters);
      items.push({ ...metadata, body, truncated: body.length < memory.body.length });
      totalCharacters += metadataCharacters + body.length;
    }
    return MemoryRecallResultSchema.parse({ query, items, totalCharacters, characterLimit });
  }

  #availableSlug(base: string): string {
    const normalizedBase = slugify(base);
    let candidate = normalizedBase;
    let suffix = 2;
    while (this.#db.prepare("SELECT 1 FROM memories WHERE slug=?").get(candidate)) candidate = `${normalizedBase.slice(0, 150)}-${suffix++}`;
    return candidate;
  }

  #index(memory: MemoryRecord): void {
    this.#db.prepare("INSERT INTO memories_fts VALUES (?,?,?,?,?,?)").run(memory.id, memory.title,
      memory.aliases.join(" "), memory.summary ?? "", memory.body, memory.tags.join(" "));
  }

  #syncLinks(memory: MemoryRecord): void {
    this.#db.prepare("DELETE FROM memory_links WHERE source_id=?").run(memory.id);
    const insert = this.#db.prepare("INSERT INTO memory_links (source_id,target_slug,label) VALUES (?,?,?)");
    for (const link of extractLinks(memory.body)) insert.run(memory.id, link.slug, link.label ?? "");
  }

  #insertRevision(memory: MemoryRecord, source: string): void {
    this.#db.prepare(`INSERT OR IGNORE INTO memory_revisions (memory_id,revision,snapshot_json,changed_at,source)
      VALUES (?,?,?,?,?)`).run(memory.id, memory.revision, JSON.stringify(memory), memory.updatedAt, source);
  }

  #transaction(work: () => void): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try { work(); this.#db.exec("COMMIT"); }
    catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }

  #event(type: string, source: string, entityId: string, payload: Record<string, unknown>): void {
    const occurredAt = new Date().toISOString();
    const result = this.#db.prepare(`INSERT INTO events (type,source,occurred_at,entity_type,entity_id,payload_json)
      VALUES (?, ?, ?, 'memory', ?, ?)`).run(type, source, occurredAt, entityId, JSON.stringify(payload));
    const row = this.#db.prepare("SELECT * FROM events WHERE id=?").get(result.lastInsertRowid) as Row;
    this.#onEvent?.(AssistantEventSchema.parse({ id: row.id, type: row.type, source: row.source,
      occurredAt: row.occurred_at, entityType: row.entity_type, entityId: row.entity_id,
      payload: JSON.parse(String(row.payload_json)) }));
  }
}
