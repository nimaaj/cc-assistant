# Configuration

cc-assistant is configured through environment variables. The repository's `.env.example` is a reference file; the current scripts do not automatically load `.env`. Export values in the shell or configure them in the process supervisor before starting the daemon, CLI, MCP bridge, or installer.

Claude Code controller settings are separate from daemon environment variables. The shared hook
configuration lives in `.claude/settings.json`. The launchers pass either
`.claude/controller.settings.json` or the strict opt-in
`.claude/controller-sandbox.settings.json` through Claude Code's `--settings` flag. Both explicitly
enable only the project MCP servers declared by this checkout so non-interactive background starts
do not wait at a trust prompt. See [the controller-session guide](controller-session.md).
Background controller launchers select Claude Code permission modes with CLI arguments rather than
daemon environment variables; `manual` is the default, with explicit `auto` and
`bypassPermissions` profiles.

## Runtime variables

| Variable | Default | Consumer | Meaning |
| --- | --- | --- | --- |
| `CC_ASSISTANT_DATA_DIR` | Platform app-data directory in the daemon; repository `.data` in project scripts | Daemon, client, CLI, MCP, hooks, scripts | Directory containing `assistant.sqlite`, `access-token`, logs, worktrees, and installed helper artifacts |
| `CC_ASSISTANT_HOST` | `127.0.0.1` | Daemon | Bind address. Keep loopback unless remote authentication and transport security are designed first |
| `CC_ASSISTANT_PORT` | `4317` | Daemon | API and production-dashboard port |
| `CC_ASSISTANT_DAEMON_URL` | `http://127.0.0.1:4317` | Client, MCP, hooks, scripts | Base URL used to reach the daemon |
| `CC_ASSISTANT_TOKEN` | Generated token file | Daemon and clients | Explicit bearer-token override. Prefer the private token file for normal local use |
| `CC_ASSISTANT_ALLOWED_ROOTS` | Initial working directory | Daemon | Path-delimited list of roots in which commands and managed agents may run |
| `CC_ASSISTANT_AGENT_USE_CLAUDE_LOGIN` | `true` | Managed agent runtime | Removes an inherited `ANTHROPIC_API_KEY` so the signed-in Claude Code account is preferred |
| `CC_ASSISTANT_BROWSER_ENABLED` | `true` | Browser worker | Enables Calendar and Slack job execution |
| `CC_ASSISTANT_BROWSER_USE_CLAUDE_LOGIN` | `true` | Browser worker | Prefers the signed-in Claude Code account over an inherited API key |
| `CC_ASSISTANT_BROWSER_MODEL` | `sonnet` | Browser worker | Model identifier passed to the bounded browser worker |
| `CC_ASSISTANT_BROWSER_EFFORT` | `low` | Browser worker | `low`, `medium`, or `high` |
| `CC_ASSISTANT_BROWSER_MAX_TURNS` | `12` | Browser worker | Per-job turn ceiling, from 1 through 50 |
| `CC_ASSISTANT_BROWSER_MAX_BUDGET_USD` | `1` | Browser worker | Per-job budget ceiling, from 0.01 through 10 USD |
| `CC_ASSISTANT_MCP_ENTRY` | `apps/mcp/dist/index.js` | MCP smoke script | Alternate MCP entrypoint for packaging tests |

## Data-directory rules

The most common setup error is allowing different processes to select different data directories.

Repository commands deliberately use `<checkout>/.data`:

- `pnpm dev`
- `pnpm start`
- `pnpm cca ...`
- repository-local `.mcp.json`
- smoke and doctor scripts unless overridden

The raw daemon defaults to a platform application-data directory when launched directly:

```text
macOS: ~/Library/Application Support/cc-assistant
other Unix-like systems: ~/.local/share/cc-assistant
```

Choose one directory for a deployment and pass the same absolute path to the daemon, MCP/plugin, CLI, and global hooks.

## Allowed working roots

Commands and managed agents can only use an existing real directory within `CC_ASSISTANT_ALLOWED_ROOTS`. Entries use the operating system path delimiter:

```bash
# Linux and macOS
export CC_ASSISTANT_ALLOWED_ROOTS=/home/me/code:/home/me/notes
```

Symlinks are resolved before containment is checked. Adding a broad root increases the impact of an accidentally approved command; prefer the smallest practical project roots.

## Authentication

On first daemon start, a random token is written to `<data-dir>/access-token` with user-only permissions. Clients may authenticate with that token directly; the web login exchanges it for an HTTP-only cookie.

Do not:

- commit the token;
- place it in an ability manifest;
- pass it as an argument to a managed command;
- store browser cookies in SQLite;
- bind the daemon to a non-loopback interface without a separate security design.

Rotating the token currently means stopping every client, replacing the token file or explicit `CC_ASSISTANT_TOKEN`, and restarting the daemon and clients together.

## Example shell configuration

For a production-style source checkout:

```bash
export CC_ASSISTANT_DATA_DIR=/absolute/path/to/cc-assistant/.data
export CC_ASSISTANT_DAEMON_URL=http://127.0.0.1:4317
export CC_ASSISTANT_ALLOWED_ROOTS=/absolute/path/to/workspace
export CC_ASSISTANT_BROWSER_MAX_BUDGET_USD=0.50
pnpm start
```

Environment changes require a daemon restart. MCP-only path changes also require restarting Claude Code so it respawns the bridge.

## State and generated files

| Path under the data directory | Owner | Backup expectation |
| --- | --- | --- |
| `assistant.sqlite` plus WAL files | Daemon | Use SQLite online backup while running |
| `access-token` | Daemon | Treat as a secret; back up only when clients must retain access |
| `worktrees/` | Managed-run service | Ephemeral working copies; source branches remain in their repositories |
| `bin/notification-watcher` | macOS installer | Rebuild from source rather than treating as primary data |
| `*.log` | Service helpers | Operational logs; rotate externally if needed |

The daemon is the only supported writer to SQLite. Use the CLI or authenticated API for state changes.
