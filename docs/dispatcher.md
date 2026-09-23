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

1. The web client posts the user's text and optional active-folder context to
   `POST /api/dispatcher`. Use the button or `Ctrl+Enter`/`⌘+Enter`.
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
   tool directly or delegates independently verifiable multi-step work. In the default recipe the
   controller is the fixed Claude team lead; teammates use panes in the same tmux session and
   inherit the lead's permission mode.
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

The simplified view places every visible state item on one full-size spatial canvas and normalizes
domain-specific states into eight presentation statuses:

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

Collapsed panes show type, status icon, color, and a short title. Selecting a pane expands its
width first to expose a one-sentence description, followed by exact details and contextual
controls. Claude sessions
support messaging, continuation, background stop/respawn, opening an attached terminal, and a
movable browser transcript preview;
tasks, triggers, Calendar/Slack jobs, abilities, runs, approvals, notifications, and memories
expose their relevant operations. Protected operations remain proposals until explicitly approved.
Pane coordinates are stored in `workspace_item_layouts`; dropping a pane elsewhere on the canvas
persists its new integer `x`/`y` position. **Reset layout** clears those coordinates and returns to
the deterministic automatic grid. The canvas uses React Flow for panning, wheel/pinch zooming,
zoom buttons, fit-to-view, and a minimap. Its viewport, the **Expand on hover** toggle, and the
selected color theme are presentation preferences stored in the current browser.
Expanded panes receive a dedicated top layer so their controls and details do not disappear behind
neighboring nodes. The embedded auto-arrange toolbar can create a compact grid or group the visible
items by status, category, or newest-first time. Auto-arranged coordinates are persisted like manual
drag positions and work in both the base workspace and an open folder.

The base canvas contains a counted, read-only **Archive** system folder. It automatically collects
completed or cancelled tasks and runs, resolved approvals, read notifications, stopped Claude
sessions, and successful or cancelled browser jobs without deleting their durable records. Failed
or blocked work stays on the base canvas because it still needs attention. Memories, abilities, and
configured triggers remain visible because completion does not make them obsolete.

The dispatcher header has Manual, Automatic, and Bypass permission buttons. The selection is saved
to the active runtime recipe and applies after **Repair & connect** or **Relaunch dispatcher**.
Starting still creates a one-time approval; changing the selector does not silently alter an
already-running Claude process. Bypass mode displays an explicit isolation warning. The same area
offers approved terminal launch, repair, and allowlisted slash commands plus the complete safe
recipe editor. Next-launch daemon settings are editable; current effective values are shown
read-only because they require a full daemon restart.

Transcript previews are independent movable windows. Background sessions read Claude's supported
logs; interactive recipe sessions capture a bounded tmux scrollback view. Windows can refresh,
collapse, close, or minimize into the bottom session taskbar. They never modify Claude transcripts.

Status icons animate according to meaning: active work rotates, waiting work pulses, attention
items signal briefly, idle items breathe, and completed items acknowledge periodically. The
dispatcher activity strip uses separate motion languages for request routing, approval waits,
Claude/agent work, local commands, browser work, and completion. All animation collapses to a
single effectively static frame when the operating system requests reduced motion.

## Drag, folders, trash, and themes

Every pane backed by a durable record can be dragged from anywhere on its collapsed card. Drag an
empty canvas region to pan; Shift-click icons to build a discontinuous selection;
dragging a selected icon moves and applies folder/trash drops to the selection. Drop one item onto another
to create a folder containing both items, or drop onto an existing folder to add it. Folder icons
carry a count badge. Opening a folder shows only its members; its embedded **Back to base** target
also accepts dropped items to unfile them. While a folder is open, new dispatcher runs and approvals
are filed there automatically. Folder icon selection, renaming, deletion, and membership use the
authenticated daemon API. They are stored in `workspace_folders` and
`workspace_item_placements`, and changes publish normal SSE events. Deleting a folder preserves its
contents by returning them to the base workspace. A right-click menu exposes Open/Delete for folders
and Remove from folder/Move to Trash/Restore for items as appropriate. When the clicked icon is
already selected, the menu applies to the whole selection and can group selected items.

Trash accepts every ordinary canvas item. A drop writes a `workspace_trashed_items` marker and removes
folder placement without deleting or mutating the underlying task, run, approval, notification,
memory, schedule, ability, browser job, or Claude-session record. Open the counted Trash view and use
the right-click Restore action to return one or several selected items to the base workspace.

Folder management, Trash, themes, hover behavior, auto-arrangement, status legend, zoom controls,
the minimap all live inside the canvas. An expandable **Status & diagnostics** panel summarizes the
daemon, controller, browser worker, approvals, selection, current operation, and recent UI messages.
The theme dots switch between Forest, Midnight, Ocean, Ember, Plum, and
Graphite. Presentation preferences stay in that browser's `localStorage`; they are not assistant
state and do not cross browser profiles.

## Verification

With `pnpm dev` running:

1. open `http://127.0.0.1:4318` and confirm **Simplified** is selected;
2. verify the dispatcher reports the newest main controller status;
3. confirm collapsed panes have short titles, then test click expansion and **Expand on hover**;
4. drag several panes, pan and zoom, reload, and confirm positions and viewport persist;
5. run **Grid**, **Status**, **Category**, and **Newest** and confirm each produces a stable layout;
6. use **Reset layout** and confirm panes return to the default grid;
7. drag one item onto another, verify a counted folder is created, add another item, and verify
   folder membership survives a reload;
8. open that folder, dispatch a harmless request, and verify the proposed run and approval appear
   in the open folder;
9. multi-select two items, drag them onto Trash, open Trash, and right-click to restore them;
10. switch themes, reload, and verify the selected palette remains active;
11. switch to **Full workspace** and verify the original controls remain present;
12. submit a harmless dispatcher request, inspect its pending approval, and deny it or approve it
   once to test delivery;
13. create a one-time dispatcher schedule and verify firing creates an approval rather than sending
   without consent.
