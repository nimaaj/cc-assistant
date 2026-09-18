# Completion audit

This matrix distinguishes implementation evidence from environment-dependent live verification. A checked roadmap item means its local implementation and automated contract are present; it does not imply that a signed-in third-party account or unavailable operating system was exercised.

| Requirement | Implementation evidence | Verification evidence | Status |
| --- | --- | --- | --- |
| Track current tasks | `TaskRepository`, authenticated task API, MCP tools, CLI, dashboard board | Repository revision/conflict tests, API lifecycle test, live CLI/MCP smoke | Verified locally |
| Spin off agents | Claude Agent SDK execution service, persisted runs/logs, permission callback, limits, cancellation, optional worktree, and fail-closed terminal-result handling | Permission/recovery/worktree/no-result tests plus authenticated Claude Code-login run `b32f158b-77ca-4e2d-aebc-68666c2e6096` | Verified locally and live |
| Run commands locally | Persisted one-time approval, allowlisted real working roots, `spawn` with `shell: false`, secret/control env filtering, timeout escalation, logs/cancellation | API execution test plus rejection, cancellation, forced-timeout, and restart tests | Verified locally |
| Check Google Calendar without its API | Approved/read-only browser job contracts and bounded Claude-in-Chrome worker with visible-event, date/view, verified-create instructions, and mandatory `data.created=true` success proof | Shared validation, injected Agent SDK stream/tool-isolation and missing-proof failure tests, and signed-in read-only Calendar smoke on 2026-09-17 | Read path verified live; approved create remains intentionally untested |
| Send reminders | Durable `at`/`interval` scheduler, web inbox, best-effort native notification | API fire test and overdue one-shot restart test | Verified locally while daemon is running |
| Monitor Claude Code sessions | Project/global additive hooks, durable session state, dashboard and MCP/CLI inspection | Lifecycle tests; installed nine global hooks; live CLI observed active and ended Claude sessions | Verified locally and live |
| Wiki-style memory | Records, provenance, revisions, archive, wiki links/backlinks, FTS5/BM25, bounded recall, UI/MCP/CLI | Migration, persistence, collision, graph, conflict, archive, pagination, pre-limit filters, and recall-limit tests | Verified locally |
| Read clipboard image | macOS JXA with TIFF-to-PNG normalization and Linux Wayland/X11 adapters; MCP image result and CLI file output | Injected macOS PNG/conversion-path and Linux fallback tests | Implemented; physical macOS clipboard check pending |
| Slack without its API | Claude-in-Chrome read unreads/channel, exact channel targeting, approved exact send, and mandatory `data.sent=true` success proof | Shared validation, injected Agent SDK stream/tool-isolation and missing-proof failure tests, and signed-in unread smoke on 2026-09-17 | Read path verified live; approved send remains intentionally untested |
| Standardized new abilities | Versioned manifest, strict documented input-schema subset, interpolation without shell, normal command approval | Validation, invalid-keyword/required-property rejection, and proposal tests | Verified locally |
| Time/system-notification triggers | Validated trigger/action contracts, durable next-run state, cooldown, in-process loop guard, and macOS Accessibility watcher that retries until the daemon acknowledges delivery | Notification match/cooldown and watcher retry-contract tests; Swift source syntax is exercised on macOS install | Implemented; Notification Center check requires macOS Accessibility permission |
| Web UI | Tasks, reminders, managed runs, exact approval payloads, notifications, sessions, memory workspace, Calendar/Slack jobs, trigger management, command proposals, abilities, clipboard preview, and Claude-in-Chrome worker state; the daemon serves the built UI in production | Static-shell/asset/auth boundary tests, Web API contract tests, production Vite build, doctor check, and local dashboard DOM/visual smoke with no console errors | Verified locally |
| MCP tools | Typed tools for all supported domains through the authenticated daemon | MCP stdio smoke enumerates tools and reaches live daemon | Verified locally |
| Developer state control | `cca` commands, JSON output, paginated full state export, raw authenticated API escape hatch | Pagination unit tests plus live `cca status --json` against daemon | Verified locally |

## Required live checks

1. Run `pnpm assistant:doctor`, then `pnpm smoke:browser:e2e -- --help` and invoke its guarded write mode with a disposable event and safe test channel. The signed-in read paths already passed; writes remain manual because they create external side effects.
2. On macOS, run `pnpm macos:services:install`, grant Accessibility permission to the compiled watcher, test a matching notification trigger, and test a real clipboard image.

## Automated gates

```bash
pnpm test
pnpm typecheck
pnpm build
CC_ASSISTANT_DATA_DIR=.data node scripts/mcp-smoke.mjs
```

All three local gates pass after the Claude-in-Chrome replacement and full dashboard control-surface work. The MCP smoke requires a running local daemon. Signed-in Calendar and Slack reads and a bounded managed Claude run passed; account writes and macOS-only behavior remain explicit manual checks because they create external side effects or require unavailable hardware/permissions.
