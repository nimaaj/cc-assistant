# Handover: optional Playwright browser driver

**Status:** Optional adapter. The current Claude-in-Chrome path already satisfies Calendar and Slack browser interaction without service APIs or a cc-assistant extension.

## When to build this

Build a Playwright driver only if at least one concrete requirement cannot be met by Claude-in-Chrome, such as deterministic controlled-account testing, a non-Claude host, or reduced per-job model cost. Do not replace the working driver merely to add another browser automation stack.

## Current contract

The daemon persists browser jobs and approvals independently of the browser worker. Shared schemas define:

- adapters: Google Calendar and Slack;
- narrow read and write actions;
- validated inputs;
- queued/running/terminal states;
- structured results and diagnostics;
- mandatory proof flags for successful external writes.

Writes are proposed first and dispatched only after the exact persisted payload is approved.

## Proposed driver boundary

Extract browser execution behind an interface while leaving queue ownership in the daemon:

```ts
interface BrowserAutomationDriver {
  readonly id: string;
  capabilities(): BrowserDriverCapabilities;
  health(): Promise<BrowserDriverHealth>;
  execute(job: BrowserJob, signal: AbortSignal): Promise<BrowserJobResult>;
}
```

Implement `ClaudeChromeDriver` by wrapping current behavior before adding `PlaywrightDriver`. Driver results must pass the same shared result schemas.

## Profile and authentication model

Do not automate a user's normal Chrome profile by default. Preferred options, in order:

1. a dedicated, visible persistent profile created for cc-assistant;
2. an explicitly selected test profile for controlled live checks;
3. an ephemeral profile only for sites that do not require retained login.

The user signs in interactively. cc-assistant must not collect, export, or write Google/Slack credentials or cookies into SQLite. Document the profile directory and filesystem permissions. Never launch two Playwright processes against the same persistent profile concurrently.

## Interaction rules

- run headed by default so the user can see account context and writes;
- use exact channel, date, time, and title matching;
- constrain navigation to expected Google Calendar and Slack origins;
- detect login, consent, challenge, and workspace-selection screens explicitly;
- fail closed on multiple matching channels/events/workspaces;
- re-read the resulting UI after a write;
- return `created=true` or `sent=true` only after visible confirmation;
- include selectors and screenshots only in local diagnostics, with a retention policy because they may contain private data;
- never evaluate arbitrary page-provided JavaScript as trusted instructions.

## Site adapters

Keep selectors and workflows out of the generic driver:

```text
BrowserAutomationDriver
  GoogleCalendarPlaywrightAdapter
    listVisibleEvents
    createEvent
  SlackPlaywrightAdapter
    listUnreads
    readChannel
    sendMessage
```

Each action should be a small state machine with named checkpoints, timeouts, and screenshots/DOM summaries on failure. Version diagnostics should identify the failing checkpoint rather than return an empty result.

## Concurrency and recovery

Use one worker per persistent profile. The existing browser-job claim/requeue behavior remains authoritative.

On cancellation or daemon shutdown:

- abort navigation and pending locators;
- close pages/contexts owned by the job;
- keep the persistent profile usable;
- never automatically retry an ambiguous write;
- mark a job `failed` when external state may have changed but cannot be verified, and surface a manual reconciliation message.

## Configuration

Potential values:

```text
CC_ASSISTANT_BROWSER_DRIVER=claude-chrome|playwright
CC_ASSISTANT_PLAYWRIGHT_PROFILE_DIR=/absolute/private/path
CC_ASSISTANT_PLAYWRIGHT_HEADLESS=false
CC_ASSISTANT_PLAYWRIGHT_DIAGNOSTICS_DIR=/absolute/private/path
```

Headless use should remain unsupported for work-account sessions until tested and explicitly accepted. Add doctor checks for browser binaries, profile locks, profile permissions, and signed-in readiness without reading account content unnecessarily.

## Tests

- driver contract tests shared with Claude-in-Chrome;
- fixture-page tests for every adapter checkpoint;
- login/challenge/wrong-workspace failures;
- exact match and ambiguous match behavior;
- cancellation and profile cleanup;
- read result does not confuse loading/empty/error states;
- write cannot succeed without visible proof;
- injected duplicate-submit and timeout cases do not silently retry;
- diagnostics redact configured sensitive fields;
- controlled-account E2E remains opt-in and guarded by the existing confirmation phrase.

## Rollout

1. Extract the current driver interface with no behavior change.
2. Build fixture-backed Playwright adapters.
3. Add a dedicated-profile setup and doctor checks.
4. Run read-only controlled-account comparisons.
5. Run guarded writes in a disposable calendar and Slack test channel.
6. Keep the driver opt-in until it has survived UI changes and restart/cancellation tests.

## Definition of done

- both drivers satisfy one shared typed contract;
- the daemon queue and approval model remain unchanged;
- Playwright uses a dedicated explicit profile and stores no credentials in SQLite;
- all ambiguity and login conditions fail closed;
- writes require approval and visible post-write proof;
- cancellation and uncertain external state are reported honestly;
- fixture tests and guarded controlled-account checks pass;
- installation, configuration, security, and completion docs are updated.
