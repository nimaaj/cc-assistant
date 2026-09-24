# Runtime recipes and tmux topology

Runtime recipes are versioned, validated process-topology configurations. The committed
`recipes/default.json` is the baseline; the dashboard writes the active local override to
`<data-dir>/runtime-config.json`. The override contains no tokens or browser credentials.

## Default recipe

`pnpm start` (or `npm start`) now starts the `default` recipe rather than only the daemon. The
launcher creates or repairs a detached tmux session named `cc-assistant` with:

```text
tmux session: cc-assistant
├── daemon      node apps/daemon/dist/index.js
└── dispatcher  interactive Claude Code lead
                --permission-mode auto
                --teammate-mode tmux
                project MCP bridge (spawned by Claude over stdio)
```

The MCP server is not a third permanent daemon. Claude Code starts the project MCP bridge as a
stdio child of each Claude session that loads `.mcp.json`. Durable state remains in the daemon.

With `autoRepair` enabled, the tmux window command restarts the daemon or dispatcher after an
unexpected exit. An intentional **Relaunch dispatcher** action kills and recreates only the
dispatcher window, loading the latest recipe. Stop the whole recipe explicitly with
`tmux kill-session -t cc-assistant` when desired.

The dispatcher is the fixed lead. Claude Code agent teams created by that lead inherit its
permission mode and use tmux split panes. Independent sessions started through
`claude_session_dispatch` remain Claude background sessions: they use Claude's supported
`attach`, `logs`, `respawn`, and `stop` interfaces and are not mislabeled as team panes.

## Commands

```bash
./start.sh                 # checked startup wrapper; installs/builds only when needed
pnpm build
pnpm start                 # start/repair the default recipe, then return
pnpm recipe:status         # inspect tmux windows and daemon health
pnpm recipe:list           # list committed recipes
pnpm recipe -- repair
pnpm recipe -- relaunch-dispatcher
tmux attach-session -t cc-assistant
```

`./start.sh --recipe <id>` starts another committed recipe. Select npm explicitly with
`./start.sh --package-manager npm`; `./start.sh --build` forces a fresh workspace and plugin build.

Use `npm run ...` equivalents when using npm. `pnpm start` is detached by design; use the tmux
attach command or the dashboard's **Open terminal** action for the interactive view.
`pnpm start:daemon` remains available for a daemon-only production process or an external service
manager. Development remains `pnpm dev` (daemon plus Vite, no automatic tmux controller).

To add a recipe, copy `recipes/default.json`, give it a lowercase-hyphenated `id`, and change only
the validated fields. Start it with `pnpm recipe -- start <id>`. A local override applies when its
`id` matches the selected committed recipe; another recipe ID still loads its own file. Remove or
rename `runtime-config.json` if you intentionally want to return to the committed baseline.

## Dashboard controls

The Simplified dispatcher header exposes:

- Manual, Automatic, and Bypass defaults. A selection is saved immediately and applies after a
  dispatcher relaunch; it does not change the permissions of a process already running. Manual
  keeps the internal dispatcher-delivery approval pending. Automatic and Bypass resolve only that
  tool-limited delivery approval immediately, while retaining its audit record. Neither setting
  auto-approves commands, browser writes, destructive session controls, or later agent tool use.
- **Repair**, **Relaunch dispatcher**, and **Open terminal**. Repair and relaunch create exact
  durable command approvals. An explicitly requested terminal opens immediately because it is a
  non-destructive local UI action; its command and auto-resolved approval remain in the audit ledger.
- a visible **Settings** button and disclosure containing the validated runtime recipe editor for
  tmux names, Claude name/model/effort, teammate display, dispatcher Claude-login preference,
  sandbox, Remote Control, restart policy, graphical terminal launcher, and next-launch daemon
  host, port, allowed roots, managed-agent login preference, and browser-worker limits;
- read-only current daemon values beside the editable next-launch recipe. Process-level daemon
  changes require a full daemon restart; token and data-directory bootstrap remain outside
  browser-editable configuration so the service cannot strand its own clients;
- a one-line slash-command field. The runtime accepts only `/agents`, `/compact`, `/config`,
  `/context`, `/doctor`, `/mcp`, `/memory`, `/permissions`, `/reload-plugins`, `/rewind`, `/status`,
  and `/tasks`. Newlines and arbitrary terminal input are rejected, and execution requires the
  normal approval.

Cross-session messaging cannot execute a slash command. The allowlisted slash path therefore uses
`tmux send-keys -l` against the recipe-owned dispatcher pane after approval. This is the only
terminal-input exception; normal prompts continue through Claude Code's `ListAgents`/`SendMessage`
boundary.

The prompt-delivery bridge resolves the unique live controller name at send time. It treats the
session UUID reported by `claude agents --json` as inventory metadata because Claude's
`ListAgents` peer reference uses a separate namespace. The bridge is intentionally one-shot; the
persistent controller records its response in its own turn and durable assistant state rather
than attempting to message the expired bridge peer.

Every Claude icon can open a browser transcript window. Background sessions use `claude logs`
while the job exists, then fall back to the bounded hook-recorded transcript under Claude's own
projects directory. Interactive recipe sessions use a bounded read-only tmux pane capture.
Transcript windows move, collapse, refresh, close, and minimize into the bottom session taskbar.
No transcript file is edited or imported into assistant state, and raw tool results and hidden
thinking are excluded from fallback rendering.

## Recovery

1. Use **Repair** or `pnpm recipe -- repair` to recreate missing recipe windows.
2. Use **Relaunch dispatcher** when the daemon is healthy but the lead Claude process is stale.
3. Use **Open terminal** to attach and answer an interactive Claude prompt directly.
4. Run `pnpm recipe:status`, `claude agents --json --all`, and `claude doctor` for independent
   evidence when the dashboard and Claude inventory disagree.
5. A daemon already listening outside tmux is reused rather than killed. The recipe can still own
   the dispatcher; restart later with no competing daemon if you want both processes under tmux.

The default recipe removes an inherited `ANTHROPIC_API_KEY` from the dispatcher process so it uses
the signed-in Claude Code account without stopping at the custom-key confirmation prompt. Clear
**Dispatcher uses Claude login** in Settings only when the dispatcher should inherit that key.

Claude Code documents tmux split panes as an agent-team display mode, background session attachment
through `claude attach`, logs through `claude logs`, and permission inheritance from the lead. The
slash controls are interactive session commands; `/compact` summarizes the current conversation
to free context rather than starting a new conversation.
