# Development guide

This guide explains where changes belong and how to hand them across process boundaries safely.

## Design rules

1. The daemon is the only owner of durable state.
2. Every external payload is validated with shared Zod schemas.
3. Persist state before publishing an event.
4. Use optimistic revisions for user-editable records.
5. Treat browser content, memories, hooks, and integration output as untrusted data.
6. Never execute a command through a shell; preserve executable and argument boundaries.
7. Require a persisted, inspectable approval before local commands or externally visible browser writes.
8. Keep host-specific behavior in adapters. Do not make the durable domain model depend on Claude Code.

## Workspace dependency direction

```text
packages/shared
   ^       ^
   |       |
packages/client     apps/daemon
   ^                    ^
   |                    |
apps/cli             HTTP/SSE
apps/mcp                |
claude-plugin        apps/web
```

- `packages/shared` contains wire contracts and must not import app packages.
- `packages/client` knows authentication and HTTP, not domain persistence.
- `apps/daemon` owns repositories and services.
- `apps/mcp`, `apps/cli`, and `apps/web` are API clients, not alternate databases.
- `claude-plugin/server/index.mjs` is a generated, committed bundle of `apps/mcp`.

## Where to make a change

| Change | Primary files | Usually also update |
| --- | --- | --- |
| Domain field or request shape | `packages/shared/src/index.ts` | Repository migration, API, client UI, MCP, CLI, tests |
| Durable task/session/run behavior | Repository under `apps/daemon/src` | Route tests and completion audit |
| Agent execution | `execution-service.ts` | Shared run schema, approval UI, handover docs |
| Calendar/Slack job behavior | `browser-automation-service.ts` | Shared browser schemas, live E2E script, security docs |
| MCP tool | `apps/mcp/src/index.ts` | Shared schemas, plugin bundle, MCP smoke |
| CLI command | `apps/cli/src/index.ts` | Help text, README examples, CLI tests |
| Dashboard control | `apps/web/src/App.tsx`, `api.ts`, `styles.css` | API tests and accessibility states |
| Ability format | Shared schemas and `automation-service.ts` | `abilities/README.md`, example manifest, tests |
| Configuration variable | `apps/daemon/src/config.ts` | `.env.example`, `docs/configuration.md`, doctor checks |
| Claude lifecycle event | `.claude/settings.json`, hook scripts | Plugin hooks and session tests |

## Setup

Follow [Installation](installation.md) through the offline doctor, then run:

```bash
pnpm dev
```

Use a second terminal for checks and CLI calls. The Vite dashboard runs on port 4318 and proxies API requests to the daemon on port 4317.

## Standard verification

Run these before handing off a code change:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm plugin:build
pnpm plugin:validate
pnpm assistant:doctor --offline
```

With a local daemon running:

```bash
pnpm assistant:doctor
CC_ASSISTANT_DATA_DIR=.data node scripts/mcp-smoke.mjs
```

Do not run signed-in browser writes as part of an ordinary automated test. The injected Agent SDK tests cover contracts without external side effects; controlled live checks are documented in [Live verification](handover/live-verification.md).

## Database changes

Repositories currently apply idempotent SQLite migrations during construction.

For a schema change:

1. add the new table, index, or guarded column migration;
2. make old rows readable with explicit defaults;
3. update the shared schema;
4. add a test that opens an old fixture or schema, migrates it, closes it, and reopens it;
5. preserve WAL-aware backup guidance;
6. never let a UI, CLI, or MCP process write the database directly.

## Adding an API capability

The usual vertical slice is:

1. define input/output schemas in `packages/shared`;
2. implement a repository or service operation in the daemon;
3. expose an authenticated Fastify route in `apps/daemon/src/app.ts`;
4. emit an audit event after persistence;
5. add a typed client call where useful;
6. add MCP, CLI, and web surfaces according to the use case;
7. test authentication, validation, not-found behavior, conflicts, persistence, and event emission;
8. update the architecture, configuration, and completion audit as applicable.

## Generated artifacts

Most `dist` directories are ignored and rebuilt locally. One exception is the Claude plugin server bundle:

```bash
pnpm plugin:build
```

Commit `claude-plugin/server/index.mjs` whenever the MCP source or its bundled dependencies change. Validate the complete plugin with `pnpm plugin:validate`.

## Safety review checklist

Before merging a capability that can act on the machine or an external account, confirm:

- exact targets are visible before approval;
- approval cannot be reused for a changed payload;
- commands use `spawn(executable, args, { shell: false })` or an equally strict boundary;
- secret-like environment values are not persisted or forwarded;
- browser output must prove the requested write succeeded;
- ambiguity, login pages, missing tabs, and changed UI fail closed;
- retries cannot duplicate an external write silently;
- restart recovery has a deterministic state transition;
- tests do not require a real account by default.

## Documentation handoff

If implementation stops before completion, update or add a document under `docs/handover`. A useful handover must name the current seams, invariants, proposed data/API changes, migration strategy, test matrix, rollout order, and definition of done. Avoid leaving only a broad TODO in source code.
