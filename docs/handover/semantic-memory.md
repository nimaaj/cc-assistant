# Handover: semantic and vector memory

**Status:** Planned. The existing lexical/wiki memory is complete; semantic retrieval is not.

## Goal

Add privacy-conscious semantic retrieval without replacing the current canonical memory records, revision history, wiki graph, filters, or deterministic context limits.

The reusable lexical/wiki functionality from the former `cc-knowledge-base` prototype is now
incorporated directly: source references, tag inventory, deterministic Markdown export/import with
dry-run conflict planning, operating documentation, and its flowchart. This repository has no
runtime, package, submodule, or installation dependency on the separate checkout. Do not create two
writable authorities for the same memory.

## Current implementation

`apps/daemon/src/memory-repository.ts` currently provides:

- canonical Markdown records in SQLite;
- optimistic revisions and immutable snapshots;
- provenance, project, kind, tags, and aliases;
- extracted wiki links and backlinks;
- FTS5 indexing and BM25-derived lexical ranking;
- deterministic boosts for exact titles, aliases, projects, and tags;
- bounded recall with optional one-hop link expansion;
- a `MemorySearchProvider` interface implemented synchronously by `MemoryRepository`.

The HTTP, MCP, CLI, and web contracts already consume search/recall results. Preserve those public result shapes where possible.

## Required product decisions

Decide these before implementation:

1. **Embedding location:** local model, user-configured remote provider, or both. Defaulting to remote embeddings would violate the current local-first expectation unless it is explicit and opt-in.
2. **Process boundary:** in-process provider versus a separate knowledge-base sidecar. A sidecar needs versioning, authentication, health, timeout, and fallback contracts.
3. **Content scope:** title/summary/body as one vector, field-specific vectors, or chunked bodies. Start with deterministic chunks if records can exceed the embedding model's useful context.
4. **Deletion policy:** archived records should be absent from active semantic results; decide whether vectors are retained for fast restoration or deleted.
5. **Model migration:** changing the embedding model or dimensions must trigger a resumable reindex rather than mixing incompatible vectors.

Recommended first release: an opt-in local embedding provider with a SQLite-backed index, lexical fallback, deterministic hybrid ranking, and no change to canonical record ownership.

## Proposed architecture

Introduce three distinct contracts:

```ts
interface EmbeddingProvider {
  readonly id: string;       // stable provider/model/config identity
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

interface SemanticIndex {
  upsert(chunks: IndexedMemoryChunk[]): Promise<void>;
  removeMemory(memoryId: string): Promise<void>;
  query(vector: number[], filters: MemoryFilters, limit: number): Promise<SemanticHit[]>;
  status(): Promise<SemanticIndexStatus>;
}

interface MemorySearchProvider {
  search(query: string, filters?: MemoryFilters): Promise<MemorySearchHit[]>;
  recall(query: string, options?: RecallOptions): Promise<MemoryRecallResult>;
}
```

The current interface is synchronous. Converting it to `Promise` results is the main internal migration; route handlers already support async work. Update every test and call site deliberately rather than hiding async behavior behind blocking subprocesses.

Recommended components:

- `LexicalMemorySearchProvider`: extracted from the current repository search logic.
- `SemanticMemorySearchProvider`: embedding plus vector-index query.
- `HybridMemorySearchProvider`: combines lexical and semantic ranks.
- `MemoryIndexingService`: observes committed memory revisions and updates the semantic index.
- `MemoryRepository`: remains the only canonical writer and revision authority.

## Index state

Each indexed unit needs at least:

```text
memory_id
memory_revision
chunk_id
chunk_ordinal
text_hash
provider_id
dimensions
vector
indexed_at
```

Index state is derived and rebuildable. It must not be included in canonical memory revision snapshots.

If using SQLite, add explicit migration tables such as `memory_embedding_models`, `memory_chunks`, and `memory_embeddings`. Do not assume a vector extension is installed on every Node-supported host. Provide a portable implementation or an actionable doctor failure.

## Indexing flow

1. Create/update/archive commits through `MemoryRepository`.
2. The repository emits the existing memory event after commit.
3. `MemoryIndexingService` records a durable indexing job keyed by memory ID and revision.
4. A single worker claims the newest revision, generates deterministic chunks, embeds them, and atomically replaces older derived rows.
5. If a newer revision appears during work, the stale result is discarded or immediately superseded.
6. Failures retain a diagnostic and retry state without rolling back the canonical memory edit.

Do not make a user memory edit wait indefinitely for an embedding service. Search should continue lexically while indexing is unhealthy or incomplete.

## Hybrid ranking

Avoid comparing raw BM25 and cosine values directly. Use a stable fusion method such as reciprocal-rank fusion:

```text
score(document) = lexical_weight / (k + lexical_rank)
                + semantic_weight / (k + semantic_rank)
```

Then apply existing exact-title/alias boosts and deterministic tie-breaking by slug or ID. Return the same bounded hit shape; adding optional diagnostic fields such as contributing ranks must remain backward-compatible.

Filters for status, project, kind, and tag must apply before final limits. Archived records remain excluded by default.

## Recall behavior

Semantic retrieval must not weaken the current context controls:

- keep record-count and character ceilings;
- include identity, revision, provenance, and timestamps;
- mark truncation;
- deduplicate chunks back to canonical records;
- fetch final bodies from `MemoryRepository`, not from stale index text;
- preserve explicit one-hop wiki-link expansion semantics;
- treat all recalled content as untrusted reference material.

## Configuration and health

Add configuration only after a provider is selected. Likely values include:

```text
CC_ASSISTANT_MEMORY_SEARCH_MODE=lexical|hybrid|semantic
CC_ASSISTANT_EMBEDDING_PROVIDER=local|...
CC_ASSISTANT_EMBEDDING_MODEL=...
CC_ASSISTANT_EMBEDDING_BATCH_SIZE=...
```

Secrets must use runtime secret storage/environment and never enter SQLite events or browser-visible configuration. Add doctor checks for provider availability, model identity, vector dimensions, backlog size, and fallback state.

## API and UI additions

Preserve existing search and recall routes. Add only what operations need:

- authenticated semantic-index status;
- explicit reindex request with progress;
- optional search-mode override for diagnosis;
- dashboard health/backlog indicator and reindex control;
- CLI status and reindex commands with JSON output.

A reindex is a potentially expensive operation but not an external side effect. It should require confirmation in the UI when replacing a large index, not the command/browser approval model.

## Migration of legacy knowledge-base content

Do not copy its SQLite database into cc-assistant blindly.

The versioned Markdown format and dry-run importer are implemented. For any content that still
exists only in a legacy checkout:

1. export selected canonical records as Markdown with metadata and provenance;
2. run `cca memory import <path>` and resolve every invalid or conflict entry;
3. apply with `cca memory import <path> --apply` so normalization, history, links, events, and live
   UI updates remain intact;
4. verify counts, slugs, links, source references, and sampled bodies;
5. stop writes to the legacy store before treating cc-assistant as authoritative.

Never copy the legacy SQLite database over `.data/assistant.sqlite`. A future semantic sidecar, if
one is chosen, must never mutate cc-assistant's canonical database directly.

## Test matrix

- deterministic chunking and text hashes;
- create/update/archive indexing lifecycle;
- stale-revision work cannot overwrite a newer index;
- crash and restart recovery for queued indexing;
- provider timeout, malformed vector, wrong dimensions, and partial batch failure;
- lexical fallback while semantic indexing is unavailable;
- model change and full resumable reindex;
- hybrid rank determinism and exact-title behavior;
- filters applied before result limits;
- recall deduplication and character limits;
- no secret persistence in events, database diagnostics, or UI;
- migration dry run, collision handling, and idempotency;
- existing lexical tests remain green.

## Rollout order

1. Extract the lexical provider without behavior changes.
2. Make search/recall internally asynchronous.
3. Add durable derived-index job state and health reporting.
4. Implement one embedding provider and portable index.
5. Add hybrid ranking behind an opt-in configuration flag.
6. Add reindex operations and UI/CLI status.
7. Run a shadow comparison that logs ranks without changing returned results.
8. Enable hybrid mode for selected projects, then make a product decision about defaults.

## Definition of done

- canonical memory ownership remains in the daemon;
- semantic indexing survives restart and revision races;
- lexical search remains available during provider failure;
- hybrid results are deterministic and respect all current filters and bounds;
- provider/model migrations are resumable and observable;
- no memory leaves the machine without explicit provider configuration;
- API, MCP, CLI, and UI preserve compatible search/recall behavior;
- migration from any separate project is dry-run capable and auditable;
- tests, typecheck, build, plugin validation, and doctor checks pass;
- architecture, configuration, installation, roadmap, and completion audit are updated.
