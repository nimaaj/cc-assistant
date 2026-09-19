# Implementation roadmap

## Stage 1: task vertical slice

- [x] Shared schemas
- [x] Persistent daemon
- [x] Authenticated task API
- [x] Event log and live updates
- [x] Claude MCP task tools
- [x] Initial dashboard
- [x] Developer CLI and raw authenticated API access

## Stage 2: execution and observation

- [x] Run, session, and approval schemas
- [x] Managed Claude Agent SDK runs
- [x] Worktree isolation
- [x] Safe local process runner
- [x] Claude Code hook receiver
- [x] Approval-backed Claude Code session inventory, messaging, and lifecycle orchestration
- [x] Session dashboard and MCP inspection tools
- [x] Project MCP and hook packaging
- [x] Managed run dashboard

## Stage 3: personal assistant behavior

- [x] Durable one-shot and recurring scheduler
- [x] macOS notification delivery helper
- [x] Browser-job queue with restart recovery
- [x] Browser-backed Google Calendar observations and approved creation
- [x] Clipboard image helper

## Stage 4: browser and triggers

- [x] Slack unread and channel-reading workflows
- [x] Approved exact Slack sending workflow
- [x] Trigger rules, cooldowns, and loop prevention
- [x] Experimental macOS notification observation

## Stage 5: extensibility and memory

- [x] Ability manifest and approved subprocess execution
- [x] Permission and health UI
- [x] Wiki records, provenance, revisions, links/backlinks, and archive lifecycle
- [x] Ranked SQLite FTS search and bounded recall provider
- [x] Generic MCP ability discovery and invocation

## Follow-on hardening

- [x] Package the MCP and hooks as an installable Claude Code plugin.
- [x] Generate and manage per-user macOS LaunchAgents for the daemon and notification watcher.
- [x] Add an opt-in signed-in end-to-end runner for controlled Calendar/Slack test accounts; injected Agent SDK contracts run in `pnpm test`.
- [x] Expose browser jobs, trigger rules, safe command proposals, abilities, and clipboard images in the dashboard control surface.

## Planned handovers

- [ ] Add a semantic/vector implementation behind the existing memory search-provider seam. See [semantic-memory handover](handover/semantic-memory.md).
- [ ] Add a host adapter for Codex while preserving the existing Claude Code path. See [additional-agent-hosts handover](handover/additional-agent-hosts.md).
- [ ] Package versioned release artifacts and Linux user-service installation. See [distribution-and-services handover](handover/distribution-and-services.md).

## Optional and verification work

- [ ] Add a Playwright browser driver only if a concrete deployment requires an alternative to Claude-in-Chrome. See [Playwright driver handover](handover/playwright-browser-driver.md).
- [ ] Complete controlled write and physical macOS checks. See [live verification runbook](handover/live-verification.md).
