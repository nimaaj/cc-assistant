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
2. The daemon reads Claude Code's supported live session inventory and chooses the newest live,
   uniquely named session whose name is `cc-assistant-controller` or begins with
   `cc-assistant-controller-`. Background launchers generate the suffix automatically. An explicit
   target may be supplied by non-UI callers.
3. The daemon wraps the request in a versioned `CC_ASSISTANT_DISPATCH_V1` envelope and creates the
   normal one-time cross-session approval. It does not send the message yet.
4. After the user approves the exact payload, the existing tool-limited delivery bridge resolves
   the target through Claude Code and sends the message once. The bridge must return a structured
   delivery receipt; an ambiguous, refused, or otherwise unsent message fails the run even when
   the bridge process itself exits with code zero.
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

## Drag, folders, trash, and themes

Every pane backed by a durable record can be dragged with the mouse. Drop it on a folder tile to
file it, or on **Unfiled** to remove its folder assignment. **All items** ignores folder filtering;
selecting a folder or **Unfiled** filters all four pane rows consistently. Folder creation, icon
selection, renaming, deletion, and membership use the authenticated daemon API. They are stored in
`workspace_folders` and `workspace_item_placements`, and changes publish normal SSE events. Deleting
a folder preserves its contents by returning them to Unfiled.

Trash accepts tasks only. A drop performs the normal revision-checked task update to `cancelled`;
it does not delete the record or its audit history. Runs, approvals, notifications, memories,
schedules, abilities, browser jobs, and Claude sessions cannot be discarded from this surface.

The theme dots switch between Forest, Midnight, Ocean, Ember, Plum, and Graphite. Theme selection
is presentation-only and stays in that browser's `localStorage`; it is not assistant state and does
not cross browser profiles.

## Verification

With `pnpm dev` running:

1. open `http://127.0.0.1:4318` and confirm **Simplified** is selected;
2. verify the dispatcher reports the newest main controller status;
3. expand panes in each row and confirm descriptions remain readable without navigating away;
4. create and rename a folder, drag a pane into it, and verify folder filtering survives a reload;
5. drag a task onto Trash and verify it appears as `cancelled` in **Full workspace**;
6. switch themes, reload, and verify the selected palette remains active;
7. switch to **Full workspace** and verify the original controls remain present;
8. submit a harmless dispatcher request, inspect its pending approval, and deny it or approve it
   once to test delivery;
9. create a one-time dispatcher schedule and verify firing creates an approval rather than sending
   without consent.
