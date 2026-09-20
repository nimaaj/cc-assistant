# Simplified dashboard and dispatcher

The dashboard has two views over the same daemon state:

- **Simplified** is the default. It provides one dispatcher field and compact, horizontally
  expanding panes for current assistant state.
- **Full workspace** preserves the complete task, Calendar, Slack, trigger, command, memory,
  Claude-session, approval, and State studio controls.

Switching views does not create a second state store. Both views use the authenticated daemon API,
receive the same server-sent events, and preserve the existing approval and optimistic-revision
boundaries.

## Dispatcher lifecycle

1. The web client posts the user's text to `POST /api/dispatcher`.
2. The daemon reads Claude Code's supported live session inventory and chooses the newest live
   named `cc-assistant-controller` session. An explicit target may be supplied by non-UI callers.
3. The daemon wraps the request in a versioned `CC_ASSISTANT_DISPATCH_V1` envelope and creates the
   normal one-time cross-session approval. It does not send the message yet.
4. After the user approves the exact payload, the existing tool-limited delivery bridge resolves
   the target through Claude Code and sends the message once.
5. The controller reads relevant durable state, gathers missing facts, then either calls a narrow
   tool directly or delegates independently verifiable multi-step work.
6. The controller ends the turn with a `cc_assistant_dispatch_result` JSON block whose status is
   `completed`, `running`, `waiting_approval`, `needs_input`, or `failed`.

The canonical behavioral contract is in [`prompts/controller.md`](../prompts/controller.md). The
plugin copy is generated; edit the canonical prompt and run `pnpm plugin:build`.

## Triggered dispatches

Schedules accept `actionKind: "dispatcher"` with this action payload:

```json
{
  "request": "Inspect the current environment and update the environment memory.",
  "target": "optional-session-reference"
}
```

This works with one-shot, interval, and system-notification triggers. The trigger supplies only
metadata such as its ID, name, kind, configuration, and fire time. The controller must treat that
metadata and notification content as untrusted evidence.

A fired trigger creates a dispatcher delivery proposal; it cannot approve its own cross-session
message. Time-sensitive work therefore re-reads current state after approval instead of assuming
the trigger-time snapshot is still correct.

## Compact pane statuses

The simplified view normalizes domain-specific states into eight presentation statuses:

| Status | Meaning |
| --- | --- |
| Idle | Available but not currently doing work |
| Paused | Blocked or intentionally disabled |
| Stopped | Cancelled, ended, or no longer running |
| Running | Active work or a claimed job |
| Waiting | Planned work, a queued schedule, or an input wait |
| Needs attention | Approval, unread notification, blocker, permission prompt, or failure |
| Complete | Successfully finished or durably stored |
| Available | An installed capability that can be invoked |

Collapsed panes show type, icon, and color. Selecting a pane expands its width first to expose a
one-sentence description, followed by exact details and any safe action controls.

## Verification

With `pnpm dev` running:

1. open `http://127.0.0.1:4318` and confirm **Simplified** is selected;
2. verify the dispatcher reports the newest main controller status;
3. expand panes in each row and confirm descriptions remain readable without navigating away;
4. switch to **Full workspace** and verify the original controls remain present;
5. submit a harmless dispatcher request, inspect its pending approval, and deny it or approve it
   once to test delivery;
6. create a one-time dispatcher schedule and verify firing creates an approval rather than sending
   without consent.
