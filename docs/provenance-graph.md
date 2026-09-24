# Workspace provenance graph

Every assistant-created canvas item can be traced to the user prompt and actor that created it.
This is durable domain metadata, not a browser-only diagram.

## Stored model

SQLite stores one optional provenance record per item in `workspace_item_provenance`:

- the item type and ID;
- the exact originating prompt, when one exists;
- the creating entity, usually a Claude session or browser worker;
- the immediate parent, usually the dispatcher run; and
- creation and update timestamps.

`workspace_item_links` stores directed `created`, `derived`, `requires`, and `related` edges between
canvas entities. A link can target a task, run, approval, memory, schedule, ability, notification,
Claude session, browser job, browser worker, or folder. Domain records remain owned by their
existing repositories; this table is the cross-domain graph.

The authenticated `GET /api/workspace/provenance` endpoint returns the complete graph. The
validated `PUT /api/workspace/provenance` endpoint performs an idempotent upsert. Claude uses the
`workspace_provenance_link` MCP tool after a downstream create call so it can add the exact prompt,
the originating session, the dispatcher run, and relationships that a generic HTTP route cannot
infer. Creation routes also write safe baseline provenance so items are never silently orphaned if
an agent stops before the refinement call.

Creation tools that accept an `origin` field perform that refinement as part of the same controller
action. `task_create` accepts the dispatcher envelope's prompt, creator, parent, and related items,
then writes the task and graph metadata before returning success. This avoids relying on a second
optional tool call for the common dispatcher-to-task path.

## Dispatcher contract

`CC_ASSISTANT_DISPATCH_V1` includes an `origin` object containing the exact prompt, the dispatcher
run reference, and the selected controller-session reference. The controller must propagate these
values and call `workspace_provenance_link` after it creates a task, memory, run, schedule, browser
job, or other canvas item. Related memories and other inputs belong in `relatedTo`; they are not
embedded as unverifiable free text.

## Canvas behavior

The Simplified canvas renders links as curved, arrowed React Flow edges. Created and derived edges
animate while related edges use a separate color. An item's small trace badge exposes its prompt,
creator, parent, and connection count in a tooltip.

Right-clicking a graph node selects that node and all visible directed descendants before opening
the context menu. The menu labels the scope as a branch, and its folder, move, restore, and Trash
actions apply to the whole visible branch. If the user already has a multi-selection that includes
the clicked node, that explicit selection takes precedence. Cycles are handled with a visited set,
and links to items outside the current folder/archive/trash view are not selected.

## Safety and retention

Automatic dispatcher mode auto-resolves only the internal, tool-limited delivery bridge approval.
The resolved approval remains in the ledger. Commands, browser writes, destructive session
controls, and other externally visible actions keep their ordinary approval boundaries. Trashing
an item does not delete its provenance or graph links.
