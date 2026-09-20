# Documentation

This directory is the source of truth for operating, extending, and handing over cc-assistant.

## Start here

| Goal | Document |
| --- | --- |
| Hand the whole project to another coding agent | [Continuation handoff](../HANDOFF.md) |
| Install from a fresh clone | [Installation](installation.md) |
| Use npm instead of pnpm | [Package managers](package-managers.md) |
| Configure paths, ports, limits, and browser workers | [Configuration](configuration.md) |
| Understand the system boundaries and data ownership | [Architecture](architecture.md) |
| Use or migrate the standalone wiki knowledge base | [Memory and knowledge base](memory.md) |
| Follow the memory capture/edit operating conventions | [Knowledge-base playbook](cc-assistant-knowledge-base-playbook.md) |
| Explore the knowledge-base data flow | [Knowledge-base flowchart](diagrams/cc-knowledge-base-swimlane-flow.html) |
| Explore the runtime request and automation lifecycle | [Interactive runtime flow](diagrams/cc-assistant-runtime-flow.html) |
| Run the controlling Claude session or enable strict sandbox mode | [Claude controller session](controller-session.md) |
| Use the simplified UI and understand dispatcher routing | [Simplified dashboard and dispatcher](dispatcher.md) |
| Manage and orchestrate local Claude Code sessions | [Claude session orchestration](claude-session-orchestration.md) |
| Work on the codebase | [Development guide](development.md) |
| See implemented and verified capabilities | [Completion audit](completion-audit.md) |
| See the product roadmap | [Roadmap](roadmap.md) |
| Continue unfinished work | [Engineering handovers](handover/README.md) |

## Document status

- `installation.md`, `package-managers.md`, `configuration.md`, `development.md`, and `memory.md` describe the current repository.
- `architecture.md` records current runtime boundaries and invariants.
- `controller-session.md` records controller prompt loading and the opt-in Claude Code sandbox policy.
- `dispatcher.md` records the simplified view, dispatch envelope, result contract, and triggered dispatch lifecycle.
- `completion-audit.md` separates implemented code from environment-dependent live verification.
- `roadmap.md` is the concise backlog. Detailed designs live under `handover/`.
- `build-memory-system-prompt.md` is retained as historical implementation context. Its lexical/wiki-memory scope is complete; it is not an active task list.

## Repository map

| Path | Responsibility |
| --- | --- |
| `apps/daemon` | Local API, SQLite ownership, scheduling, approvals, command execution, managed agents, and browser-job orchestration |
| `apps/mcp` | Claude Code stdio MCP adapter; contains no durable state |
| `apps/cli` | Developer-facing state inspection and mutation through the daemon API |
| `apps/web` | React dashboard for the same API |
| `packages/shared` | Zod schemas and domain types shared across process boundaries |
| `packages/client` | Authenticated daemon client used by local adapters |
| `claude-plugin` | Self-contained Claude Code MCP bundle and lifecycle hooks |
| `abilities` | Versioned, data-only ability manifests and examples |
| `native/macos` | Optional Notification Center watcher |
| `scripts` | Health checks, hook installation, browser smoke tests, and service installation |
| `docs/handover` | Implementation-ready designs for work that is not built yet |
| `docs/diagrams` | Standalone interactive architecture and runtime diagrams |

## Documentation maintenance rule

When behavior changes, update the smallest authoritative document:

1. update `architecture.md` for boundary or ownership changes;
2. update `configuration.md` for any environment variable or default;
3. update `installation.md` for setup, service, or prerequisite changes;
4. update `completion-audit.md` with actual verification evidence;
5. update the relevant handover and `roadmap.md` when unfinished work changes scope.

Do not mark a live integration as verified only because its mocked or injected tests pass.
