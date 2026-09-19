# CC Assistant

A local-first assistant control plane for Claude Code: durable state, managed agents, approvals, reminders, browser-backed work integrations, native helpers, memory, MCP, CLI, and a live web dashboard.

For a coding agent taking over the project, start with [`HANDOFF.md`](HANDOFF.md).

## Documentation

- [Installation](docs/installation.md): fresh clone through daemon, dashboard, Claude Code, browser integrations, platform helpers, verification, update, and removal.
- [Package managers](docs/package-managers.md): pnpm and npm setup, command equivalents, lockfiles, and switching rules.
- [Configuration](docs/configuration.md): environment variables, data-directory rules, authentication, and generated state.
- [Architecture](docs/architecture.md): process boundaries, trust model, persistence, and memory ownership.
- [Memory and knowledge base](docs/memory.md): wiki records, search, recall, revisions, tags, and Markdown interchange.
- [Knowledge-base operating playbook](docs/cc-assistant-knowledge-base-playbook.md): safe capture, recall, editing, and migration conventions.
- [Interactive runtime flow](docs/diagrams/cc-assistant-runtime-flow.html): source-grounded request, approval, automation, persistence, and client-update lifecycle.
- [Claude controller session](docs/controller-session.md): controller prompt loading, plugin activation, and strict sandbox mode.
- [Development guide](docs/development.md): package ownership, change workflow, verification, and safety review.
- [Engineering handovers](docs/handover/README.md): implementation-ready plans for unfinished work.
- [Completion audit](docs/completion-audit.md): implemented versus live-verified capability evidence.
- [Documentation index](docs/README.md): the complete documentation map.

## What works now

- SQLite-backed tasks, runs, approvals, schedules, notifications, memories, abilities, browser jobs, sessions, and audit events.
- Optimistic revisions to prevent agents and the UI from overwriting each other.
- Append-only task events and a live SSE event stream.
- An authenticated localhost API.
- Managed Claude Agent SDK runs with a 50-turn and $2 default ceiling, optional caller-supplied limits, git worktrees, streamed logs, cancellation, and tool approvals.
- Local commands executed as executable/argument arrays without a shell and only after explicit approval.
- One-shot, interval, and macOS-notification-triggered automations plus a durable reminder inbox.
- Standalone full-text wiki memory ingest, recall, search, tags, revision-safe editing, and Markdown export/import (no separate knowledge-base checkout required).
- Versioned ability manifests whose invocations use the command approval path.
- Bounded Claude-in-Chrome jobs for signed-in Google Calendar and Slack tabs; browser writes require approval.
- macOS/Linux desktop notifications and clipboard-image reads; macOS TIFF clipboard content is normalized to PNG.
- Claude Code MCP tools for every capability above.
- Claude Code lifecycle hooks and live session-state tracking.
- A developer CLI for state inspection, mutation, export, and raw API calls.
- A responsive dashboard for tasks, sessions, runs, approvals, reminders, notifications, memory, Calendar/Slack jobs, trigger rules, safe command proposals, abilities, clipboard images, and a validated raw state studio.

## Requirements

- Node.js 24 LTS
- pnpm 11 or newer (recommended), or npm 11 or newer
- Claude Code 2.1.257 or newer (2.1.275 or newer recommended)

For a fresh machine, follow the full [installation guide](docs/installation.md). The abbreviated development path is:

## Quick development start

```bash
pnpm install
pnpm build
pnpm dev
```

Or use the npm workflow included with Node.js:

```bash
npm ci
npm run build
npm run dev
```

Use one package manager per checkout. See [Package managers](docs/package-managers.md) for every
command equivalent and the lockfile policy.

In development, the daemon listens on `127.0.0.1:4317` and Vite serves the hot-reloading dashboard on [http://127.0.0.1:4318](http://127.0.0.1:4318).

On first launch, the daemon generates `.data/access-token`. Paste its contents into the dashboard login screen. The browser receives an HTTP-only, same-site cookie; the token is not stored in browser JavaScript storage.

After building and starting the daemon, run the read-only readiness check:

```bash
pnpm assistant:doctor
```

It verifies build/plugin artifacts, Node and Claude Code, private token permissions, daemon authentication, Claude-in-Chrome worker state, and platform-native helpers. Use `pnpm assistant:doctor --offline` when inspecting a package before starting the daemon, or `--json` for scripts.

## Start the production service

```bash
pnpm build
pnpm start
```

The production daemon serves both the authenticated API and the built dashboard at [http://127.0.0.1:4317](http://127.0.0.1:4317). No Vite process is required. The macOS LaunchAgent uses this production entrypoint, so the dashboard remains available after login whenever that service is installed.

## Connect Claude Code

The committed `.mcp.json` registers the built MCP bridge for this project. Build the project and keep the daemon running, then restart Claude Code from this directory and check `/mcp`.

The MCP bridge reads the same `.data/access-token` file as the daemon. Its tools cover tasks, observed sessions, live Claude session inventory/control, managed runs, command proposals, approvals, schedules/reminders, memory, abilities, clipboard images, Calendar, Slack, and browser-job polling. Restart Claude Code after rebuilding so it reloads the tool list.

For a dedicated controlling session, use:

```bash
pnpm controller
```

To run that controller as a native background Claude Code session and attach to its terminal later:

```bash
pnpm controller:bg                 # manual permission mode
pnpm controller:bg:auto            # automatic mode
pnpm controller:bg:bypass          # bypass mode; isolated environments only
# Claude prints an ID, then:
claude attach <id>
```

To enable Claude Code's built-in Bash sandbox with no unsandboxed fallback and a hard failure when isolation is unavailable:

```bash
pnpm controller:sandbox
```

Both launchers load the canonical controller operating guide through `CLAUDE.md` and initialize with a read-only state snapshot. See the [controller-session guide](docs/controller-session.md) for the exact policy, Linux dependencies, plugin skill, and verification steps.

The daemon must remain running for the tools to work. The MCP bridge is intentionally small and contains no durable state.

For use across projects, build and validate the self-contained Claude Code plugin bundle:

```bash
pnpm plugin:build
pnpm plugin:validate
claude --plugin-dir ./claude-plugin
```

The plugin packages the MCP bridge and lifecycle hooks, but the durable daemon remains a separate local service. It uses the current project's `.data` token when present and otherwise the platform application-data directory; set `CC_ASSISTANT_DATA_DIR` when using a different service location.

Managed agent runs prefer the signed-in Claude Code subscription so an unrelated inherited `ANTHROPIC_API_KEY` does not silently select a different billing account. Set `CC_ASSISTANT_AGENT_USE_CLAUDE_LOGIN=false` when API-key billing is intentional.

## Observe Claude Code sessions

Project hooks in `.claude/settings.json` forward lifecycle events to the daemon. Claude Code may ask you to approve these hooks after the configuration changes. Use `/hooks` to confirm they are loaded.

After approval, submitting a prompt or using a tool updates the **Observed sessions** strip in the dashboard. The hooks are best effort: if the daemon is unavailable they exit successfully and never interrupt Claude Code.

To observe Claude Code sessions in every project, install the same additive hooks in your user settings:

```bash
pnpm hooks:install-global
```

The installer preserves existing hooks and creates `~/.claude/settings.json.cc-assistant-backup`. Undo it with `pnpm hooks:remove-global`. Restart existing Claude sessions after installation; a session that never emits a hook cannot be discovered retroactively.

## Orchestrate Claude Code sessions

The dashboard's **Claude sessions** section and the `claude_session_*` MCP tools use Claude Code's supported agent-view interfaces. Reads come from `claude agents --json --all` and `claude logs`. Mutations can dispatch, message, continue, stop, respawn, or remove background sessions. Every mutation first creates a durable approval showing the exact target and command; approving it does not bypass the target session's own permission or inbound-message policy.

```bash
pnpm cca claude-session list
pnpm cca claude-session logs <id-or-name>
pnpm cca claude-session message <id-or-name> "Status update?"
pnpm cca claude-session dispatch "Investigate the failing test" --cwd "$PWD" --name test-worker
pnpm cca claude-session stop <id-or-name>
```

Messages use Claude Code's native `ListAgents`/`SendMessage` boundary. The daemon never injects terminal keystrokes and never edits `~/.claude/jobs` or transcript files. See [Claude session orchestration](docs/claude-session-orchestration.md) for the supported operations and safety model.

## Direct state control

The dashboard's **State studio** and the `cca` command manipulate state through the same validated
daemon API used by MCP. Neither opens SQLite directly, so schema validation, optimistic revisions,
audit events, and SSE updates are preserved. State studio shows a complete aggregate snapshot and
offers a developer-facing GET/POST/PATCH/DELETE API console for `/api/*` routes.

The repository-local CLI reads `.data/access-token` by default; `CC_ASSISTANT_DATA_DIR` can point it at a service installation instead.

```bash
pnpm cca status
pnpm cca task list
pnpm cca task create "Investigate the failing build" --project assistant --priority 1
pnpm cca task focus <task-id> --revision 1
pnpm cca task update <task-id> --status blocked --description "Waiting for access"
pnpm cca session list --all
pnpm cca run agent "Investigate tests" --prompt "Find and fix the failing tests" --cwd "$PWD" --worktree
pnpm cca run command "Check git status" git status
pnpm cca approval list --status pending
pnpm cca approval approve <approval-id>
pnpm cca memory create project-orchid "Project Orchid" --body "Important context"
pnpm cca memory export --output ./memory-export --all
pnpm cca memory import ./memory-export          # preview
pnpm cca memory import ./memory-export --apply
pnpm cca schedule create "Stand up" --trigger-kind interval --trigger '{"everyMs":3600000}' --action-kind reminder --action '{"title":"Stand up","body":"Move for five minutes"}'
pnpm cca browser calendar list
pnpm cca browser calendar create '{"title":"Review","start":"2026-09-17T13:00:00.000Z","end":"2026-09-17T13:30:00.000Z"}'
pnpm cca browser slack send general "Draft status is ready"
pnpm cca native clipboard-image --output /tmp/clipboard.png
pnpm cca event list --limit 25
pnpm cca state export --json
pnpm cca api GET /api/tasks --json
```

Add `--json` to any command for scripts. `cca api` is the authenticated escape hatch for newly added daemon endpoints before they receive a dedicated CLI command.

The CLI deliberately does not write directly to SQLite. Direct database writes would bypass validation, revisions, audit events, and live dashboard updates.

## Google Calendar and Slack through Chrome

There is deliberately no Calendar or Slack API credential path and no cc-assistant browser extension. Install and sign in to Claude Code's official **Claude in Chrome** integration, then keep signed-in `calendar.google.com` and `app.slack.com` tabs available in that Chrome profile. The daemon invokes the Agent SDK with Chrome enabled for each narrow job.

Read jobs execute in the visible browser profile. Creating a calendar event or sending a Slack message first appears in the dashboard approval queue. The worker receives only Claude-in-Chrome tools, the exact validated job, a turn limit, and a spending cap. It treats rendered content as untrusted and fails closed on missing tabs, login screens, ambiguous targets, or unverifiable writes rather than reporting an empty calendar or pretending a message was sent. A write is not recorded as successful unless the structured result explicitly contains `data.created=true` or `data.sent=true` for the corresponding operation.

The dashboard's **Calendar & Slack** section starts read jobs and proposes exact writes. Recent jobs retain their structured result or diagnostic. The same page also manages time and notification triggers, proposes shell-free local commands, installs and invokes ability manifests, and previews a local clipboard image; all command-like operations still pass through the persisted one-time approval queue.

Defaults are intentionally bounded and can be changed in the daemon environment:

```bash
CC_ASSISTANT_BROWSER_MODEL=sonnet
CC_ASSISTANT_BROWSER_EFFORT=low
CC_ASSISTANT_BROWSER_MAX_TURNS=12
CC_ASSISTANT_BROWSER_MAX_BUDGET_USD=1.00
```

Browser workers prefer the signed-in Claude Code subscription by default, so an unrelated inherited `ANTHROPIC_API_KEY` does not override the account used by the official Chrome integration. Set `CC_ASSISTANT_BROWSER_USE_CLAUDE_LOGIN=false` if API-key billing is intentional. Set `CC_ASSISTANT_BROWSER_ENABLED=false` to disable browser execution. Playwright is a possible future adapter for isolated test profiles, but it is not required and the app never asks for a second extension.

Calendar creation requires explicit ISO `start` and `end` timestamps, with the end after the start. Slack channel selection is exact rather than substring-based so a message cannot silently go to a similarly named channel. The daemon validates each adapter/action payload even when it arrives through `cca api`.

For controlled-account release testing, `pnpm smoke:browser:e2e --reads` exercises both read paths. Live writes require all exact Calendar and Slack inputs plus the literal `--confirm LIVE_WRITES_APPROVED`; see `pnpm smoke:browser:e2e --help`. The runner creates external data and does not clean it up automatically.

## macOS notification triggers

Time triggers run inside the daemon. On macOS, visible Notification Center banners can also feed trigger rules through the opt-in Accessibility watcher:

```bash
pnpm native:watch-notifications
```

macOS will request Accessibility permission for the terminal running the watcher. A `system_notification` trigger requires at least one `app`, `title`, or `body` substring and has a default 60-second cooldown. The watcher makes a best-effort extraction of the source app, title, and body from the visible banner. This adapter is experimental because Notification Center accessibility structure can change between macOS releases.

The watcher waits for a successful daemon response before marking a visible banner as delivered. Network failures and daemon-startup races are logged and retried while that banner remains visible; schedule cooldowns prevent a successful delivery from looping immediately.

For persistent per-user services on the Mac, build once and install the generated LaunchAgents:

```bash
pnpm build
pnpm macos:services:dry-run
pnpm macos:services:install
```

The installer compiles the watcher, starts both the daemon and watcher at login, keeps logs under `.data`, and never installs a system-wide daemon. Grant Accessibility permission to `.data/bin/notification-watcher` after installation. Remove both services with `pnpm macos:services:remove`.

Schedule trigger and action payloads are validated when they are created or edited, rather than waiting until their fire time. Schedule edits require the last-read revision, like task and memory edits.

## Ability manifests

Version-1 ability manifests live in [`abilities`](./abilities). They declare metadata, a JSON Schema input contract, and one shell-free command template. Installing an ability does not grant execution permission; each invocation becomes a normal command approval.

## Wiki memory

Memory pages are canonical Markdown records with a stable slug, optional summary/project, extensible kind, normalized tags and aliases, provenance, archive status, timestamps, and an optimistic revision. Write links as `[[Page Slug]]` or `[[Page Slug|label]]`; links can remain unresolved and automatically resolve when that slug is later created. Every revision is retained, and outgoing links/backlinks are queryable.

`memory search` returns compact FTS5/BM25-ranked hits and snippets. `memory recall` returns a deterministic, character-bounded context bundle labeled with IDs, revisions, provenance, and timestamps. It can expand one link hop but never dumps the entire database. Memory content is always untrusted reference material and is never executed. The `MemorySearchProvider` interface is the seam for a future local or remote semantic provider; this version uses no embeddings or external service.

```bash
pnpm cca memory create "Release plan" --body-file ./release.md --tag project --alias rollout
pnpm cca memory search 'release "canary"'
pnpm cca memory recall "release approach" --project assistant --limit 5 --characters 12000
pnpm cca memory update release-plan --revision 1 --body-file ./release-v2.md
pnpm cca memory links release-plan
pnpm cca memory revisions release-plan
pnpm cca memory archive release-plan --revision 2
```

When the daemon is stopped, backing up `.data/assistant.sqlite` is sufficient. While it is running in WAL mode, use SQLite’s online backup command (for example `sqlite3 .data/assistant.sqlite '.backup /safe/path/assistant-backup.sqlite'`) rather than copying only the main file; active changes may still be in `-wal`.

## Verification

`pnpm test` runs repository/API/integration tests, including an injected Claude-in-Chrome stream that verifies tool isolation, structured results, and limits without touching live accounts. `pnpm typecheck` first refreshes internal package declarations and then checks every workspace package. `pnpm build` produces all daemon, MCP, CLI, and web artifacts.

`pnpm assistant:doctor` is the final local preflight. It is diagnostic only: it does not install services, access Calendar or Slack content, read the clipboard, or perform account writes.

See [`docs/completion-audit.md`](./docs/completion-audit.md) for the requirement-by-requirement evidence matrix and the live checks that require signed-in accounts or a macOS host.

## Workspace layout

```text
apps/daemon       Persistent local API, task store, and event stream
apps/cli          Developer-facing state CLI
apps/mcp          Claude Code stdio MCP bridge
apps/web          React dashboard
claude-plugin     Installable Claude Code MCP and hook package
native/macos      Opt-in Notification Center observer
abilities         Manifest specification and examples
packages/client   Authenticated daemon client
packages/shared   Shared schemas and domain types
docs              Installation, operations, architecture, audits, roadmap, and unfinished-work handovers
```

## Security properties

- The daemon binds to loopback by default and rejects unexpected Host headers.
- API access requires either the local bearer token or an HTTP-only session cookie.
- Token comparison is constant-time.
- The SQLite database contains assistant state and audit events, not account credentials or browser cookies.
- MCP and web updates include an audit source.
- Shell parsing is disabled for commands and ability invocations.
- Secret-looking and execution-control environment variables are stripped from child command environments; callers cannot override values such as `PATH` or `NODE_OPTIONS`.
- The approval UI exposes the exact persisted command, browser, or Claude tool payload before the user decides.
- Calendar/Slack writes and all local commands require a persisted one-time approval.
- Browser workers cannot use shell or file tools and receive a per-job turn and cost ceiling.

This is an early local build. Do not expose the daemon port through a tunnel or bind it to a LAN interface.
