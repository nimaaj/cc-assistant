# Claude session orchestration

cc-assistant can discover, inspect, message, dispatch, continue, stop, respawn, and remove Claude Code sessions on the same computer. It uses public Claude Code interfaces and keeps control actions in the same durable approval ledger as commands and browser writes.

## Two session views

The project intentionally keeps two complementary views:

1. **Observed sessions** are durable records produced by lifecycle hooks. They retain the last event even after a process disappears, but a stale hook record is not proof that a process is still alive.
2. **Claude sessions** are the current machine-readable agent-view inventory returned by `claude agents --json --all`. This is the authoritative source for live process state, background short IDs, names, blocking reasons, and supported lifecycle controls.

Managed Agent SDK runs remain a third category. They are owned by cc-assistant and already have durable run logs, budgets, permission callbacks, and cancellation.

## Supported operations

| Operation | Claude Code boundary | Approval | Notes |
| --- | --- | --- | --- |
| List | `claude agents --json --all` | No | Includes interactive sessions and current/saved background jobs |
| Read logs | `claude logs <short-id>` | No | Background sessions only |
| Message | tool-limited `claude -p` using only `ListAgents` and `SendMessage` | Yes | Target must be named and live; target inbound controls still apply |
| Dispatch | `claude --bg ... <prompt>` | Yes | Working directory must be under an allowed root |
| Continue | `claude --resume <full-session-id> --bg <prompt>` | Yes | Claude may explain that it created a copy if in-place continuation is unavailable |
| Stop | `claude stop <short-id>` | Yes | Keeps the conversation for later continuation |
| Respawn | `claude respawn <short-id>` | Yes | Restarts with the saved conversation |
| Remove | `claude rm <short-id>` | Yes | Keeps the transcript; Claude refuses unsafe worktree deletion |

The remove operation deliberately exposes no force or discard flags. If Claude Code refuses removal because a worktree contains changes, inspect and preserve the work manually.

Dispatch accepts `manual`, `auto`, or `bypassPermissions` and passes the selected value to Claude
Code's `--permission-mode` flag. Manual is the default. Bypass mode is intentionally conspicuous in
the dashboard and should be used only when the target working directory and execution environment
are independently isolated. The mode changes the spawned Claude session's own permission behavior;
it does not skip the cc-assistant approval required to dispatch it.

The dedicated main controller uses the same native mechanism. Start it with `pnpm controller:bg`,
then run `claude attach <short-id>` for a full interactive Claude Code terminal. cc-assistant does
not emulate that terminal or inject keystrokes.

## Message delivery

The daemon does not know or reproduce Claude's private inbox protocol. For each approved message it starts a short, non-interactive delivery session whose only allowed tools are `ListAgents` and `SendMessage`. The delivery prompt contains:

- the exact unique target name;
- the expected full session ID and working directory for disambiguation;
- the exact message encoded as JSON; and
- an instruction to treat the payload as inert text and send it once without rewriting it.

The receiving session decides whether to deliver, hold, or refuse the message according to its own `crossSessionInbound` setting and permission-mode relationship. A cross-session message cannot approve a pending permission, change configuration, or execute a slash command. If the target is missing, no longer live, or ambiguous, the delivery must fail rather than guessing.

For unattended sessions that should accept peer work, configure `crossSessionInbound` deliberately for that session. Do not set a global `accept` merely to make orchestration convenient.

## Approval and execution flow

1. MCP, CLI, or the dashboard submits a typed session-control request.
2. The daemon refreshes Claude's inventory and resolves the target by short ID, full session ID, or unique name.
3. The daemon creates a `command` run in `waiting_approval` plus a `claude_session_control` approval containing the normalized target and exact shell-free argument array.
4. The user inspects and approves or denies the exact payload.
5. On approval, the existing command runner invokes the fixed `claude` executable with `shell: false`, a stripped environment, an allowed working directory, output capture, and a timeout.
6. stdout, stderr, completion, and failure are stored in the run log and streamed to normal clients.

Approving a control run authorizes only that exact request. It does not approve any tool request the target session may make afterward.

## MCP tools

- `claude_session_list`
- `claude_session_logs`
- `claude_session_message`
- `claude_session_dispatch`
- `claude_session_continue`
- `claude_session_lifecycle`

A controller should list immediately before control, use IDs when names are ambiguous, inspect logs/status after approval, and report the target session's actual state instead of assuming that command exit means the delegated task is complete.

## Developer CLI

```bash
pnpm cca claude-session list [--active] [--json]
pnpm cca claude-session logs <id-or-name>
pnpm cca claude-session message <id-or-name> <message>
pnpm cca claude-session dispatch <prompt> --cwd <path> [--name <name>] [--permission-mode manual|auto|bypassPermissions]
pnpm cca claude-session continue <id-or-name> <prompt>
pnpm cca claude-session stop|respawn|remove <id-or-name>
```

Mutation commands return the proposed run and approval. Resolve it in the dashboard or with `pnpm cca approval approve <approval-id>`.

## Explicit non-goals

- no terminal keystroke injection, tmux control, or PTY scraping;
- no writes to `~/.claude/jobs`, roster files, or transcript JSONL;
- no answering a target session's permission dialog on the user's behalf;
- no force-removing a worktree with unpushed or uncommitted work;
- no claim that a hook's last event is live process state.

These boundaries keep the integration compatible with Claude Code updates and make control actions visible, reviewable, and recoverable.
