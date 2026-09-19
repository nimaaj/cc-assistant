@AGENTS.md

# Claude Code integration

The import above is intentional. Claude Code normally chooses `CLAUDE.md` instead of
`AGENTS.md`; importing the shared file gives Claude and other compatible coding agents the same
controller and engineering contract, including on Claude Code versions that do not load
`AGENTS.md` directly.

- Start the dedicated controller with `pnpm controller`.
- Start it with strict built-in Bash sandboxing using `pnpm controller:sandbox`.
- In a controller session, use `/mcp` to confirm `cc-assistant` is connected, `/context` to
  confirm these instructions loaded, and `/sandbox` to inspect the effective sandbox policy.
- The project-local MCP tools use the `mcp__cc-assistant__*` namespace. The packaged plugin uses
  Claude Code's plugin-qualified namespace.
- Use only Anthropic's official Claude-in-Chrome integration for Calendar and Slack browser
  jobs. Do not ask the user to install a cc-assistant browser extension.
- Lifecycle hooks remain observation-only. Live session control uses Claude Code's supported
  agent-view CLI and cross-session messaging tools through approval-backed cc-assistant actions;
  it never injects terminal input or edits Claude's private state files.
