# Handover: agent hosts beyond Claude Code

**Status:** Planned. Codex is the first intended additional host.

## Goal

Allow another coding agent to use the same assistant state and, where supported, provide session observation and managed background runs without making the daemon depend on one vendor's lifecycle or SDK.

## Current coupling

The durable domain is mostly host-neutral, but four integration points are Claude-specific:

1. `apps/mcp` packages tool descriptions and transport for Claude Code.
2. `.claude/settings.json` and hook scripts translate Claude lifecycle payloads into session records.
3. `ExecutionService` imports the Claude Agent SDK directly for managed runs and permission callbacks.
4. Calendar and Slack browser jobs depend on Claude-in-Chrome through a bounded Claude Agent SDK worker.

The first Codex milestone should not attempt to replace the browser worker. It should connect Codex to tasks, memory, approvals, reminders, CLI/API state, and session/managed-run capabilities that have a supported Codex boundary.

## Split the problem into capabilities

Treat these as separate deliverables:

| Capability | Existing Claude path | New-host requirement |
| --- | --- | --- |
| Consume assistant tools | stdio MCP bridge | Host-specific MCP configuration/packaging |
| Observe interactive sessions | Claude lifecycle hooks | Supported events or a conservative polling/registration adapter |
| Start managed agents | Claude Agent SDK | Host runtime with streamed events, cancellation, limits, and approvals |
| Handle tool permissions | SDK `canUseTool` callback | Equivalent runtime callback or explicit reduced capability |
| Browser Calendar/Slack | Claude-in-Chrome worker | Keep existing worker initially; optional driver handover is separate |

Do not claim full host support when only MCP tool consumption works. Surface capability flags explicitly.

## Proposed internal contracts

Move the Claude SDK call behind an adapter owned by the daemon:

```ts
interface AgentHostCapabilities {
  managedRuns: boolean;
  toolApprovals: boolean;
  sessionObservation: boolean;
  browserAutomation: boolean;
}

interface ManagedAgentRequest {
  runId: string;
  cwd: string;
  prompt: string;
  model?: string;
  effort?: string;
  maxTurns: number;
  maxBudgetUsd?: number;
}

interface AgentHostRuntime {
  readonly id: string;
  capabilities(): AgentHostCapabilities;
  start(request: ManagedAgentRequest, handlers: AgentRunHandlers): AgentRunHandle;
  health(): Promise<AgentHostHealth>;
}
```

`AgentRunHandlers` should accept normalized events for session ID, assistant text, tool request, warning, usage, terminal success, and terminal failure. `AgentRunHandle` should support cancellation and cleanup.

Implement `ClaudeAgentHostRuntime` by moving the existing `query(...)` loop with no behavior change. Only then add a Codex runtime if there is a supported programmatic execution interface.

## Preserve daemon contracts

Runs, logs, approvals, tasks, and events should remain host-neutral. Add a `host` field to run metadata first; promote it into the shared schema/database only if filtering and invariants justify a migration.

The normalized terminal rules must stay strict:

- a stream ending without a terminal result is failure;
- cancellation is terminal and expires pending approvals;
- daemon restart makes in-memory permission callbacks unserviceable;
- usage and cost are optional because hosts report different metrics;
- unsupported approval callbacks must disable toolful managed runs rather than auto-approve them.

## MCP support

MCP is the lowest-risk first milestone because it reuses the current authenticated daemon and does not introduce a second writer.

For each host:

1. document the exact project/user MCP configuration supported by the host;
2. launch the existing built bridge or a thin host-specific launcher;
3. pass an absolute `CC_ASSISTANT_DATA_DIR` and loopback daemon URL;
4. verify tool discovery and one read-only request;
5. verify an update with optimistic revision handling;
6. verify that tool output and errors remain structured;
7. avoid duplicating MCP tool definitions unless transport differences require it.

If a host needs a different protocol or packaging layout, keep shared tool registration in a reusable module so descriptions and schemas do not drift.

## Session observation

Claude hooks currently send best-effort lifecycle events. A new adapter should emit the same normalized session shape:

```text
external session ID
host ID
working directory
status
model when known
last event and timestamp
optional parent/subagent relationship
sanitized metadata
```

Requirements:

- events are authenticated to the loopback daemon;
- payloads are treated as untrusted;
- hook failures never block the coding agent;
- duplicate/reordered events are handled deterministically;
- a session not observable through a supported host interface is shown as unavailable, not guessed from process names;
- raw prompts, secrets, or full tool payloads are not persisted merely to prove activity.

Process polling can be a diagnostic signal but should not be the authoritative session adapter because command lines are incomplete and may expose sensitive text.

## Managed Codex runs

Before implementation, verify the currently supported Codex automation interface and its guarantees. Do not parse a human terminal UI.

The runtime is acceptable only if it can provide:

- a bounded working directory;
- cancellation;
- machine-readable progress or final status;
- a clear permission model;
- no silent bypass of cc-assistant approvals;
- deterministic behavior on process exit and daemon restart.

If per-tool permission callbacks are unavailable, ship a read-only/restricted managed-run profile first or mark managed runs unsupported. Do not map “process started” to “run succeeded.”

## Configuration and API

Likely additions:

```text
CC_ASSISTANT_DEFAULT_AGENT_HOST=claude|codex
CC_ASSISTANT_ENABLED_AGENT_HOSTS=claude,codex
```

Add optional `host` selection to managed-run input while keeping `claude` as the compatibility default. Return host capabilities and health through an authenticated endpoint, MCP, CLI, and dashboard.

Model and effort values are host-specific. Validate them in the selected adapter and store the requested values as metadata without pretending they are portable.

## Security requirements

- keep daemon authentication unchanged;
- never import host credentials into assistant SQLite;
- strip or isolate inherited provider keys according to explicit billing configuration;
- preserve allowed-root checks before invoking a host;
- preserve worktree isolation semantics;
- require user-visible approval for host tool requests when a trustworthy callback exists;
- fail closed when a host reports an unknown event or permission state;
- include host identity in audit events and run diagnostics.

## Test matrix

- Claude adapter parity after extraction;
- adapter capability and health reporting;
- host selection validation and disabled-host errors;
- normalized streaming text, session IDs, terminal success/failure, and usage;
- stream ends without terminal result;
- cancellation and pending approval expiry;
- restart recovery;
- allowed-root and worktree behavior;
- missing permission callback cannot auto-approve tools;
- MCP discovery and read/write smoke for the new host;
- session event deduplication, reordering, and end-state handling;
- no credentials or raw sensitive payloads in persisted metadata.

## Rollout order

1. Add host identity/capability types.
2. Extract and test `ClaudeAgentHostRuntime` with exact behavior parity.
3. Document and verify Codex MCP consumption only.
4. Add Codex session observation only if a supported event boundary exists.
5. Add managed Codex runs behind a feature flag only if the runtime satisfies cancellation and permission requirements.
6. Add dashboard host selection and health after backend contracts stabilize.
7. Revisit browser automation separately.

## Definition of done

- Codex can connect to the same assistant state without a second database;
- capability reporting distinguishes MCP, observation, managed runs, approvals, and browser support;
- the Claude path has no regression;
- managed runs have reliable terminal status, cancellation, and permission behavior;
- session observation uses a supported, sanitized boundary;
- every host-specific process is isolated behind an adapter;
- automated tests cover lifecycle and failure behavior;
- installation, configuration, architecture, roadmap, and completion audit describe the new host accurately.
