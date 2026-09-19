# Engineering handovers

These documents describe work that is not complete in the current repository. They are implementation handovers, not claims that every item is committed to the next release.

## Status vocabulary

- **Planned**: follows directly from the stated product direction or roadmap.
- **Optional adapter**: useful if its deployment requirement appears; the current path already works without it.
- **Productization**: required before the source checkout can be treated as a broadly installable application.
- **Verification only**: code exists, but a controlled external account or target operating system still must be exercised.

## Backlog

| Area | Status | Current capability | Handover |
| --- | --- | --- | --- |
| Semantic/vector memory | Planned | Standalone SQLite FTS5/BM25 wiki memory, Markdown interchange, revisioned canonical records | [Semantic memory](semantic-memory.md) |
| Agent hosts beyond Claude Code, initially Codex | Planned | Claude Code MCP, hooks, plugin, and Claude Agent SDK managed runs | [Additional agent hosts](additional-agent-hosts.md) |
| Playwright browser backend | Optional adapter | Bounded Claude-in-Chrome Calendar and Slack jobs | [Browser driver](playwright-browser-driver.md) |
| Release artifacts and cross-platform user services | Productization | Source install and macOS LaunchAgents | [Distribution and services](distribution-and-services.md) |
| Real account and macOS checks | Verification only | Implemented and covered by injected/local tests | [Live verification](live-verification.md) |

## Already implemented

Do not recreate these subsystems when starting a handover:

- durable tasks, sessions, runs, logs, approvals, schedules, notifications, memories, abilities, browser jobs, and events;
- authenticated loopback API and production dashboard serving;
- Claude Code MCP tools, project hooks, global hook installer, and plugin bundle;
- managed Claude runs, optional worktrees, bounded execution, approval callbacks, and cancellation;
- shell-free approved commands and ability invocations;
- browser-backed Calendar reads/approved creation and Slack reads/approved sending;
- macOS notification observation, macOS/Linux reminder delivery, and macOS/Linux clipboard reads;
- wiki memory revisions, links/backlinks, archive behavior, lexical search, and bounded recall;
- developer CLI and full state export.

Use [Completion audit](../completion-audit.md) for evidence and [Architecture](../architecture.md) for invariants.

## Handover discipline

Before beginning one of these projects:

1. re-run the local verification gates;
2. confirm the current shared schemas and routes rather than relying only on this prose;
3. preserve existing API shapes unless the handover explicitly calls out a migration;
4. add failure and restart behavior before adding UI polish;
5. update the handover, roadmap, installation guide, and completion audit when the project lands.
