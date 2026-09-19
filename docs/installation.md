# Installation

This guide installs cc-assistant from source, connects it to Claude Code, and verifies each local boundary. The current release is a source checkout rather than a packaged desktop installer.

## 1. Choose an operating mode

There are two supported ways to run the source checkout:

| Mode | Commands | Dashboard | Intended use |
| --- | --- | --- | --- |
| Development | `pnpm dev` | `http://127.0.0.1:4318` | Code changes and hot reload |
| Production-style | `pnpm build`, then `pnpm start` | `http://127.0.0.1:4317` | Daily use from a stable checkout |

Both modes use the same daemon API at `http://127.0.0.1:4317` and, when started through the repository scripts, the same `.data` directory.

## 2. Prerequisites

Required:

- Git.
- Node.js 24. The repository accepts Node versions `>=24 <27`.
- pnpm 11.19.0, matching the `packageManager` field in `package.json`.
- Claude Code 2.1.80 or newer, signed in to the intended Claude account. Version 2.1.275 or
  newer is recommended for the documented strict controller sandbox settings.

Optional by feature:

- Google Chrome with Anthropic's official Claude-in-Chrome integration for Google Calendar and Slack browser jobs.
- A signed-in `calendar.google.com` tab and a signed-in `app.slack.com` tab in that Chrome profile.
- macOS with Xcode Command Line Tools for Notification Center triggers and LaunchAgents.
- `wl-paste` on Wayland or `xclip` on X11 for Linux clipboard-image reads.
- `notify-send` from libnotify for visible Linux desktop reminders.

Use the official [Node.js download page](https://nodejs.org/en/download) and [Claude Code setup guide](https://docs.anthropic.com/en/docs/claude-code/getting-started) for platform-specific installation. Do not run a global npm install with `sudo`.

Verify the required tools:

```bash
git --version
node --version
npm --version
claude --version
```

Install the pinned pnpm version with npm if it is not already available:

```bash
npm install --global pnpm@11.19.0
pnpm --version
```

## 3. Clone and build

```bash
git clone https://github.com/nimaaj/cc-assistant.git
cd cc-assistant
pnpm install --frozen-lockfile
pnpm build
pnpm plugin:build
pnpm assistant:doctor --offline
```

What these commands do:

- `pnpm install --frozen-lockfile` installs exactly the dependency graph recorded in `pnpm-lock.yaml`.
- `pnpm build` builds the TypeScript packages and production web assets.
- `pnpm plugin:build` refreshes the bundled MCP server in `claude-plugin/server/index.mjs`.
- `pnpm assistant:doctor --offline` checks runtimes and build artifacts without requiring a running daemon.

The offline doctor may report warnings for optional platform helpers. It should not report missing build artifacts, an unsupported Node version, or an unusable Claude Code installation.

## 4. Start the application

### Development mode

Run the daemon and Vite dashboard together:

```bash
pnpm dev
```

Open `http://127.0.0.1:4318`. Keep the terminal running. Source changes to the daemon or web app reload automatically.

### Production-style mode

Build and start the daemon:

```bash
pnpm build
pnpm plugin:build
pnpm start
```

Open `http://127.0.0.1:4317`. The daemon serves the built dashboard, so there is no Vite process.

On first start, the daemon creates:

```text
.data/access-token
.data/assistant.sqlite
.data/assistant.sqlite-wal   # present while WAL has outstanding pages
.data/assistant.sqlite-shm   # present while SQLite is open
```

The token file is generated with user-only permissions. Do not commit or share it.

## 5. Sign in to the dashboard

Read the generated token locally:

```bash
cat .data/access-token
```

Paste it into the dashboard login screen. The dashboard exchanges it for an HTTP-only, same-site cookie; it does not keep the bearer token in browser JavaScript storage.

If `.data/access-token` does not exist, confirm that the daemon started successfully and that `CC_ASSISTANT_DATA_DIR` points to the same directory used by the daemon.

## 6. Connect Claude Code

### Project-local connection

The committed `.mcp.json` registers the built MCP bridge for Claude Code sessions launched from this repository.

1. Build the repository.
2. Keep the daemon running.
3. Start or restart Claude Code from the repository root:

   ```bash
   claude
   ```

4. Open `/mcp` inside Claude Code and confirm that `cc-assistant` is connected.
5. Ask Claude to list assistant tasks or call a read-only tool.

The MCP process does not own data. It reads the local access token and forwards validated requests to the daemon.

### Dedicated controller session

The project includes a detailed controller prompt and launch commands. With the daemon running:

```bash
pnpm controller
```

For strict built-in Bash sandboxing:

```bash
pnpm controller:sandbox
```

The sandbox launcher refuses unsandboxed command retries and fails instead of silently starting
without isolation. On Linux and WSL2, install `bubblewrap` and `socat` first:

```bash
sudo apt-get install bubblewrap socat
```

See [Claude Code controller session](controller-session.md) for settings, verification, and the
distinction between Claude Code's Bash sandbox and cc-assistant's durable approval ledger.

### Plugin connection across projects

Build and validate the bundled plugin:

```bash
pnpm plugin:build
pnpm plugin:validate
claude --plugin-dir ./claude-plugin
```

The plugin contributes the MCP bridge, lifecycle hooks, and `/cc-assistant:controller` skill. The daemon must still be running. The plugin selects its token directory in this order:

1. explicit `CC_ASSISTANT_DATA_DIR`;
2. `.data` in the current Claude project when it contains an access token;
3. the platform application-data location.

If the daemon uses the repository-local `.data` directory while Claude runs in another project, set an absolute data directory before launching Claude:

```bash
export CC_ASSISTANT_DATA_DIR=/absolute/path/to/cc-assistant/.data
export CC_ASSISTANT_DAEMON_URL=http://127.0.0.1:4317
claude --plugin-dir /absolute/path/to/cc-assistant/claude-plugin
```

### Session monitoring in other projects

Install additive user-level Claude hooks:

```bash
pnpm hooks:install-global
```

The installer preserves existing hooks and creates a backup before changing the user settings. Restart existing Claude sessions afterward. Remove the hooks with:

```bash
pnpm hooks:remove-global
```

## 7. Enable Calendar and Slack browser jobs

cc-assistant deliberately does not use Google Calendar or Slack API credentials and does not install its own browser extension.

1. Install and sign in to Anthropic's official Claude-in-Chrome integration.
2. Use the same Claude account as the Claude Code installation used by the daemon's Agent SDK worker.
3. Keep signed-in Google Calendar and Slack tabs available in that Chrome profile.
4. Leave `CC_ASSISTANT_BROWSER_ENABLED=true`.
5. Restart the daemon after changing browser-worker environment values.
6. Run the online doctor:

   ```bash
   pnpm assistant:doctor
   ```

Read operations can run immediately. Calendar creation and Slack sending create one-time approval records first; review the exact payload in the dashboard before approving it.

For controlled-account read checks:

```bash
pnpm smoke:browser:e2e --reads
```

The guarded write test creates real external data. Read `pnpm smoke:browser:e2e --help` and use only a disposable calendar event and a safe test channel.

## 8. Platform helpers

### Linux

The daemon and dashboard run normally on Linux. Install one clipboard adapter and the desktop notification helper with the operating system's package manager:

```text
Wayland clipboard: wl-clipboard (provides wl-paste)
X11 clipboard:     xclip
Notifications:     libnotify (provides notify-send)
```

Run `pnpm assistant:doctor` after installation. Automatic Linux user-service installation is not implemented yet; keep `pnpm start` under a user-managed supervisor if persistent startup is required.

### macOS

For a source-checkout installation that starts at login:

```bash
pnpm build
pnpm plugin:build
pnpm macos:services:dry-run
pnpm macos:services:install
```

The installer creates per-user LaunchAgents for the production daemon and Notification Center watcher. It compiles the watcher into `.data/bin/notification-watcher` and writes logs under `.data`.

After installation:

1. grant Accessibility permission to `.data/bin/notification-watcher` in System Settings;
2. restart the watcher or log out and back in;
3. run `pnpm assistant:doctor`;
4. create a narrowly filtered `system_notification` trigger before testing.

Remove both LaunchAgents with:

```bash
pnpm macos:services:remove
```

### Windows

Claude Code supports Windows through WSL or Git Bash, but cc-assistant's native clipboard, notification, and service helpers do not currently implement a Windows adapter. The core daemon, web UI, CLI, and MCP layers should be developed and tested under WSL before Windows support is claimed.

## 9. Verify the installation

With the daemon running:

```bash
pnpm assistant:doctor
pnpm cca status --json
CC_ASSISTANT_DATA_DIR=.data node scripts/mcp-smoke.mjs
```

For a source/build verification:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm plugin:build
pnpm plugin:validate
```

Expected local endpoints:

| Endpoint | Mode | Purpose |
| --- | --- | --- |
| `http://127.0.0.1:4317/api/health` | Both | Daemon health; no state mutation |
| `http://127.0.0.1:4317` | Production-style | Built dashboard |
| `http://127.0.0.1:4318` | Development | Vite dashboard |

## 10. Updating an installation

Stop the daemon, then run:

```bash
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
pnpm plugin:build
pnpm assistant:doctor --offline
```

Restart the daemon and Claude Code after an MCP or plugin change. On macOS, rerun `pnpm macos:services:install` if the service script, native watcher, Node binary, checkout path, or environment changed.

Do not delete `.data` during an update. Database migrations are applied by repository constructors when the daemon starts.

## 11. Backup and removal

When the daemon is stopped, back up `.data/assistant.sqlite` and the access token if the backup must be directly usable by the same clients.

While the daemon is running in WAL mode, use SQLite's online backup command:

```bash
sqlite3 .data/assistant.sqlite '.backup /safe/path/assistant-backup.sqlite'
```

To remove the application while preserving state:

1. remove global hooks if installed;
2. remove macOS services if installed;
3. stop the daemon;
4. back up `.data`;
5. remove the source checkout only after confirming the backup.

## 12. Troubleshooting

| Symptom | Check | Resolution |
| --- | --- | --- |
| Dashboard cannot connect | Daemon terminal and port 4317 | Start `pnpm dev` or `pnpm start`; confirm no port conflict |
| Dashboard rejects token | Token path used by daemon | Read the token from the same `CC_ASSISTANT_DATA_DIR`; clear the site cookie and sign in again |
| MCP is disconnected | Build artifact, daemon, project directory | Run `pnpm build`, restart Claude Code from the repository root, then inspect `/mcp` |
| MCP says token is missing | MCP and daemon data directories differ | Set the same absolute `CC_ASSISTANT_DATA_DIR` for both |
| Managed agent cannot use a directory | Allowed-root configuration | Add the real path to `CC_ASSISTANT_ALLOWED_ROOTS` and restart the daemon |
| Calendar/Slack job fails | Chrome tab, login, official integration, budget | Open the signed-in tab, verify Claude-in-Chrome, and inspect the job diagnostic in the dashboard |
| Clipboard image is unavailable on Linux | Display server adapter | Install `wl-clipboard` or `xclip` and rerun the doctor |
| macOS trigger never fires | Accessibility and filter | Grant permission to the compiled watcher and verify at least one app/title/body filter |
| Doctor finds stale artifacts | Build outputs | Run `pnpm build && pnpm plugin:build`, then restart the daemon and Claude Code |

See [Configuration](configuration.md) for every supported environment variable and [Completion audit](completion-audit.md) for the live checks that still require controlled accounts or macOS hardware.
