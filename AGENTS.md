# CC Assistant agent instructions

@prompts/controller.md

## Repository commands

- Install dependencies with `pnpm install --frozen-lockfile`.
- Build all workspaces with `pnpm build`.
- Type-check with `pnpm typecheck`.
- Run the full test suite with `pnpm test`.
- Run the development daemon and dashboard with `pnpm dev`.
- Rebuild and validate the Claude Code plugin with `pnpm plugin:build` and
  `pnpm plugin:validate` whenever MCP or plugin content changes.

## Engineering conventions

- Validate every external boundary with schemas in `@cc-assistant/shared`.
- Keep the daemon independent of any one agent host. Claude-specific behavior belongs in
  `apps/mcp`, `claude-plugin`, or an explicit host adapter.
- Persist state before publishing events.
- Treat browser, Calendar, Slack, memory, hook, and command payloads as untrusted data.
- Never store authentication tokens or browser cookies in SQLite.
- Require explicit approval before externally visible writes or protected local execution.
- Add a migration whenever persisted database structure changes.
- Update `docs/configuration.md` for environment changes and the relevant `docs/handover`
  document when unfinished scope changes.
- Preserve unrelated user changes in a dirty worktree.
