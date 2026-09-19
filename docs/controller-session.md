# Claude Code controller session

This document explains how the controlling Claude Code session receives its operating context
and how to run it with or without Claude Code's built-in Bash sandbox.

## Instruction layout

The controller contract has one canonical source:

```text
prompts/controller.md
        │
        ├── imported by AGENTS.md
        │       └── imported by CLAUDE.md
        │
        └── copied by pnpm plugin:build
                └── claude-plugin/skills/controller/SKILL.md
```

- `prompts/controller.md` defines controller activation, startup, task state, delegation,
  approvals, commands, browser jobs, triggers, memory, session monitoring, recovery, and
  completion behavior.
- `AGENTS.md` adds repository commands and engineering conventions in an agent-neutral file.
- `CLAUDE.md` imports `AGENTS.md` and adds Claude Code-specific integration notes.
- The plugin skill exposes the same prompt as `/cc-assistant:controller` in a Claude session
  that loads `claude-plugin` from another project.
- The MCP server supplies a compact safety and state-consistency summary even when the full
  controller skill has not been activated.

Anthropic documents `CLAUDE.md` as always-on project instructions and supports `@path` imports.
Current Claude Code also supports `AGENTS.md`, but by default it loads `AGENTS.md` only when no
project `CLAUDE.md` exists. Importing `@AGENTS.md` is therefore deliberate and also works with
versions or providers where direct `AGENTS.md` loading is unavailable.

Official references:

- [How Claude remembers your project](https://code.claude.com/docs/en/memory)
- [Explore the `.claude` directory](https://code.claude.com/docs/en/claude-directory)
- [Create plugins](https://code.claude.com/docs/en/plugins)
- [Extend Claude with skills](https://code.claude.com/docs/en/skills)

## Start the controller

Keep the daemon running, build the MCP bridge, and start the dedicated session from the
repository root:

```bash
pnpm build
pnpm start
```

In another terminal:

```bash
pnpm controller
```

The launcher:

1. fixes the working directory to the cc-assistant checkout;
2. names the session `cc-assistant-controller`;
3. lets Claude Code load `CLAUDE.md`, `.claude/settings.json`, and `.mcp.json` normally;
4. sends a read-only controller bootstrap prompt;
5. asks Claude to summarize current focus and wait for direction.

Pass Claude Code flags after a `--` separator:

```bash
pnpm controller -- --model opus --effort high
```

Use `--no-bootstrap` when you want the controller instructions available without an automatic
state snapshot:

```bash
node scripts/start-controller.mjs --no-bootstrap
```

For a plugin session launched from a different project:

```bash
export CC_ASSISTANT_DATA_DIR=/absolute/path/to/cc-assistant/.data
claude --plugin-dir /absolute/path/to/cc-assistant/claude-plugin
```

Then invoke:

```text
/cc-assistant:controller
```

## Strict sandbox mode

Start the controller with Claude Code's built-in Bash sandbox:

```bash
pnpm controller:sandbox
```

The launcher passes `.claude/controller-sandbox.settings.json` through Claude Code's documented
`--settings` flag. The policy is opt-in and affects that session only.

| Setting | Value | Reason |
| --- | --- | --- |
| `sandbox.enabled` | `true` | Enables OS-enforced Bash filesystem and network isolation |
| `sandbox.autoAllowBashIfSandboxed` | `true` | Lets commands inside the boundary run without repetitive prompts |
| `sandbox.allowUnsandboxedCommands` | `false` | Disables retrying a blocked command outside the sandbox |
| `sandbox.failIfUnavailable` | `true` | Prevents silent fallback to unsandboxed execution |
| `permissions.blockReadsOutsideWorkingDirectories` | `true` | Fences read-only shell commands to explicit working directories |
| `sandbox.filesystem.denyRead` | `.data` and `.env` | Applies OS-level read isolation to local assistant state and environment files for sandboxed commands |
| `permissions.deny` | `.data` and `.env` | Also keeps those paths out of model-visible file tools |
| `sandbox.credentials` | common key/token locations | Removes standard credentials from sandboxed subprocess access |

No network domains are pre-allowed. Claude Code prompts the first time a sandboxed command needs
a domain. Add a narrow domain only after inspecting why the command needs it.

The Bash sandbox does not replace cc-assistant's approval ledger. MCP tools still run outside the
Bash subprocess boundary, and Calendar writes, Slack sends, ability invocations, durable local
commands, and managed-agent tool calls retain their own persisted one-time approval flow.

Official references:

- [Configure the sandboxed Bash tool](https://code.claude.com/docs/en/sandboxing)
- [Configure permissions](https://code.claude.com/docs/en/permissions)
- [Settings files and precedence](https://code.claude.com/docs/en/settings)
- [CLI reference for `--settings`](https://code.claude.com/docs/en/cli-reference)

### Linux dependencies

Claude Code's sandbox uses macOS Seatbelt on macOS. On Linux and WSL2 it requires `bubblewrap`
and `socat`:

```bash
sudo apt-get install bubblewrap socat
```

Run `/sandbox` after installation. Its Dependencies tab reports missing components, including
the optional seccomp filter. Ubuntu 24.04 and newer may also require the AppArmor user-namespace
configuration described in Anthropic's sandbox documentation.

Do not weaken the launcher to continue unsandboxed when dependencies are missing. Use the normal
`pnpm controller` command intentionally if sandboxing is not available.

## Verify a session

Inside Claude Code:

1. Run `/context` and confirm `CLAUDE.md` appears under project instructions.
2. Run `/mcp` and confirm `cc-assistant` is connected.
3. In sandbox mode, run `/sandbox` and confirm strict mode is active.
4. Run `/permissions` to inspect file and tool rules.
5. Ask for current tasks. The controller should read durable state before summarizing it.
6. Ask it to list other Claude sessions. It should use the supported live inventory and distinguish
   that from last-observed hook history.
7. Ask it to propose a message to a named test session. The proposal should enter the approval
   queue without sending until you approve it.
8. Ask what it would do before approving an external write. It should describe the exact payload
   and wait rather than resolving the approval itself.

The lifecycle hooks do not inject controller instructions. They report session events to the
daemon so the dashboard and other clients can observe the latest session state. Live control uses
Claude Code's agent-view CLI and cross-session messaging boundaries; see
[Claude session orchestration](claude-session-orchestration.md).

## Updating the prompt

Edit only `prompts/controller.md`, then regenerate and validate the plugin:

```bash
pnpm plugin:build
pnpm plugin:validate
```

`plugin:build` copies the canonical prompt into the plugin skill before bundling the MCP server.
Commit both the canonical source and generated plugin skill so a source archive remains usable
without a build step.
