# CC Assistant agent instructions

@prompts/controller.md

## Repository commands

- Install dependencies with `pnpm install --frozen-lockfile` (recommended) or `npm ci`.
- Build all workspaces with `pnpm build` or `npm run build`.
- Type-check with `pnpm typecheck` or `npm run typecheck`.
- Run the full test suite with `pnpm test` or `npm test`.
- Run the development daemon and dashboard with `pnpm dev` or `npm run dev`.
- Rebuild and validate the Claude Code plugin with `pnpm plugin:build` and
  `pnpm plugin:validate` (or their `npm run` equivalents) whenever MCP or plugin content changes.
- Use one package manager per checkout and keep both lockfiles current after dependency changes.

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
