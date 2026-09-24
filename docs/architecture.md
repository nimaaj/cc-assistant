# Architecture

## Process boundaries

The system is split into five process boundaries:

1. The daemon owns durable state, scheduling, approvals, managed execution, and integration lifecycles.
2. The MCP bridge is spawned by Claude Code over stdio and forwards typed requests to the daemon.
3. The browser dashboard reads and changes the same state through the daemon API, including its
   developer-facing aggregate snapshot and raw validated API console.
4. The developer CLI provides human-readable and JSON state control through that API.
5. A bounded Agent SDK worker delegates browser-only jobs to Claude Code's official Claude-in-Chrome integration; an optional macOS watcher handles notification triggers.

A runtime recipe is the process supervisor around these boundaries, not a sixth data owner. The
default recipe keeps the daemon and interactive dispatcher in named tmux windows. Claude Code
spawns each session's MCP stdio bridge. Recipe configuration is a validated JSON file outside
SQLite; the dashboard can edit it, but process changes apply only after repair/relaunch.

The split allows reminders, session monitoring, and managed agents to survive the end of an individual Claude Code session.

SQLite is not a public mutation interface. Every writer uses the daemon so validation, optimistic revisions, audit events, and live subscriptions remain consistent. Developers can use `cca api` when they need low-level access to an authenticated endpoint.

## Trust boundaries

- MCP clients and the dashboard authenticate to the daemon.
- Ability commands use manifest validation, shell-free argument arrays, allowed working-directory roots, stripped secret and execution-control environment variables, and one-time approvals whose exact payload is inspectable in the dashboard.
- Browser content is untrusted even when it comes from a signed-in work account.
- A trigger may propose a sensitive operation or a dispatcher delivery but cannot approve it.
- Claude session discovery reads `claude agents --json --all`; logs and lifecycle controls use
  the documented Claude CLI. Cross-session delivery is delegated to a tool-limited Claude
  process with only `ListAgents` and `SendMessage`. Every mutation is approval-backed, target
  permission rules remain authoritative. A separate runtime-control boundary can send only a
  one-line allowlisted built-in slash command to the recipe-owned dispatcher pane after a durable
  approval; it cannot deliver arbitrary prompts or edit private Claude files.
- Account tokens remain in the macOS Keychain or the owning browser profile.

## Google Calendar constraint

The work calendar does not provide API access. Calendar integration will therefore use visible browser interaction.

The implementation executes narrow jobs through the Agent SDK with Claude-in-Chrome enabled against already signed-in tabs. It does not install or operate a cc-assistant Chrome extension. Read-only jobs can queue directly. Calendar creation and Slack sending are represented as browser runs and require persisted approval before dispatch. A closed tab, changed UI, login screen, ambiguous target, or unclear confirmation fails the job; it is never interpreted as an empty calendar or successful write. Dashboard state `ready` means the worker is configured and idle; a real extension/session problem is detected fail-closed when a job runs.

Each worker receives only the `mcp__claude-in-chrome__*` tool family, a job-specific prompt, structured output schema, low default effort, a turn limit, and a cost ceiling. Project MCP settings are not loaded into the browser worker, preventing recursive cc-assistant calls. Browser content is explicitly untrusted. Playwright remains a possible adapter for isolated test profiles, but the production path uses the user's existing official Claude-in-Chrome session.

Calendar observations feed the assistant's own durable reminder scheduler. The browser session is not the reminder engine. Adapter/action pairs have shared daemon-side schemas, Calendar writes require an explicit valid time range, and Slack channel selection is exact and fail-closed.

## Persisted entities

The database contains `tasks`, `sessions`, `runs`, `run_logs`, `approvals`, `schedules`, `notifications`, `memories`, `memory_revisions`, normalized `memory_links`, an FTS5 memory index, `abilities`, `browser_jobs`, `workspace_folders`, `workspace_item_placements`, `workspace_item_layouts`, `workspace_item_provenance`, `workspace_item_links`, and append-only `events`.

All mutable entities use revisions or internal queue claims where concurrent actors may update them.

## State transitions

Commands, Claude session controls, and browser writes start in `waiting_approval`. Approval resolution is durable and auditable; command and session-control execution uses `spawn(executable, args, { shell: false })`. Managed Claude runs use the Agent SDK permission callback, which parks a tool request until its approval is resolved. Agent runs that are interrupted by a daemon restart are failed and their unserviceable approvals expire. Browser jobs are claimed by the daemon's single-worker queue; interrupted claims are requeued on startup.

Schedules store their next fire time in SQLite. One-time triggers disable after firing; interval triggers compute the next timestamp; notification triggers require at least one filter, stay enabled, and enforce a cooldown. Complete trigger/action payloads are validated on create and edit, and edits use optimistic revisions. Reminder delivery always enters the web inbox even if native desktop delivery fails.

The simplified dashboard posts dispatcher text to the daemon. The daemon selects the newest live
named main controller from Claude Code's supported session inventory and creates a normal
cross-session approval. Manual mode leaves that approval pending; Automatic and Bypass immediately
resolve only this internal, tool-limited delivery approval and retain the resolved ledger entry.
All downstream protected operations keep their own approval boundary. Scheduled
and system-notification dispatches use the same path. The controller—not the web client—performs
context gathering, direct tool selection, decomposition, delegation, and final result synthesis.

Simplified-view folder membership and pane coordinates are presentation metadata, but they are
durable shared state so they survive reloads and can be inspected through the API and State studio.
The React Flow viewport, hover-expansion mode, and theme remain per-browser preferences. Dragging
one item onto another creates a folder through the same authenticated folder and placement APIs;
new dispatcher records inherit the open folder. Grid, status, category, and time arrangements are
calculated in the client and persisted through the same durable layout API as manual dragging.
Terminal records are filtered into a virtual Archive folder in the client, so archiving does not
rewrite domain records or erase their audit history. Restoring a task changes its ordinary task
status and makes it visible on the working canvas again.
Dragging an ordinary item or multi-selection to Trash writes `workspace_trashed_items` markers and
removes folder placement; it never hard-deletes or mutates the domain records. Restoring removes the
marker and returns the item to the base canvas. The UI-only preferences use `localStorage` because they have no
assistant-state meaning.

The provenance graph is durable cross-domain state. It records the exact originating prompt,
creating entity, immediate parent, and typed directed relationships. The canvas renders currently
visible links as curved arrows and uses directed descendants for branch-scoped context actions.
See [Workspace provenance graph](provenance-graph.md).

## Memory data ownership

`MemoryRepository` is the sole writer for wiki memory state. A create/update transaction changes the canonical record, FTS row, extracted `[[wiki links]]`, and immutable revision snapshot together; the event is appended after the transaction commits. Archived pages leave history, graph edges, and an explicitly searchable FTS row intact but are omitted by default.

Deterministic Markdown export/import is an interchange boundary, not a second source of truth.
Import always validates and plans against the daemon's current revisions before applying through the
repository. The incorporated knowledge-base code has no runtime dependency on a separate checkout.

Lexical search is isolated behind `MemorySearchProvider`. The current provider safely tokenizes arbitrary user text, uses FTS5/BM25, then applies deterministic exact-title/alias and filter boosts. Recall consumes that contract and enforces record and character limits. A future semantic/vector provider can implement the same contract without changing HTTP, MCP, or CLI shapes.

The daemon uses SQLite WAL mode. Offline backups may copy `assistant.sqlite`; online backups must use SQLite’s backup API/`.backup` so the WAL is included consistently.
