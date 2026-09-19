# CC Assistant

This repository contains a local-first personal assistant with a Claude Code MCP adapter.

## Commands

- `pnpm build`: build every workspace package.
- `pnpm typecheck`: type-check every workspace package.
- `pnpm test`: run the test suite.
- `pnpm dev`: run the daemon and web dashboard together.

## Conventions

- Validate every external boundary with the schemas in `@cc-assistant/shared`.
- Keep the daemon independent of any one agent host. Claude-specific behavior belongs in `apps/mcp`, `claude-plugin`, or an explicit host adapter.
- Persist state before publishing events.
- Treat browser, calendar, Slack, memory, and hook payloads as untrusted data.
- Never store authentication tokens or browser cookies in the SQLite database.
- Require explicit approval before destructive commands or externally visible actions.
- Add a migration whenever persisted database structure changes.
- Update `docs/configuration.md` for environment changes and the relevant `docs/handover` document when unfinished scope changes.
