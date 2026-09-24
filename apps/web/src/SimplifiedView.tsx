import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  SelectionMode,
  useNodesState,
  type Node,
  type Edge,
  type NodeProps,
  type OnNodeDrag,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  AbilityManifest,
  Approval,
  AssistantNotification,
  BrowserAutomationStatus,
  BrowserJob,
  ClaudeAgentSession,
  ClaudePermissionMode,
  RuntimeRecipe,
  RuntimeStatus,
  RuntimeTranscript,
  Memory,
  Run,
  Schedule,
  Task,
  WorkspaceFolder,
  WorkspaceFolderIcon,
  WorkspaceCanvasEntityType,
  WorkspaceItemLayout,
  WorkspaceItemPlacement,
  WorkspaceItemType,
  WorkspaceTrashedItem,
  WorkspaceItemLink,
  WorkspaceItemProvenance,
  WorkspaceProvenanceGraph,
  WorkspaceEntityRef,
} from "@cc-assistant/shared";
import { isMainControllerName, runtimeSlashCommands } from "@cc-assistant/shared";
import {
  archiveMemory,
  cancelRun,
  controlClaudeSession,
  createBrowserJob,
  createWorkspaceFolder,
  deleteWorkspaceFolder,
  dispatchInput,
  controlRuntime,
  getClaudeTranscript,
  getRuntimeConfig,
  getRuntimeStatus,
  invokeAbility,
  markNotificationRead,
  moveWorkspaceItem,
  resetWorkspaceItemLayouts,
  restoreWorkspaceItem,
  resolveApproval,
  setWorkspaceItemLayout,
  trashWorkspaceItem,
  updateTask,
  updateSchedule,
  updateRuntimeConfig,
  updateWorkspaceFolder,
} from "./api.js";

export type CompactStatus = "idle" | "paused" | "stopped" | "running" | "waiting" | "attention" | "complete" | "neutral";
export type CanvasArrangeMode = "grid" | "status" | "category" | "time";
type FolderFilter = string | null;
type ThemeId = "forest" | "midnight" | "ocean" | "ember" | "plum" | "graphite";
type DraggableItem = { itemType: WorkspaceItemType; itemId: string; title: string };
type CanvasPosition = { x: number; y: number };
type DispatcherActivityKind = "routing" | "approval" | "agent" | "command" | "browser" | "complete";
type CanvasDragEvent = Parameters<OnNodeDrag<CanvasFlowNode>>[0];
type CanvasNodeData = {
  kind: "item" | "folder" | "system";
  content?: ReactNode;
  item?: DraggableItem;
  entity?: { itemType: WorkspaceCanvasEntityType; itemId: string; title: string };
  folder?: WorkspaceFolder;
  systemFolder?: boolean;
  count?: number;
  onOpen?: () => void;
  dropActive?: boolean;
  provenance?: WorkspaceItemProvenance | undefined;
  connectionCount?: number;
  arrange: CanvasArrangeDescriptor;
};
type CanvasFlowNode = Node<CanvasNodeData>;
type CanvasEntry = { item: DraggableItem; content: ReactNode };
const ARCHIVE_FOLDER_ID = "system-archive";
const TRASH_FOLDER_ID = "system-trash";
type CanvasContextMenu = { nodeId: string; nodeIds: string[]; scope: "item" | "selection" | "branch"; x: number; y: number };
type DiagnosticMessage = { id: number; level: "info" | "error"; text: string; at: string };
type TranscriptWindow = {
  id: string;
  session: ClaudeAgentSession;
  transcript: RuntimeTranscript;
  x: number;
  y: number;
  collapsed: boolean;
  minimized: boolean;
};
export type CanvasArrangeDescriptor = {
  id: string;
  title: string;
  category: string;
  status: CompactStatus;
  time: number;
};

const statusPresentation: Record<CompactStatus, { icon: string; label: string }> = {
  idle: { icon: "○", label: "Idle" },
  paused: { icon: "Ⅱ", label: "Paused" },
  stopped: { icon: "■", label: "Stopped" },
  running: { icon: "↻", label: "Running" },
  waiting: { icon: "…", label: "Waiting" },
  attention: { icon: "!", label: "Needs attention" },
  complete: { icon: "✓", label: "Complete" },
  neutral: { icon: "·", label: "Available" },
};

export const folderIconPresentation: Record<WorkspaceFolderIcon, string> = {
  folder: "📁",
  briefcase: "💼",
  star: "⭐",
  code: "⌘",
  idea: "💡",
  rocket: "🚀",
  archive: "🗄",
  heart: "♥",
};

const themes: Array<{ id: ThemeId; label: string; swatch: string }> = [
  { id: "forest", label: "Forest", swatch: "#b9f46d" },
  { id: "midnight", label: "Midnight", swatch: "#91b7ff" },
  { id: "ocean", label: "Ocean", swatch: "#57e1db" },
  { id: "ember", label: "Ember", swatch: "#ffb25c" },
  { id: "plum", label: "Plum", swatch: "#d7a1ff" },
  { id: "graphite", label: "Graphite", swatch: "#c7d0d9" },
];

function clip(value: string, length = 180): string {
  const flattened = value.replaceAll(/\s+/g, " ").trim();
  return flattened.length > length ? `${flattened.slice(0, length - 1)}…` : flattened;
}

function sentence(value: string, fallback: string): string {
  const text = clip(value || fallback);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Not scheduled";
}

export function placementKey(itemType: WorkspaceCanvasEntityType, itemId: string): string {
  return `${itemType}:${itemId}`;
}

export function defaultCanvasPosition(index: number, columns = 8): CanvasPosition {
  return { x: 340 + (index % columns) * 150, y: 72 + Math.floor(index / columns) * 122 };
}

const arrangementStatusOrder: CompactStatus[] = ["attention", "running", "waiting", "paused", "idle", "neutral", "complete", "stopped"];

export function arrangeCanvasItems(
  items: CanvasArrangeDescriptor[],
  mode: CanvasArrangeMode,
  columns = 6,
  sizes: Readonly<Record<string, { width: number; height: number }>> = {},
): Record<string, CanvasPosition> {
  const compareTitle = (left: CanvasArrangeDescriptor, right: CanvasArrangeDescriptor): number => left.title.localeCompare(right.title);
  const groups = new Map<string, CanvasArrangeDescriptor[]>();
  const groupKey = (candidate: CanvasArrangeDescriptor): string => mode === "status" ? candidate.status : mode === "category" ? candidate.category : "items";
  const orderedItems = [...items];
  if (mode === "time") orderedItems.sort((left, right) => right.time - left.time || compareTitle(left, right));
  if (mode === "status") orderedItems.sort((left, right) => arrangementStatusOrder.indexOf(left.status) - arrangementStatusOrder.indexOf(right.status) || compareTitle(left, right));
  if (mode === "category") orderedItems.sort((left, right) => left.category.localeCompare(right.category) || compareTitle(left, right));
  for (const candidate of orderedItems) {
    const key = groupKey(candidate);
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }

  const positions: Record<string, CanvasPosition> = {};
  let y = 112;
  for (const group of groups.values()) {
    for (let offset = 0; offset < group.length; offset += columns) {
      let x = 340;
      let rowHeight = 132;
      for (const candidate of group.slice(offset, offset + columns)) {
        const size = sizes[candidate.id] ?? { width: 136, height: 104 };
        positions[candidate.id] = { x, y };
        x += Math.max(160, Math.ceil(size.width) + 28);
        rowHeight = Math.max(rowHeight, Math.ceil(size.height) + 28);
      }
      y += rowHeight;
    }
    if (mode === "status" || mode === "category") y += 28;
  }
  return positions;
}

export function canvasNodeRefreshSignature(nodes: Array<{
  id: string;
  data: { count?: number; arrange: CanvasArrangeDescriptor };
}>): string {
  return nodes.map((node) => [
    node.id, node.data.count ?? "", node.data.arrange.title, node.data.arrange.category,
    node.data.arrange.status, node.data.arrange.time,
  ].join(":")).join("|");
}

export function contextSelectionIds(clickedId: string, rememberedSelection: Iterable<string>): string[] {
  const selected = [...rememberedSelection];
  return selected.length > 1 && selected.includes(clickedId) ? selected : [clickedId];
}

function flowNodeId(itemType: WorkspaceCanvasEntityType, itemId: string): string {
  return itemType === "browser_worker" && itemId === "calendar-slack"
    ? "system:browser-worker"
    : `item:${placementKey(itemType, itemId)}`;
}

/** Return the root and all directed descendants that currently have canvas nodes. */
export function graphBranchNodeIds(
  rootNodeId: string,
  links: WorkspaceItemLink[],
  availableNodeIds: ReadonlySet<string>,
  nodeIdForRef: (ref: WorkspaceEntityRef) => string = (ref) => flowNodeId(ref.itemType, ref.itemId),
): string[] {
  const outgoing = new Map<string, string[]>();
  for (const link of links) {
    const from = nodeIdForRef(link.from);
    const to = nodeIdForRef(link.to);
    outgoing.set(from, [...(outgoing.get(from) ?? []), to]);
  }
  const visited = new Set<string>();
  const pending = [rootNodeId];
  while (pending.length > 0) {
    const current = pending.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const child of outgoing.get(current) ?? []) pending.push(child);
  }
  return [...visited].filter((id) => availableNodeIds.has(id));
}

export function visibleArchiveCount(archived: Iterable<string>, trashed: ReadonlySet<string>): number {
  return [...archived].filter((key) => !trashed.has(key)).length;
}

export function automaticFolderName(firstTitle: string, secondTitle: string): string {
  const label = (value: string): string => clip(shortTitle(value), 32);
  const first = label(firstTitle);
  const second = label(secondTitle);
  return first.toLocaleLowerCase() === second.toLocaleLowerCase() ? first : `${first} + ${second}`;
}

export function shouldArchiveCanvasItem(itemType: WorkspaceItemType, status: string | boolean | null): boolean {
  if (itemType === "task") return status === "done" || status === "cancelled";
  if (itemType === "run") return status === "succeeded" || status === "cancelled";
  if (itemType === "approval") return status !== "pending";
  if (itemType === "notification") return status === true;
  if (itemType === "claude_session") return status === "done" || status === "stopped";
  if (itemType === "browser_job") return status === "succeeded" || status === "cancelled";
  return false;
}

export function shouldArchiveClaudeSession(session: ClaudeAgentSession): boolean {
  return !session.pid || shouldArchiveCanvasItem("claude_session", session.state);
}

export function sessionStatus(session: ClaudeAgentSession): CompactStatus {
  if (session.waitingFor?.toLowerCase().includes("permission") || session.state === "failed") return "attention";
  if (session.status === "busy" || session.state === "working") return "running";
  if (session.status === "waiting") return "waiting";
  if (session.status === "idle") return "idle";
  if (session.state === "blocked") return "paused";
  if (session.state === "stopped" || session.state === "done") return "stopped";
  return "idle";
}

function runStatus(run: Run): CompactStatus {
  if (run.status === "waiting_approval" || run.status === "failed") return "attention";
  if (run.status === "running" || run.status === "queued") return "running";
  if (run.status === "cancelled") return "stopped";
  return "complete";
}

function taskStatus(task: Task): CompactStatus {
  if (task.status === "blocked") return "attention";
  if (task.status === "active") return "running";
  if (task.status === "planned") return "waiting";
  if (task.status === "done") return "complete";
  if (task.status === "cancelled") return "stopped";
  return "idle";
}

function scheduleStatus(schedule: Schedule): CompactStatus {
  if (!schedule.enabled) return "paused";
  if (schedule.nextRunAt && Date.parse(schedule.nextRunAt) <= Date.now()) return "attention";
  return "waiting";
}

function browserJobStatus(job: BrowserJob): CompactStatus {
  if (job.status === "failed") return "attention";
  if (job.status === "queued" || job.status === "claimed") return "running";
  if (job.status === "cancelled") return "stopped";
  return "complete";
}

function shortTitle(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 3).join(" ") || "Untitled";
}

function CompactPane({ type, title, description, status, expandOnHover, children }: {
  type: string;
  title: string;
  description: string;
  status: CompactStatus;
  expandOnHover: boolean;
  children?: ReactNode;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const presentation = statusPresentation[status];
  const shownExpanded = expanded || (expandOnHover && hovered);

  return (
    <article
      className={`compact-pane status-${status}${shownExpanded ? " expanded" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        className="compact-pane-toggle nopan"
        type="button"
        aria-expanded={shownExpanded}
        title={shownExpanded ? `Collapse ${title}` : `Expand ${title}`}
        onClick={(event) => { if (!event.shiftKey) setExpanded(!expanded); }}
      >
        <span className="compact-status" aria-label={presentation.label}>{presentation.icon}</span>
        <span className="compact-type">{type}</span>
        <span className="compact-short-title">{shortTitle(title)}</span>
        <span className="compact-copy"><strong>{title}</strong><small>{description}</small></span>
        <span className="compact-chevron" aria-hidden="true">{shownExpanded ? "←" : "→"}</span>
      </button>
      {shownExpanded && children ? <div className="compact-detail nodrag nopan nowheel">{children}</div> : null}
    </article>
  );
}

function PaneFlowNode({ data }: NodeProps<CanvasFlowNode>): React.JSX.Element {
  const trace = data.provenance;
  const traceTitle = trace
    ? [
      trace.prompt ? `Prompt: ${trace.prompt}` : undefined,
      trace.createdBy ? `Created by ${trace.createdBy.itemType}:${trace.createdBy.itemId}` : undefined,
      trace.parent ? `Parent ${trace.parent.itemType}:${trace.parent.itemId}` : undefined,
      `${data.connectionCount ?? 0} graph connection${data.connectionCount === 1 ? "" : "s"}`,
    ].filter(Boolean).join("\n")
    : `${data.connectionCount ?? 0} graph connections`;
  return <div className="canvas-graph-node">
    <Handle type="target" position={Position.Left} isConnectable={false} />
    {data.content}
    {(trace || data.connectionCount) ? <div className="provenance-badge nodrag" title={traceTitle}>
      <span>↳</span><strong>{trace?.createdBy ? shortTitle(trace.createdBy.itemType.replaceAll("_", " ")) : "Linked"}</strong><small>{data.connectionCount ?? 0}</small>
    </div> : null}
    <Handle type="source" position={Position.Right} isConnectable={false} />
  </div>;
}

function FolderFlowNode({ data }: NodeProps<CanvasFlowNode>): React.JSX.Element {
  const folder = data.folder!;
  return <article className={`canvas-folder${data.dropActive ? " drag-over" : ""}`}>
    <button type="button" className="canvas-folder-open nopan" onClick={(event) => { if (!event.shiftKey) data.onOpen?.(); }}>
      <span className="folder-counter" aria-live="polite" aria-label={`${data.count ?? 0} items`}>{data.count ?? 0}</span>
      <span className="folder-glyph">{folderIconPresentation[folder.icon]}</span>
      <strong>{folder.name}</strong><small>{data.systemFolder ? (folder.id === TRASH_FOLDER_ID ? "Removed items" : "Completed history") : "Open folder"}</small>
    </button>
  </article>;
}

const canvasNodeTypes = { pane: PaneFlowNode, folder: FolderFlowNode };

function EmptyPane({ label }: { label: string }): React.JSX.Element {
  return <div className="compact-empty">{label}</div>;
}

function DispatcherActivity({ kind, label, detail }: { kind: DispatcherActivityKind; label: string; detail: string }): React.JSX.Element {
  const icons: Record<DispatcherActivityKind, string> = {
    routing: "⇢", approval: "◇", agent: "✦", command: ">_", browser: "◎", complete: "✓",
  };
  return <div className={`dispatcher-activity activity-${kind}`} title={detail}>
    <i aria-hidden="true">{icons[kind]}</i><span><strong>{label}</strong><small>{detail}</small></span>
  </div>;
}

function sessionItemId(session: ClaudeAgentSession): string {
  return session.sessionId ?? session.id ?? `${session.cwd}:${session.startedAt}`;
}

export function SimplifiedView({
  tasks,
  sessions,
  runs,
  approvals,
  notifications,
  schedules,
  memories,
  abilities,
  browserJobs,
  browserStatus,
  folders,
  placements,
  layouts,
  trashedItems,
  provenance,
  defaultCwd,
  onChange,
}: {
  tasks: Task[];
  sessions: ClaudeAgentSession[];
  runs: Run[];
  approvals: Approval[];
  notifications: AssistantNotification[];
  schedules: Schedule[];
  memories: Memory[];
  abilities: AbilityManifest[];
  browserJobs: BrowserJob[];
  browserStatus: BrowserAutomationStatus;
  folders: WorkspaceFolder[];
  placements: WorkspaceItemPlacement[];
  layouts: WorkspaceItemLayout[];
  trashedItems: WorkspaceTrashedItem[];
  provenance: WorkspaceProvenanceGraph;
  defaultCwd: string;
  onChange: () => void;
}): React.JSX.Element {
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [error, setError] = useState<string>();
  const [dropTarget, setDropTarget] = useState<string>();
  const [folderFilter, setFolderFilter] = useState<FolderFilter>(null);
  const [folderName, setFolderName] = useState("");
  const [folderIcon, setFolderIcon] = useState<WorkspaceFolderIcon>("folder");
  const [editingFolder, setEditingFolder] = useState(false);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenu>();
  const [diagnosticMessages, setDiagnosticMessages] = useState<DiagnosticMessage[]>([]);
  const diagnosticSequence = useRef(0);
  const lastDiagnostic = useRef<string | undefined>(undefined);
  const [permissionMode, setPermissionMode] = useState<ClaudePermissionMode>(() => {
    if (typeof window === "undefined") return "auto";
    const saved = window.localStorage.getItem("cc-assistant-permission-mode");
    return saved === "manual" || saved === "bypassPermissions" ? saved : "auto";
  });
  const [paneInputs, setPaneInputs] = useState<Record<string, string>>({});
  const flowInstance = useRef<ReactFlowInstance<CanvasFlowNode>>(null);
  const selectionSnapshot = useRef<Set<string>>(new Set());
  const settingsRef = useRef<HTMLDetailsElement>(null);
  const trashDropRef = useRef<HTMLButtonElement>(null);
  const baseDropRef = useRef<HTMLDivElement>(null);
  const [expandOnHover, setExpandOnHover] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("cc-assistant-expand-on-hover") === "true");
  const [theme, setTheme] = useState<ThemeId>(() => {
    if (typeof window === "undefined") return "forest";
    const saved = window.localStorage.getItem("cc-assistant-theme");
    return themes.some((candidate) => candidate.id === saved) ? saved as ThemeId : "forest";
  });
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>();
  const [runtimeRecipe, setRuntimeRecipe] = useState<RuntimeRecipe>();
  const [runtimeDaemon, setRuntimeDaemon] = useState<{ platform: string; host: string; port: number; allowedRoots: string[]; dataDir: string; browser?: unknown; managedAgent?: unknown }>();
  const [slashCommand, setSlashCommand] = useState("/compact");
  const [transcriptWindows, setTranscriptWindows] = useState<TranscriptWindow[]>([]);

  const refreshRuntime = async (): Promise<void> => {
    try {
      const [configuration, status] = await Promise.all([getRuntimeConfig(), getRuntimeStatus()]);
      setRuntimeRecipe(configuration.recipe);
      setRuntimeDaemon(configuration.daemon);
      setRuntimeStatus(status);
      setPermissionMode(configuration.recipe.dispatcherPermissionMode);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not inspect the runtime");
    }
  };

  useEffect(() => {
    void refreshRuntime();
    const timer = window.setInterval(() => void getRuntimeStatus().then(setRuntimeStatus).catch(() => undefined), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("cc-assistant-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("cc-assistant-expand-on-hover", String(expandOnHover));
  }, [expandOnHover]);

  useEffect(() => {
    window.localStorage.setItem("cc-assistant-permission-mode", permissionMode);
  }, [permissionMode]);

  useEffect(() => {
    if (folderFilter && folderFilter !== ARCHIVE_FOLDER_ID && folderFilter !== TRASH_FOLDER_ID && !folders.some((folder) => folder.id === folderFilter)) {
      setFolderFilter(null);
    }
  }, [folderFilter, folders]);

  useEffect(() => {
    const text = error ?? feedback;
    if (!text || text === lastDiagnostic.current) return;
    lastDiagnostic.current = text;
    diagnosticSequence.current += 1;
    setDiagnosticMessages((current) => [{
      id: diagnosticSequence.current,
      level: error ? "error" as const : "info" as const,
      text,
      at: new Date().toLocaleTimeString(),
    }, ...current].slice(0, 30));
  }, [error, feedback]);

  useEffect(() => {
    const closeMenu = (): void => setContextMenu(undefined);
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const paneInput = (key: string, fallback = ""): string => paneInputs[key] ?? fallback;
  const setPaneInput = (key: string, value: string): void => setPaneInputs((current) => ({ ...current, [key]: value }));

  const manageClaudeSession = async (
    session: ClaudeAgentSession,
    action: "message" | "continue" | "stop" | "respawn" | "remove",
  ): Promise<void> => {
    const target = session.id ?? session.sessionId ?? session.name;
    if (!target) return setError("This Claude session has no stable control identifier.");
    const inputKey = `claude:${sessionItemId(session)}`;
    const message = paneInput(inputKey).trim();
    if ((action === "message" || action === "continue") && !message) return setError("Enter a message or continuation prompt first.");
    setBusy(`session:${sessionItemId(session)}`); setError(undefined);
    try {
      await controlClaudeSession(action === "message" ? { action, target, message }
        : action === "continue" ? { action, target, prompt: message }
          : { action, target });
      setPaneInput(inputKey, "");
      setFeedback(`${action === "message" ? "Message" : action} proposed for ${session.name ?? target}; approve it in the waiting approval pane.`);
      onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not ${action} the Claude session`);
    } finally { setBusy(undefined); }
  };

  const changeTaskStatus = async (task: Task, status: Task["status"]): Promise<void> => {
    setBusy(`task:${task.id}`); setError(undefined);
    try {
      await updateTask(task.id, { status, expectedRevision: task.revision });
      setFeedback(`Task “${task.title}” is now ${status}.`);
      onChange();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update the task"); }
    finally { setBusy(undefined); }
  };

  const toggleSchedule = async (schedule: Schedule): Promise<void> => {
    setBusy(`schedule:${schedule.id}`); setError(undefined);
    try {
      await updateSchedule(schedule.id, { enabled: !schedule.enabled, expectedRevision: schedule.revision });
      setFeedback(`${schedule.name} ${schedule.enabled ? "paused" : "enabled"}.`);
      onChange();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update the trigger"); }
    finally { setBusy(undefined); }
  };

  const queueBrowserAction = async (kind: "calendar" | "slack"): Promise<void> => {
    setBusy(`browser:${kind}`); setError(undefined);
    try {
      await createBrowserJob(kind === "calendar"
        ? { adapter: "google_calendar", action: "list_visible_events", input: {} }
        : { adapter: "slack", action: "list_unreads", input: {} });
      setFeedback(`${kind === "calendar" ? "Calendar refresh" : "Slack unread check"} queued.`);
      onChange();
    } catch (caught) { setError(caught instanceof Error ? caught.message : `Could not queue the ${kind} action`); }
    finally { setBusy(undefined); }
  };

  const retryBrowserJob = async (job: BrowserJob): Promise<void> => {
    setBusy(`browser:${job.id}`); setError(undefined);
    try {
      if (job.adapter === "google_calendar" && job.action === "list_visible_events") {
        await createBrowserJob({ adapter: "google_calendar", action: "list_visible_events", input: {} });
      } else if (job.adapter === "google_calendar" && job.action === "list_events") {
        const view = job.input.view === "week" || job.input.view === "month" ? job.input.view : "day";
        await createBrowserJob({ adapter: "google_calendar", action: "list_events", input: { date: String(job.input.date), view } });
      } else if (job.adapter === "google_calendar" && job.action === "create_event") {
        await createBrowserJob({ adapter: "google_calendar", action: "create_event", input: {
          title: String(job.input.title), start: String(job.input.start), end: String(job.input.end),
          ...(typeof job.input.description === "string" ? { description: job.input.description } : {}),
        } });
      } else if (job.adapter === "slack" && job.action === "list_unreads") {
        await createBrowserJob({ adapter: "slack", action: "list_unreads", input: {} });
      } else if (job.adapter === "slack" && job.action === "read_channel") {
        await createBrowserJob({ adapter: "slack", action: "read_channel", input: { channelName: String(job.input.channelName) } });
      } else if (job.adapter === "slack" && job.action === "send_message") {
        await createBrowserJob({ adapter: "slack", action: "send_message", input: { channelName: String(job.input.channelName), text: String(job.input.text) } });
      } else throw new Error(`Unsupported browser action ${job.adapter}:${job.action}`);
      setFeedback(`Queued another ${job.action.replaceAll("_", " ")} job.`);
      onChange();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not retry the browser job"); }
    finally { setBusy(undefined); }
  };

  const placementByItem = useMemo(() => new Map(
    placements.map((placement) => [placementKey(placement.itemType, placement.itemId), placement.folderId]),
  ), [placements]);
  const layoutByItem = useMemo(() => new Map(
    layouts.map((layout) => [placementKey(layout.itemType, layout.itemId), { x: layout.x, y: layout.y }]),
  ), [layouts]);
  const selectedFolder = folders.find((folder) => folder.id === folderFilter);
  useEffect(() => {
    if (!selectedFolder) return;
    setFolderName(selectedFolder.name);
    setFolderIcon(selectedFolder.icon);
  }, [selectedFolder?.id, selectedFolder?.revision]);
  const mainController = useMemo(() => sessions
    .filter((session) => session.pid && isMainControllerName(session.name))
    .sort((left, right) => right.startedAt - left.startedAt)[0], [sessions]);
  const mainControllerStatus = mainController ? sessionStatus(mainController) : "attention";
  const archiveOpen = folderFilter === ARCHIVE_FOLDER_ID;
  const trashOpen = folderFilter === TRASH_FOLDER_ID;
  const trashedKeys = useMemo(() => new Set(
    trashedItems.map((entry) => placementKey(entry.itemType, entry.itemId)),
  ), [trashedItems]);
  const archivedKeys = useMemo(() => new Set([
    ...tasks.filter((task) => shouldArchiveCanvasItem("task", task.status)).map((task) => placementKey("task", task.id)),
    ...runs.filter((run) => shouldArchiveCanvasItem("run", run.status)).map((run) => placementKey("run", run.id)),
    ...approvals.filter((approval) => shouldArchiveCanvasItem("approval", approval.status)).map((approval) => placementKey("approval", approval.id)),
    ...notifications.filter((notification) => shouldArchiveCanvasItem("notification", notification.read)).map((notification) => placementKey("notification", notification.id)),
    ...sessions.filter(shouldArchiveClaudeSession).map((session) => placementKey("claude_session", sessionItemId(session))),
    ...browserJobs.filter((job) => shouldArchiveCanvasItem("browser_job", job.status)).map((job) => placementKey("browser_job", job.id)),
  ]), [tasks, runs, approvals, notifications, sessions, browserJobs]);
  const archiveCount = visibleArchiveCount(archivedKeys, trashedKeys);

  const visible = (itemType: WorkspaceItemType, itemId: string): boolean => {
    const key = placementKey(itemType, itemId);
    const trashed = trashedKeys.has(key);
    const archived = archivedKeys.has(key);
    if (trashOpen) return trashed;
    if (trashed) return false;
    if (archiveOpen) return archived;
    if (archived) return false;
    const folderId = placementByItem.get(placementKey(itemType, itemId));
    return folderFilter ? folderId === folderFilter : folderId === undefined;
  };
  const item = (itemType: WorkspaceItemType, itemId: string, title: string): DraggableItem => ({ itemType, itemId, title });

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const input = request.trim();
    if (!input) return;
    setBusy("dispatcher"); setError(undefined); setFeedback(undefined);
    try {
      const proposal = await dispatchInput(input, undefined, selectedFolder ? {
        workspaceFolderId: selectedFolder.id,
        workspaceFolderName: selectedFolder.name,
        workspaceView: "folder",
      } : { workspaceView: "base" });
      if (selectedFolder) {
        await Promise.all([
          moveWorkspaceItem({ itemType: "run", itemId: proposal.run.id, folderId: selectedFolder.id }),
          ...(proposal.approval.status === "pending"
            ? [moveWorkspaceItem({ itemType: "approval", itemId: proposal.approval.id, folderId: selectedFolder.id })]
            : []),
        ]);
      }
      setRequest("");
      setFeedback(proposal.approval.status === "pending"
        ? (selectedFolder
          ? `Dispatcher request queued in “${selectedFolder.name}” for one-time approval.`
          : "Dispatcher request queued for one-time approval.")
        : (selectedFolder
          ? `Dispatcher request delivered automatically in “${selectedFolder.name}”.`
          : "Dispatcher request delivered automatically."));
      onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reach the dispatcher");
    } finally { setBusy(undefined); }
  };

  const dispatcherKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  const launchController = async (): Promise<void> => {
    setBusy("controller-launch"); setError(undefined);
    try {
      await controlRuntime({ action: mainController ? "relaunch_dispatcher" : "repair" });
      setFeedback(`${mainController ? "Dispatcher relaunch" : "Runtime repair"} proposed. Approve it once to update the tmux runtime.`);
      onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not propose the controller session");
    } finally { setBusy(undefined); }
  };

  const proposeRuntimeControl = async (
    input: Parameters<typeof controlRuntime>[0],
    success: string,
  ): Promise<void> => {
    setBusy(`runtime:${input.action}`); setError(undefined);
    try {
      const proposal = await controlRuntime(input);
      setFeedback(proposal.approval.status === "approved"
        ? success
        : `${success} Approve the protected runtime action to continue.`);
      onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not control the runtime");
    } finally { setBusy(undefined); }
  };

  const saveRuntimeRecipe = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!runtimeRecipe) return;
    setBusy("runtime:config"); setError(undefined);
    try {
      const saved = await updateRuntimeConfig({ ...runtimeRecipe, dispatcherPermissionMode: permissionMode });
      setRuntimeRecipe(saved);
      setFeedback("Runtime configuration saved. Repair or relaunch the dispatcher to apply process-level changes.");
      await refreshRuntime();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save runtime configuration");
    } finally { setBusy(undefined); }
  };

  const selectPermissionMode = async (mode: ClaudePermissionMode): Promise<void> => {
    setPermissionMode(mode);
    if (!runtimeRecipe) return;
    try {
      const saved = await updateRuntimeConfig({ ...runtimeRecipe, dispatcherPermissionMode: mode });
      setRuntimeRecipe(saved);
      setFeedback(`Default dispatcher permission mode set to ${mode}. Relaunch the dispatcher to apply it.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save the permission mode"); }
  };

  const openTranscript = async (session: ClaudeAgentSession): Promise<void> => {
    const reference = session.id ?? session.sessionId ?? session.name;
    if (!reference) return setError("This Claude session has no transcript identifier.");
    setBusy(`transcript:${sessionItemId(session)}`); setError(undefined);
    try {
      const transcript = await getClaudeTranscript(reference);
      setTranscriptWindows((current) => {
        const existing = current.find((candidate) => candidate.id === reference);
        if (existing) return current.map((candidate) => candidate.id === reference
          ? { ...candidate, transcript, minimized: false }
          : candidate);
        const offset = current.length * 28;
        return [...current, { id: reference, session, transcript, x: 72 + offset, y: 120 + offset, collapsed: false, minimized: false }];
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the Claude transcript");
    } finally { setBusy(undefined); }
  };

  const refreshTranscript = async (id: string): Promise<void> => {
    const windowState = transcriptWindows.find((candidate) => candidate.id === id);
    if (!windowState) return;
    try {
      const transcript = await getClaudeTranscript(id);
      setTranscriptWindows((current) => current.map((candidate) => candidate.id === id ? { ...candidate, transcript } : candidate));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not refresh the transcript"); }
  };

  const beginTranscriptDrag = (event: React.PointerEvent<HTMLDivElement>, id: string): void => {
    if ((event.target as HTMLElement).closest("button")) return;
    const current = transcriptWindows.find((candidate) => candidate.id === id);
    if (!current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = { clientX: event.clientX, clientY: event.clientY, x: current.x, y: current.y };
    const move = (moveEvent: PointerEvent): void => setTranscriptWindows((windows) => windows.map((candidate) => candidate.id === id
      ? { ...candidate, x: Math.max(0, start.x + moveEvent.clientX - start.clientX), y: Math.max(0, start.y + moveEvent.clientY - start.clientY) }
      : candidate));
    const stop = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };

  const invokePaneAbility = async (ability: AbilityManifest): Promise<void> => {
    setBusy(`ability:${ability.id}`); setError(undefined);
    try {
      const raw = paneInput(`ability:${ability.id}`, "{}").trim() || "{}";
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Ability input must be a JSON object.");
      await invokeAbility(ability.id, parsed as Record<string, unknown>);
      setFeedback(`${ability.name} was proposed; approve the command in the waiting approval pane.`);
      onChange();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not invoke the ability"); }
    finally { setBusy(undefined); }
  };

  const retryRunThroughDispatcher = async (run: Run): Promise<void> => {
    setBusy(`run:${run.id}`); setError(undefined);
    try {
      await dispatchInput(`Retry the managed ${run.kind} run titled ${JSON.stringify(run.title)}. Original working directory: ${run.cwd}. Original prompt: ${run.prompt ?? "not recorded"}. Previous error/result: ${run.error ?? run.result ?? "none"}.`);
      setFeedback(`Retry request for “${run.title}” sent to the controller.`);
      onChange();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not request a retry"); }
    finally { setBusy(undefined); }
  };

  const archivePaneMemory = async (memory: Memory): Promise<void> => {
    if (!window.confirm(`Archive the memory “${memory.title}”?`)) return;
    setBusy(`memory:${memory.id}`); setError(undefined);
    try {
      await archiveMemory(memory.id, memory.revision);
      setFeedback(`Archived memory “${memory.title}”.`);
      onChange();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not archive the memory"); }
    finally { setBusy(undefined); }
  };

  const decide = async (approval: Approval, decision: "approved" | "denied"): Promise<void> => {
    setBusy(approval.id); setError(undefined);
    try { await resolveApproval(approval.id, decision); onChange(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not resolve approval"); }
    finally { setBusy(undefined); }
  };

  const moveItemsToFolder = async (items: DraggableItem[], folderId: string | null): Promise<void> => {
    const unique = [...new Map(items.map((candidate) => [placementKey(candidate.itemType, candidate.itemId), candidate])).values()];
    if (unique.length === 0) return;
    setDropTarget(undefined); setBusy("organizer"); setError(undefined);
    try {
      await Promise.all(unique.map((candidate) => moveWorkspaceItem({
        itemType: candidate.itemType, itemId: candidate.itemId, folderId,
      })));
      setFeedback(folderId
        ? `Moved ${unique.length} item${unique.length === 1 ? "" : "s"} into the folder.`
        : `Removed ${unique.length} item${unique.length === 1 ? "" : "s"} from the folder.`);
      onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not move the selected items");
    } finally { setBusy(undefined); }
  };

  const resetLayout = async (): Promise<void> => {
    setBusy("canvas"); setError(undefined);
    try {
      await resetWorkspaceItemLayouts();
      setFeedback("Canvas positions reset to the automatic layout.");
      onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reset the canvas layout");
    } finally { setBusy(undefined); }
  };

  const trashItems = async (items: DraggableItem[]): Promise<void> => {
    const unique = [...new Map(items.map((candidate) => [placementKey(candidate.itemType, candidate.itemId), candidate])).values()];
    if (unique.length === 0) return;
    setDropTarget(undefined);
    setBusy("organizer"); setError(undefined);
    try {
      await Promise.all(unique.map((candidate) => trashWorkspaceItem({
        itemType: candidate.itemType, itemId: candidate.itemId,
      })));
      setFeedback(`Moved ${unique.length} item${unique.length === 1 ? "" : "s"} to Trash. ${unique.length === 1 ? "It remains" : "They remain"} recoverable.`);
      onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not move the selected items to Trash");
    } finally { setBusy(undefined); }
  };

  const restoreItems = async (items: DraggableItem[]): Promise<void> => {
    const unique = [...new Map(items.map((candidate) => [placementKey(candidate.itemType, candidate.itemId), candidate])).values()];
    if (unique.length === 0) return;
    setBusy("organizer"); setError(undefined);
    try {
      await Promise.all(unique.map((candidate) => restoreWorkspaceItem({
        itemType: candidate.itemType, itemId: candidate.itemId,
      })));
      setFeedback(`Restored ${unique.length} item${unique.length === 1 ? "" : "s"} to the base workspace.`);
      onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not restore the selected items");
    } finally { setBusy(undefined); }
  };

  const groupItems = async (draggedItems: DraggableItem[], target: DraggableItem): Promise<void> => {
    const unique = [...new Map(draggedItems
      .filter((candidate) => placementKey(candidate.itemType, candidate.itemId) !== placementKey(target.itemType, target.itemId))
      .map((candidate) => [placementKey(candidate.itemType, candidate.itemId), candidate])).values()];
    if (unique.length === 0) return;
    setBusy("organizer"); setError(undefined);
    try {
      const targetFolderId = placementByItem.get(placementKey(target.itemType, target.itemId));
      const folder = targetFolderId
        ? folders.find((candidate) => candidate.id === targetFolderId)
        : await createWorkspaceFolder({ name: automaticFolderName(target.title, unique[0]!.title), icon: "folder" });
      if (!folder) throw new Error("The destination folder no longer exists.");
      if (!targetFolderId) await moveWorkspaceItem({ itemType: target.itemType, itemId: target.itemId, folderId: folder.id });
      await Promise.all(unique.map((candidate) => moveWorkspaceItem({ itemType: candidate.itemType, itemId: candidate.itemId, folderId: folder.id })));
      setFolderFilter(folder.id);
      setFeedback(`Grouped “${target.title}” with ${unique.length} item${unique.length === 1 ? "" : "s"} in “${folder.name}”.`);
      onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not group the items");
    } finally { setBusy(undefined); }
  };

  const saveFolder = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!selectedFolder || !folderName.trim()) return;
    setBusy("organizer"); setError(undefined);
    try {
      await updateWorkspaceFolder(selectedFolder.id, {
        name: folderName, icon: folderIcon, expectedRevision: selectedFolder.revision,
      });
      setEditingFolder(false); setFolderName(""); setFeedback("Folder updated."); onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the folder");
    } finally { setBusy(undefined); }
  };

  const removeFolder = async (): Promise<void> => {
    if (!selectedFolder) return;
    setBusy("organizer"); setError(undefined);
    try {
      await deleteWorkspaceFolder(selectedFolder.id);
      setFolderFilter(null); setEditingFolder(false);
      setFeedback(`Deleted folder “${selectedFolder.name}”; its items returned to the base workspace.`); onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the folder");
    } finally { setBusy(undefined); }
  };

  const removeFolderById = async (folder: WorkspaceFolder): Promise<void> => {
    if (!window.confirm(`Delete the folder “${folder.name}”? Its items will return to the base workspace.`)) return;
    setBusy("organizer"); setError(undefined);
    try {
      await deleteWorkspaceFolder(folder.id);
      if (folderFilter === folder.id) setFolderFilter(null);
      setFeedback(`Deleted folder “${folder.name}”; its items returned to the base workspace.`);
      onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the folder");
    } finally { setBusy(undefined); }
  };

  const activeTasks = tasks.filter((task) => !["done", "cancelled", "blocked"].includes(task.status) && visible("task", task.id));
  const blockedTasks = tasks.filter((task) => task.status === "blocked" && visible("task", task.id));
  const archivedTasks = tasks.filter((task) => ["done", "cancelled"].includes(task.status) && visible("task", task.id));
  const visibleApprovals = approvals.filter((approval) => visible("approval", approval.id));
  const visibleNotifications = notifications.filter((notification) => visible("notification", notification.id));
  const visibleSessions = sessions.filter((session) => visible("claude_session", sessionItemId(session)));
  const activeRuns = runs.filter((run) => !["succeeded", "failed", "cancelled"].includes(run.status) && visible("run", run.id));
  const failedRuns = runs.filter((run) => run.status === "failed" && visible("run", run.id));
  const recentRuns = runs.filter((run) => ["succeeded", "cancelled"].includes(run.status) && visible("run", run.id));
  const visibleSchedules = schedules.filter((schedule) => visible("schedule", schedule.id));
  const visibleAbilities = abilities.filter((ability) => visible("ability", ability.id));
  const visibleBrowserJobs = browserJobs.filter((job) => visible("browser_job", job.id));
  const visibleMemories = memories.filter((memory) => visible("memory", memory.id));
  const canvasEntries: CanvasEntry[] = [
    ...visibleApprovals.map((approval) => ({ item: item("approval", approval.id, approval.summary), content:
      <CompactPane type="Approval" title={approval.summary} description={sentence(`A one-time ${approval.actionType.replaceAll("_", " ")} decision is waiting`, "Approval required")} status="attention" expandOnHover={expandOnHover}>
        <pre>{JSON.stringify(approval.payload, null, 2)}</pre><div className="compact-actions"><button disabled={busy === approval.id} onClick={() => void decide(approval, "denied")}>Deny</button><button className="primary" disabled={busy === approval.id} onClick={() => void decide(approval, "approved")}>Approve once</button></div>
      </CompactPane> })),
    ...visibleNotifications.map((notification) => ({ item: item("notification", notification.id, notification.title), content:
      <CompactPane type="Alert" title={notification.title} description={sentence(notification.body, "An unread assistant notification needs review")} status="attention" expandOnHover={expandOnHover}>
        <p>{notification.body || "No additional details."}</p><button disabled={busy === notification.id} onClick={() => { setBusy(notification.id); void markNotificationRead(notification.id).then(onChange).finally(() => setBusy(undefined)); }}>Dismiss</button>
      </CompactPane> })),
    ...blockedTasks.map((task) => ({ item: item("task", task.id, task.title), content:
      <CompactPane type="Task" title={task.title} description={sentence(task.description, "A task is blocked and needs a decision or external change")} status="attention" expandOnHover={expandOnHover}>
        <p>{task.description || "No blocker was recorded."}</p><div className="compact-actions wrap"><button disabled={busy === `task:${task.id}`} onClick={() => void changeTaskStatus(task, "active")}>Resume</button><button disabled={busy === `task:${task.id}`} onClick={() => void changeTaskStatus(task, "done")}>Complete</button><button className="danger" disabled={busy === `task:${task.id}`} onClick={() => void changeTaskStatus(task, "cancelled")}>Cancel</button></div>
      </CompactPane> })),
    ...archivedTasks.map((task) => ({ item: item("task", task.id, task.title), content:
      <CompactPane type="Task" title={task.title} description={sentence(task.description, `A ${task.status} task kept for history`)} status={taskStatus(task)} expandOnHover={expandOnHover}>
        <p>{task.description || "No description."}</p><small>{task.status} · P{task.priority} · {task.project ?? "No project"}</small><button disabled={busy === `task:${task.id}`} onClick={() => void changeTaskStatus(task, "planned")}>Restore to planned</button>
      </CompactPane> })),
    ...failedRuns.map((run) => ({ item: item("run", run.id, run.title), content:
      <CompactPane type="Run" title={run.title} description={sentence(run.error ?? "A managed run failed", "A managed run failed")} status="attention" expandOnHover={expandOnHover}><pre>{run.error ?? run.result ?? "No failure detail."}</pre><button disabled={busy === `run:${run.id}`} onClick={() => void retryRunThroughDispatcher(run)}>Ask controller to retry</button></CompactPane> })),
    ...activeTasks.map((task) => ({ item: item("task", task.id, task.title), content:
      <CompactPane type="Task" title={task.title} description={sentence(task.description, `A ${task.status} task${task.project ? ` in ${task.project}` : ""}`)} status={taskStatus(task)} expandOnHover={expandOnHover}>
        <p>{task.description || "No description."}</p><small>Priority P{task.priority} · {task.project ?? "No project"}</small><div className="compact-actions wrap">{task.status !== "planned" ? <button disabled={busy === `task:${task.id}`} onClick={() => void changeTaskStatus(task, "planned")}>Plan</button> : null}{task.status !== "active" ? <button disabled={busy === `task:${task.id}`} onClick={() => void changeTaskStatus(task, "active")}>Start</button> : null}<button disabled={busy === `task:${task.id}`} onClick={() => void changeTaskStatus(task, "blocked")}>Block</button><button className="primary" disabled={busy === `task:${task.id}`} onClick={() => void changeTaskStatus(task, "done")}>Complete</button><button className="danger" disabled={busy === `task:${task.id}`} onClick={() => void changeTaskStatus(task, "cancelled")}>Cancel</button></div>
      </CompactPane> })),
    ...visibleSessions.map((session) => ({ item: item("claude_session", sessionItemId(session), session.name ?? session.id ?? "Interactive session"), content:
      <CompactPane type="Claude" title={session.name ?? session.id ?? "Interactive session"} description={sentence(`A ${session.kind} Claude session is ${session.waitingFor ?? session.status ?? session.state ?? "saved"}`, "A Claude session")} status={sessionStatus(session)} expandOnHover={expandOnHover}>
        <p>{session.cwd}</p><textarea aria-label={`Message ${session.name ?? session.id ?? "Claude session"}`} rows={3} value={paneInput(`claude:${sessionItemId(session)}`)} onChange={(event) => setPaneInput(`claude:${sessionItemId(session)}`, event.target.value)} placeholder="Message or continuation prompt…" /><div className="compact-actions wrap"><button disabled={busy === `session:${sessionItemId(session)}`} onClick={() => void manageClaudeSession(session, "message")}>Send message</button><button disabled={busy === `session:${sessionItemId(session)}`} onClick={() => void manageClaudeSession(session, "continue")}>Continue</button><button disabled={busy === `transcript:${sessionItemId(session)}`} onClick={() => void openTranscript(session)}>Transcript</button><button disabled={busy?.startsWith("runtime:")} onClick={() => void proposeRuntimeControl({ action: "open_session_terminal", target: session.id ?? session.sessionId ?? session.name ?? "" }, "Terminal launch started.")}>Open terminal</button>{session.kind === "background" && session.id ? <><button disabled={busy === `session:${sessionItemId(session)}`} onClick={() => void manageClaudeSession(session, "stop")}>Stop</button><button disabled={busy === `session:${sessionItemId(session)}`} onClick={() => void manageClaudeSession(session, "respawn")}>Respawn</button></> : null}</div>{session.kind === "background" && session.id ? <div className="terminal-connect"><code>claude attach {session.id}</code><button onClick={() => void navigator.clipboard.writeText(`claude attach ${session.id}`).then(() => setFeedback("Attach command copied.")).catch(() => setError("Could not copy the attach command."))}>Copy command</button></div> : <small>Interactive recipe sessions attach through their matching tmux pane.</small>}
      </CompactPane> })),
    ...activeRuns.map((run) => ({ item: item("run", run.id, run.title), content:
      <CompactPane type="Run" title={run.title} description={sentence(run.prompt ?? `${run.kind} work is ${run.status.replaceAll("_", " ")}`, "Managed work")} status={runStatus(run)} expandOnHover={expandOnHover}><p>{run.prompt ?? run.result ?? run.cwd}</p><button onClick={() => void cancelRun(run.id).then(onChange)}>Cancel</button></CompactPane> })),
    ...visibleSchedules.map((schedule) => ({ item: item("schedule", schedule.id, schedule.name), content:
      <CompactPane type="Trigger" title={schedule.name} description={sentence(`${schedule.triggerKind.replaceAll("_", " ")} triggers ${schedule.actionKind}; next run ${formatTime(schedule.nextRunAt)}`, "Configured automation")} status={scheduleStatus(schedule)} expandOnHover={expandOnHover}><pre>{JSON.stringify({ trigger: schedule.trigger, action: schedule.action }, null, 2)}</pre><div className="compact-actions wrap"><button disabled={busy === `schedule:${schedule.id}`} onClick={() => void toggleSchedule(schedule)}>{schedule.enabled ? "Pause" : "Enable"}</button><button onClick={() => { setRequest(`Run the scheduled automation ${JSON.stringify(schedule.name)} now. Trigger: ${JSON.stringify(schedule.trigger)}. Action: ${JSON.stringify(schedule.action)}.`); setFeedback("Schedule request loaded into the dispatcher."); }}>Load “run now” request</button></div></CompactPane> })),
    ...visibleAbilities.map((ability) => ({ item: item("ability", ability.id, ability.name), content:
      <CompactPane type="Ability" title={ability.name} description={sentence(ability.description, "An installed command ability is available")} status="neutral" expandOnHover={expandOnHover}><code>{ability.id}</code><small>Required: {ability.inputSchema.required.join(", ") || "none"}</small><textarea aria-label={`${ability.name} JSON input`} rows={4} value={paneInput(`ability:${ability.id}`, "{}")} onChange={(event) => setPaneInput(`ability:${ability.id}`, event.target.value)} spellCheck={false} /><button disabled={busy === `ability:${ability.id}`} onClick={() => void invokePaneAbility(ability)}>Invoke ability</button></CompactPane> })),
    ...visibleBrowserJobs.map((job) => ({ item: item("browser_job", job.id, String(job.input.title ?? job.input.channelName ?? job.action)), content:
      <CompactPane type={job.adapter === "google_calendar" ? (job.action === "create_event" ? "Calendar" : "Calendar check") : "Slack"} title={String(job.input.title ?? job.input.channelName ?? job.action.replaceAll("_", " "))} description={sentence(`${job.adapter.replaceAll("_", " ")} ${job.action.replaceAll("_", " ")} ${job.status}`, "Browser job")} status={browserJobStatus(job)} expandOnHover={expandOnHover}><pre>{JSON.stringify(job.error ?? job.result ?? job.input, null, 2)}</pre><div className="compact-actions wrap"><button disabled={busy === `browser:${job.id}`} onClick={() => void retryBrowserJob(job)}>Run again</button>{job.adapter === "google_calendar" ? <button disabled={busy?.startsWith("browser:")} onClick={() => void queueBrowserAction("calendar")}>Refresh Calendar</button> : <button disabled={busy?.startsWith("browser:")} onClick={() => void queueBrowserAction("slack")}>Check unread</button>}</div></CompactPane> })),
    ...recentRuns.map((run) => ({ item: item("run", run.id, run.title), content:
      <CompactPane type="Run" title={run.title} description={sentence(run.result ?? `${run.kind} work ${run.status}`, "Completed managed work")} status={runStatus(run)} expandOnHover={expandOnHover}><pre>{run.result ?? run.error ?? "No result detail."}</pre><button disabled={busy === `run:${run.id}`} onClick={() => void retryRunThroughDispatcher(run)}>Run a related task</button></CompactPane> })),
    ...visibleMemories.map((memory) => ({ item: item("memory", memory.id, memory.title), content:
      <CompactPane type="Memory" title={memory.title} description={sentence(memory.summary ?? memory.body, "A durable memory page")} status="complete" expandOnHover={expandOnHover}><p>{clip(memory.body, 600)}</p><small>{memory.kind} · revision {memory.revision}</small><div className="compact-actions wrap"><button onClick={() => { setRequest(`Use the memory ${JSON.stringify(memory.title)} (${memory.id}) as context for: `); setFeedback("Memory reference loaded into the dispatcher."); }}>Use in dispatcher</button><button className="danger" disabled={busy === `memory:${memory.id}`} onClick={() => void archivePaneMemory(memory)}>Archive</button></div></CompactPane> })),
  ];
  const arrangementMetadata = (entryItem: DraggableItem): Omit<CanvasArrangeDescriptor, "id" | "title"> => {
    if (entryItem.itemType === "task") {
      const record = tasks.find((candidate) => candidate.id === entryItem.itemId);
      return { category: "Task", status: record ? taskStatus(record) : "neutral", time: Date.parse(record?.updatedAt ?? "") || 0 };
    }
    if (entryItem.itemType === "approval") {
      const record = approvals.find((candidate) => candidate.id === entryItem.itemId);
      return { category: "Approval", status: "attention", time: Date.parse(record?.createdAt ?? "") || 0 };
    }
    if (entryItem.itemType === "notification") {
      const record = notifications.find((candidate) => candidate.id === entryItem.itemId);
      return { category: "Alert", status: record?.read ? "complete" : "attention", time: Date.parse(record?.createdAt ?? "") || 0 };
    }
    if (entryItem.itemType === "claude_session") {
      const record = sessions.find((candidate) => sessionItemId(candidate) === entryItem.itemId);
      return { category: "Claude", status: record ? sessionStatus(record) : "neutral", time: record?.startedAt ?? 0 };
    }
    if (entryItem.itemType === "run") {
      const record = runs.find((candidate) => candidate.id === entryItem.itemId);
      return { category: "Run", status: record ? runStatus(record) : "neutral", time: Date.parse(record?.createdAt ?? "") || 0 };
    }
    if (entryItem.itemType === "schedule") {
      const record = schedules.find((candidate) => candidate.id === entryItem.itemId);
      return { category: "Trigger", status: record ? scheduleStatus(record) : "neutral", time: Date.parse(record?.updatedAt ?? "") || 0 };
    }
    if (entryItem.itemType === "browser_job") {
      const record = browserJobs.find((candidate) => candidate.id === entryItem.itemId);
      return { category: record?.adapter === "slack" ? "Slack" : "Calendar", status: record ? browserJobStatus(record) : "neutral", time: Date.parse(record?.createdAt ?? "") || 0 };
    }
    if (entryItem.itemType === "memory") {
      const record = memories.find((candidate) => candidate.id === entryItem.itemId);
      return { category: "Memory", status: "complete", time: Date.parse(record?.updatedAt ?? "") || 0 };
    }
    return { category: "Ability", status: "neutral", time: 0 };
  };
  const canvasColumns = 7;
  const provenanceByItem = new Map(provenance.items.map((record) => [placementKey(record.itemType, record.itemId), record]));
  const connectionCountByItem = new Map<string, number>();
  for (const link of provenance.links) {
    for (const ref of [link.from, link.to]) {
      const key = placementKey(ref.itemType, ref.itemId);
      connectionCountByItem.set(key, (connectionCountByItem.get(key) ?? 0) + 1);
    }
  }
  const currentControllerNodeId = mainController
    ? flowNodeId("claude_session", sessionItemId(mainController))
    : undefined;
  const knownControllerSessionIds = new Set(sessions
    .filter((session) => isMainControllerName(session.name))
    .map(sessionItemId));
  const provenanceFlowNodeId = (ref: WorkspaceEntityRef): string =>
    ref.itemType === "claude_session" && currentControllerNodeId && knownControllerSessionIds.has(ref.itemId)
      ? currentControllerNodeId
      : flowNodeId(ref.itemType, ref.itemId);
  const baseOpen = folderFilter === null;
  const archiveFolder: WorkspaceFolder = {
    id: ARCHIVE_FOLDER_ID, name: "Archive", icon: "archive",
    createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z", revision: 1,
  };
  const trashFolder: WorkspaceFolder = {
    id: TRASH_FOLDER_ID, name: "Trash", icon: "archive",
    createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z", revision: 1,
  };
  const desiredFlowNodes: CanvasFlowNode[] = [
    ...(baseOpen ? [{
      id: `folder:${ARCHIVE_FOLDER_ID}`, type: "folder", position: layoutByItem.get(placementKey("folder", ARCHIVE_FOLDER_ID)) ?? defaultCanvasPosition(0, canvasColumns), draggable: false,
      data: { kind: "folder" as const, folder: archiveFolder, systemFolder: true, count: archiveCount, onOpen: () => { setFolderFilter(ARCHIVE_FOLDER_ID); setEditingFolder(false); }, entity: { itemType: "folder" as const, itemId: ARCHIVE_FOLDER_ID, title: "Archive" }, arrange: { id: `folder:${ARCHIVE_FOLDER_ID}`, title: "Archive", category: "Folder", status: "complete" as const, time: 0 } },
    } satisfies CanvasFlowNode] : []),
    ...(baseOpen ? [{
      id: `folder:${TRASH_FOLDER_ID}`, type: "folder", position: layoutByItem.get(placementKey("folder", TRASH_FOLDER_ID)) ?? defaultCanvasPosition(1, canvasColumns), draggable: false,
      data: { kind: "folder" as const, folder: trashFolder, systemFolder: true, count: trashedItems.length, onOpen: () => { setFolderFilter(TRASH_FOLDER_ID); setEditingFolder(false); }, entity: { itemType: "folder" as const, itemId: TRASH_FOLDER_ID, title: "Trash" }, arrange: { id: `folder:${TRASH_FOLDER_ID}`, title: "Trash", category: "Folder", status: "stopped" as const, time: 0 } },
    } satisfies CanvasFlowNode] : []),
    ...(baseOpen ? folders.map((folder, index): CanvasFlowNode => ({
      id: `folder:${folder.id}`, type: "folder", position: layoutByItem.get(placementKey("folder", folder.id)) ?? defaultCanvasPosition(index + 2, canvasColumns),
      data: { kind: "folder", folder, count: placements.filter((placement) => placement.folderId === folder.id && !archivedKeys.has(placementKey(placement.itemType, placement.itemId)) && !trashedKeys.has(placementKey(placement.itemType, placement.itemId))).length, onOpen: () => { setFolderFilter(folder.id); setFolderName(folder.name); setFolderIcon(folder.icon); setEditingFolder(false); }, entity: { itemType: "folder", itemId: folder.id, title: folder.name }, arrange: { id: `folder:${folder.id}`, title: folder.name, category: "Folder", status: "neutral", time: Date.parse(folder.updatedAt) || 0 } },
    })) : []),
    ...canvasEntries.map(({ item: entryItem, content }, index): CanvasFlowNode => ({
      id: `item:${placementKey(entryItem.itemType, entryItem.itemId)}`, type: "pane", position: layoutByItem.get(placementKey(entryItem.itemType, entryItem.itemId)) ?? defaultCanvasPosition(index + (baseOpen ? folders.length + 2 : 0), canvasColumns),
      data: { kind: "item", item: entryItem, entity: entryItem, content, provenance: provenanceByItem.get(placementKey(entryItem.itemType, entryItem.itemId)), connectionCount: connectionCountByItem.get(placementKey(entryItem.itemType, entryItem.itemId)) ?? 0, arrange: { id: `item:${placementKey(entryItem.itemType, entryItem.itemId)}`, title: entryItem.title, ...arrangementMetadata(entryItem) } },
    })),
    ...(baseOpen ? [{
      id: "system:browser-worker", type: "pane", position: layoutByItem.get(placementKey("browser_worker", "calendar-slack")) ?? defaultCanvasPosition(canvasEntries.length + folders.length + 2, canvasColumns),
      data: { kind: "system" as const, entity: { itemType: "browser_worker" as const, itemId: "calendar-slack", title: "Calendar & Slack worker" }, provenance: provenanceByItem.get(placementKey("browser_worker", "calendar-slack")), connectionCount: connectionCountByItem.get(placementKey("browser_worker", "calendar-slack")) ?? 0, arrange: { id: "system:browser-worker", title: "Calendar & Slack worker", category: "System", status: browserStatus.state === "running" ? "running" : browserStatus.state === "ready" ? "idle" : browserStatus.state === "error" ? "attention" : "stopped", time: Date.parse(browserStatus.lastCompletedAt ?? "") || 0 }, content:
        <CompactPane type="Browser" title="Calendar & Slack worker" description={sentence(`The signed-in browser worker is ${browserStatus.state}`, "Browser integration status")} status={browserStatus.state === "running" ? "running" : browserStatus.state === "ready" ? "idle" : browserStatus.state === "error" ? "attention" : "stopped"} expandOnHover={expandOnHover}><p>{browserStatus.lastError ?? (browserStatus.lastCompletedAt ? `Last completed ${formatTime(browserStatus.lastCompletedAt)}` : "No recent browser activity.")}</p><div className="compact-actions wrap"><button disabled={busy?.startsWith("browser:")} onClick={() => void queueBrowserAction("calendar")}>Refresh Calendar</button><button disabled={busy?.startsWith("browser:")} onClick={() => void queueBrowserAction("slack")}>Check Slack unread</button></div></CompactPane> },
    } satisfies CanvasFlowNode] : []),
  ];
  const visibleNodeIds = new Set(desiredFlowNodes.map((node) => node.id));
  const flowEdgeMap = new Map<string, Edge>();
  for (const link of provenance.links) {
    const source = provenanceFlowNodeId(link.from);
    const target = provenanceFlowNodeId(link.to);
    if (!visibleNodeIds.has(source) || !visibleNodeIds.has(target)) continue;
    const id = `provenance:${source}:${target}:${link.relation}`;
    flowEdgeMap.set(id, {
      id, source, target, type: "bezier", label: link.relation,
      animated: link.relation === "created" || link.relation === "derived",
      markerEnd: { type: MarkerType.ArrowClosed },
      className: `provenance-edge relation-${link.relation}`,
    });
  }
  const flowEdges = [...flowEdgeMap.values()];
  const canvasItemCount = canvasEntries.length + (baseOpen ? folders.length + 3 : 0);
  const flowRenderKey = [
    folderFilter ?? "base", expandOnHover, busy ?? "", JSON.stringify(paneInputs), browserStatus.state, browserStatus.lastCompletedAt ?? "", browserStatus.lastError ?? "",
    tasks.map((value) => `${value.id}:${value.revision}`).join(","), sessions.map((value) => `${sessionItemId(value)}:${value.state}:${value.status}:${value.waitingFor}`).join(","),
    runs.map((value) => `${value.id}:${value.revision}`).join(","), approvals.map((value) => `${value.id}:${value.status}`).join(","), notifications.map((value) => `${value.id}:${value.read}`).join(","),
    schedules.map((value) => `${value.id}:${value.revision}`).join(","), memories.map((value) => `${value.id}:${value.revision}`).join(","), abilities.map((value) => value.id).join(","), browserJobs.map((value) => `${value.id}:${value.status}`).join(","),
    folders.map((value) => `${value.id}:${value.revision}`).join(","), placements.map((value) => `${placementKey(value.itemType, value.itemId)}:${value.folderId}`).join(","), layouts.map((value) => `${placementKey(value.itemType, value.itemId)}:${value.x}:${value.y}`).join(","), trashedItems.map((value) => `${placementKey(value.itemType, value.itemId)}:${value.trashedAt}`).join(","),
    provenance.items.map((value) => `${placementKey(value.itemType, value.itemId)}:${value.updatedAt}`).join(","), provenance.links.map((value) => `${placementKey(value.from.itemType, value.from.itemId)}:${placementKey(value.to.itemType, value.to.itemId)}:${value.relation}`).join(","),
    canvasNodeRefreshSignature(desiredFlowNodes),
  ].join("|");
  const [flowNodes, setFlowNodes, onFlowNodesChange] = useNodesState<CanvasFlowNode>(desiredFlowNodes);
  const layoutSignature = layouts.map((value) => `${placementKey(value.itemType, value.itemId)}:${value.x}:${value.y}`).join(",");
  const previousCanvasScope = useRef(`${folderFilter ?? "base"}|${layoutSignature}`);
  useEffect(() => {
    const scope = `${folderFilter ?? "base"}|${layoutSignature}`;
    const persistedLayoutChanged = previousCanvasScope.current !== scope;
    previousCanvasScope.current = scope;
    setFlowNodes((current) => {
      const existing = new Map(current.map((node) => [node.id, node]));
      return desiredFlowNodes.map((node) => {
        const previous = existing.get(node.id);
        if (!previous || persistedLayoutChanged) return node;
        return { ...node, position: previous.position, ...(previous.selected !== undefined ? { selected: previous.selected } : {}) };
      });
    });
  }, [flowRenderKey]);
  useEffect(() => {
    selectionSnapshot.current = new Set(flowNodes.filter((node) => node.selected).map((node) => node.id));
  }, [flowNodes]);
  const defaultViewport = useMemo<Viewport>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("cc-assistant-canvas-viewport") ?? "null") as Partial<Viewport> | null;
      if (typeof saved?.x === "number" && typeof saved.y === "number" && typeof saved.zoom === "number") return { x: saved.x, y: saved.y, zoom: saved.zoom };
    } catch { /* Use the default viewport. */ }
    return { x: 0, y: 0, zoom: 1 };
  }, []);
  const autoArrange = async (mode: CanvasArrangeMode): Promise<void> => {
    const liveNodes = flowInstance.current?.getNodes() ?? flowNodes;
    const sizes = Object.fromEntries(liveNodes.map((node) => [node.id, {
      width: node.measured?.width ?? node.width ?? 136,
      height: node.measured?.height ?? node.height ?? 104,
    }]));
    const positions = arrangeCanvasItems(liveNodes.map((node) => node.data.arrange), mode, 6, sizes);
    const arrangedNodes = flowNodes.map((node) => ({ ...node, position: positions[node.id] ?? node.position }));
    setFlowNodes(arrangedNodes);
    setBusy("canvas"); setError(undefined);
    try {
      await Promise.all(arrangedNodes.map((node) => node.data.entity
        ? setWorkspaceItemLayout({
          itemType: node.data.entity.itemType,
          itemId: node.data.entity.itemId,
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
        })
        : Promise.resolve()));
      setFeedback(`Canvas arranged by ${mode === "grid" ? "a compact grid" : mode}.`);
      onChange();
      window.setTimeout(() => { void flowInstance.current?.fitView({ padding: 0.2, maxZoom: 1.1, duration: 450 }); }, 100);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not arrange the canvas");
    } finally { setBusy(undefined); }
  };
  const dragClientPoint = (event: CanvasDragEvent): { x: number; y: number } | undefined => {
    const point = "touches" in event && event.touches.length > 0 ? event.touches[0]
      : "changedTouches" in event && event.changedTouches.length > 0 ? event.changedTouches[0]
        : event;
    return point && "clientX" in point && "clientY" in point ? { x: point.clientX, y: point.clientY } : undefined;
  };
  const nodeAtPointer = (event: CanvasDragEvent, draggedNode: CanvasFlowNode): CanvasFlowNode | undefined => {
    const instance = flowInstance.current;
    const clientPoint = dragClientPoint(event);
    if (!instance || !clientPoint) return undefined;
    const flowPoint = instance.screenToFlowPosition(clientPoint);
    const excluded = new Set(instance.getNodes().filter((candidate) => candidate.selected).map((candidate) => candidate.id));
    excluded.add(draggedNode.id);
    return instance.getNodes()
      .filter((candidate) => !excluded.has(candidate.id) && ((candidate.data.kind === "folder" && !candidate.data.systemFolder) || candidate.data.kind === "item"))
      .filter((candidate) => {
        const width = candidate.measured?.width ?? candidate.width ?? 0;
        const height = candidate.measured?.height ?? candidate.height ?? 0;
        return flowPoint.x >= candidate.position.x && flowPoint.x <= candidate.position.x + width
          && flowPoint.y >= candidate.position.y && flowPoint.y <= candidate.position.y + height;
      })
      .sort((left, right) => Number(right.data.kind === "folder") - Number(left.data.kind === "folder"))[0];
  };
  const nodeDrag: OnNodeDrag<CanvasFlowNode> = (event, node) => {
    const target = nodeAtPointer(event, node);
    const point = dragClientPoint(event);
    const inside = (element: HTMLElement | null): boolean => {
      if (!element || !point) return false;
      const bounds = element.getBoundingClientRect();
      return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
    };
    const panelTarget = (node.data.item || (node.data.folder && !node.data.systemFolder)) && inside(trashDropRef.current) ? "trash"
      : node.data.item && selectedFolder && inside(baseDropRef.current) ? "base" : undefined;
    setDropTarget(panelTarget ?? target?.id);
    setFlowNodes((current) => current.map((candidate) => candidate.data.kind === "folder"
      ? { ...candidate, data: { ...candidate.data, dropActive: !panelTarget && candidate.id === target?.id } }
      : candidate));
  };
  const nodeDragStart: OnNodeDrag<CanvasFlowNode> = (_event, _node) => {
    setContextMenu(undefined);
  };
  const nodeDragStop: OnNodeDrag<CanvasFlowNode> = (event, node) => {
    const point = dragClientPoint(event);
    const inside = (element: HTMLElement | null): boolean => {
      if (!element || !point) return false;
      const bounds = element.getBoundingClientRect();
      return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
    };
    const sourceItem = node.data.item;
    const selectedNodes = node.selected
      ? flowNodes.filter((candidate) => candidate.selected)
      : [node];
    const selectedItems = selectedNodes.flatMap((candidate) => candidate.data.item ? [candidate.data.item] : []);
    const target = nodeAtPointer(event, node);
    setDropTarget(undefined);
    setFlowNodes((current) => current.map((candidate) => candidate.data.dropActive ? { ...candidate, data: { ...candidate.data, dropActive: false } } : candidate));
    if (inside(trashDropRef.current)) {
      if (selectedItems.length > 0) void trashItems(selectedItems);
      else if (node.data.folder && !node.data.systemFolder) void removeFolderById(node.data.folder);
      return;
    }
    if (sourceItem && selectedFolder && inside(baseDropRef.current)) { void moveItemsToFolder(selectedItems, null); return; }
    if (sourceItem && target?.data.kind === "folder" && target.data.folder) { void moveItemsToFolder(selectedItems, target.data.folder.id); return; }
    if (sourceItem && target?.data.kind === "item" && target.data.item) { void groupItems(selectedItems, target.data.item); return; }
    const positioned = selectedNodes.filter((candidate) => candidate.data.entity);
    if (positioned.length > 0) {
      setBusy("canvas"); setError(undefined);
      void Promise.all(positioned.map((candidate) => setWorkspaceItemLayout({
        itemType: candidate.data.entity!.itemType,
        itemId: candidate.data.entity!.itemId,
        x: Math.round(candidate.position.x),
        y: Math.round(candidate.position.y),
      }))).then(() => {
        setFeedback(`Saved ${positioned.length} canvas position${positioned.length === 1 ? "" : "s"}.`);
        onChange();
      }).catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Could not save the canvas positions");
      }).finally(() => setBusy(undefined));
    }
  };
  const openContextMenu = (event: React.MouseEvent<Element>, node: CanvasFlowNode): void => {
    event.preventDefault();
    event.stopPropagation();
    const liveSelection = new Set([
      ...selectionSnapshot.current,
      ...(flowInstance.current?.getNodes().filter((candidate) => candidate.selected).map((candidate) => candidate.id) ?? []),
    ]);
    const remembered = contextSelectionIds(node.id, liveSelection);
    const branch = graphBranchNodeIds(node.id, provenance.links, new Set(flowNodes.map((candidate) => candidate.id)), provenanceFlowNodeId);
    const nodeIds = remembered.length > 1 ? remembered : branch.length > 1 ? branch : remembered;
    const scope: CanvasContextMenu["scope"] = remembered.length > 1 ? "selection" : branch.length > 1 ? "branch" : "item";
    selectionSnapshot.current = new Set(nodeIds);
    const applySelection = (): void => setFlowNodes((current) => current.map((candidate) => ({ ...candidate, selected: nodeIds.includes(candidate.id) })));
    applySelection();
    window.requestAnimationFrame(applySelection);
    setContextMenu({ nodeId: node.id, nodeIds, scope, x: event.clientX, y: event.clientY });
  };
  const selectCanvasNode = (event: React.MouseEvent<Element>, node: CanvasFlowNode): void => {
    if (!event.shiftKey) return;
    event.stopPropagation();
    const nextSelection = new Set(selectionSnapshot.current);
    if (nextSelection.has(node.id)) nextSelection.delete(node.id);
    else nextSelection.add(node.id);
    selectionSnapshot.current = nextSelection;
    const applySelection = (): void => setFlowNodes((current) => current.map((candidate) => ({ ...candidate, selected: nextSelection.has(candidate.id) })));
    applySelection();
    window.requestAnimationFrame(applySelection);
  };
  const contextNode = contextMenu ? flowNodes.find((candidate) => candidate.id === contextMenu.nodeId) : undefined;
  const contextNodes = contextMenu
    ? contextMenu.nodeIds.flatMap((id) => flowNodes.find((candidate) => candidate.id === id) ?? [])
    : [];
  const contextItems = contextNodes.flatMap((candidate) => candidate.data.item ? [candidate.data.item] : []);
  const selectedCount = flowNodes.filter((candidate) => candidate.selected).length;
  const dispatcherActivities: Array<{ kind: DispatcherActivityKind; label: string; detail: string }> = [];
  if (busy === "dispatcher") dispatcherActivities.push({ kind: "routing", label: "Routing", detail: "Building the controller request" });
  if (busy?.startsWith("session:") || busy?.startsWith("task:") || busy?.startsWith("run:")) dispatcherActivities.push({ kind: "agent", label: "Claude control", detail: "Coordinating a session or managed work item" });
  if (busy?.startsWith("schedule:")) dispatcherActivities.push({ kind: "routing", label: "Updating trigger", detail: "Saving the scheduled automation state" });
  if (busy?.startsWith("ability:")) dispatcherActivities.push({ kind: "command", label: "Invoking ability", detail: "Validating and proposing the ability command" });
  if (busy?.startsWith("browser:")) dispatcherActivities.push({ kind: "browser", label: "Browser worker", detail: "Queueing Calendar or Slack browser work" });
  if (busy?.startsWith("memory:")) dispatcherActivities.push({ kind: "complete", label: "Updating memory", detail: "Saving the durable memory change" });
  if (approvals.length > 0) dispatcherActivities.push({ kind: "approval", label: "Approval", detail: `${approvals.length} protected action${approvals.length === 1 ? "" : "s"} waiting` });
  for (const run of runs.filter((candidate) => ["queued", "running"].includes(candidate.status)).slice(0, 2)) {
    dispatcherActivities.push({ kind: run.kind === "command" ? "command" : run.kind === "browser" ? "browser" : "agent", label: run.title, detail: `${run.kind} · ${run.status}` });
  }
  const liveBrowserJob = browserJobs.find((job) => job.status === "queued" || job.status === "claimed");
  if (liveBrowserJob) dispatcherActivities.push({ kind: "browser", label: liveBrowserJob.adapter === "slack" ? "Slack" : "Calendar", detail: liveBrowserJob.action.replaceAll("_", " ") });
  if (feedback && dispatcherActivities.length === 0) dispatcherActivities.push({ kind: feedback.includes("approval") ? "approval" : "complete", label: feedback.includes("approval") ? "Queued safely" : "Updated", detail: feedback });

  return <div className="simplified-view">
    <section className="dispatcher-panel">
      <div className="dispatcher-heading">
        <div><p className="eyebrow">Main input</p><h2>Dispatcher</h2></div>
        <span className={`controller-indicator status-${mainControllerStatus}`}>
          {mainController ? `${statusPresentation[mainControllerStatus].icon} ${statusPresentation[mainControllerStatus].label.toLowerCase()}` : "! controller unavailable"}
        </span>
      </div>
      <div className="dispatcher-controller-bar">
        <div className="permission-mode-picker" role="group" aria-label="Controller permission mode">
          {([[
            "manual", "Manual", "Ask before protected Claude Code actions",
          ], [
            "auto", "Automatic", "Use Claude Code automatic permission handling",
          ], [
            "bypassPermissions", "Bypass", "Run without Claude Code permission prompts",
          ]] as Array<[ClaudePermissionMode, string, string]>).map(([mode, label, title]) => <button
            key={mode} type="button" aria-pressed={permissionMode === mode} className={permissionMode === mode ? "selected" : ""}
            title={title} onClick={() => void selectPermissionMode(mode)}>{label}</button>)}
        </div>
        <span>{runtimeStatus?.sessionExists ? `tmux: ${runtimeStatus.recipe.tmuxSession}` : "Runtime is not attached to tmux"} · applies after relaunch</span>
        <button type="button" disabled={busy === "controller-launch" || !defaultCwd} onClick={() => void launchController()}>
          {busy === "controller-launch" ? "Proposing…" : mainController ? "Relaunch dispatcher" : "Repair & connect"}
        </button>
        <button type="button" disabled={busy?.startsWith("runtime:")} onClick={() => void proposeRuntimeControl({ action: "open_terminal" }, "Dispatcher terminal launch started.")}>Open terminal</button>
        <button type="button" aria-controls="runtime-settings" onClick={() => {
          if (settingsRef.current) settingsRef.current.open = true;
          settingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}>⚙ Settings</button>
      </div>
      <div className="dispatcher-command-bar">
        <label><span>Dispatcher command</span><input aria-label="Dispatcher slash command" list="dispatcher-slash-commands" value={slashCommand} onChange={(event) => setSlashCommand(event.target.value)} placeholder="/compact" /><datalist id="dispatcher-slash-commands">{runtimeSlashCommands.map((command) => <option key={command} value={`/${command}`} />)}</datalist></label>
        <button type="button" disabled={!mainController || busy?.startsWith("runtime:") || !slashCommand.trim()} onClick={() => void proposeRuntimeControl({ action: "slash_command", command: slashCommand.trim() }, `${slashCommand.trim()} proposed for the dispatcher.`)}>Run command</button>
        <button type="button" disabled={busy?.startsWith("runtime:")} onClick={() => void proposeRuntimeControl({ action: "repair" }, "Runtime repair proposed.")}>Repair</button>
      </div>
      <details id="runtime-settings" ref={settingsRef} className="runtime-config-panel">
        <summary><strong>Settings</strong><span>Runtime recipe, dispatcher, daemon, browser, and permission defaults</span></summary>
        {runtimeRecipe ? <form onSubmit={(event) => void saveRuntimeRecipe(event)}>
          <div className="runtime-config-grid">
            <label><span>Recipe ID</span><input value={runtimeRecipe.id} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, id: event.target.value })} /></label>
            <label><span>Recipe name</span><input value={runtimeRecipe.name} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, name: event.target.value })} /></label>
            <label><span>tmux session</span><input value={runtimeRecipe.tmuxSession} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, tmuxSession: event.target.value })} /></label>
            <label><span>Daemon window</span><input value={runtimeRecipe.daemonWindow} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, daemonWindow: event.target.value })} /></label>
            <label><span>Dispatcher window</span><input value={runtimeRecipe.dispatcherWindow} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, dispatcherWindow: event.target.value })} /></label>
            <label><span>Dispatcher name</span><input value={runtimeRecipe.dispatcherName} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, dispatcherName: event.target.value })} /></label>
            <label><span>Teammate layout</span><select value={runtimeRecipe.dispatcherTeammateMode} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, dispatcherTeammateMode: event.target.value as RuntimeRecipe["dispatcherTeammateMode"] })}><option value="tmux">tmux panes</option><option value="auto">Automatic</option><option value="in-process">In process</option></select></label>
            <label><span>Model</span><input value={runtimeRecipe.dispatcherModel ?? ""} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, dispatcherModel: event.target.value.trim() || null })} placeholder="Default" /></label>
            <label><span>Effort</span><select value={runtimeRecipe.dispatcherEffort} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, dispatcherEffort: event.target.value as RuntimeRecipe["dispatcherEffort"] })}>{["low", "medium", "high", "xhigh", "max"].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label><span>Terminal launcher</span><select value={runtimeRecipe.terminalLauncher} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, terminalLauncher: event.target.value as RuntimeRecipe["terminalLauncher"] })}>{["auto", "xdg-terminal-exec", "gnome-terminal", "konsole", "xterm"].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label><span>Daemon host</span><input value={runtimeRecipe.daemon.host} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, daemon: { ...runtimeRecipe.daemon, host: event.target.value } })} /></label>
            <label><span>Daemon port</span><input type="number" min={1} max={65535} value={runtimeRecipe.daemon.port} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, daemon: { ...runtimeRecipe.daemon, port: Number(event.target.value) } })} /></label>
            <label><span>Browser model</span><input value={runtimeRecipe.daemon.browserModel} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, daemon: { ...runtimeRecipe.daemon, browserModel: event.target.value } })} /></label>
            <label><span>Browser effort</span><select value={runtimeRecipe.daemon.browserEffort} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, daemon: { ...runtimeRecipe.daemon, browserEffort: event.target.value as RuntimeRecipe["daemon"]["browserEffort"] } })}>{["low", "medium", "high"].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label><span>Browser max turns</span><input type="number" min={1} max={50} value={runtimeRecipe.daemon.browserMaxTurns} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, daemon: { ...runtimeRecipe.daemon, browserMaxTurns: Number(event.target.value) } })} /></label>
            <label><span>Browser budget USD</span><input type="number" min={0.01} max={10} step={0.01} value={runtimeRecipe.daemon.browserMaxBudgetUsd} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, daemon: { ...runtimeRecipe.daemon, browserMaxBudgetUsd: Number(event.target.value) } })} /></label>
          </div>
          <label className="runtime-description"><span>Description</span><textarea rows={2} value={runtimeRecipe.description} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, description: event.target.value })} /></label>
          <label className="runtime-description"><span>Allowed roots for next daemon launch (one per line; blank uses this checkout)</span><textarea rows={3} value={runtimeRecipe.daemon.allowedRoots.join("\n")} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, daemon: { ...runtimeRecipe.daemon, allowedRoots: event.target.value.split("\n").map((value) => value.trim()).filter(Boolean) } })} /></label>
          <div className="runtime-flags"><label><input type="checkbox" checked={runtimeRecipe.dispatcherUseClaudeLogin} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, dispatcherUseClaudeLogin: event.target.checked })} /> Dispatcher uses Claude login</label><label><input type="checkbox" checked={runtimeRecipe.dispatcherSandbox} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, dispatcherSandbox: event.target.checked })} /> Strict Claude sandbox</label><label><input type="checkbox" checked={runtimeRecipe.dispatcherRemoteControl} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, dispatcherRemoteControl: event.target.checked })} /> Claude Remote Control</label><label><input type="checkbox" checked={runtimeRecipe.autoRepair} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, autoRepair: event.target.checked })} /> Auto-repair policy</label><label><input type="checkbox" checked={runtimeRecipe.daemon.managedAgentUseClaudeLogin} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, daemon: { ...runtimeRecipe.daemon, managedAgentUseClaudeLogin: event.target.checked } })} /> Managed agents use Claude login</label><label><input type="checkbox" checked={runtimeRecipe.daemon.browserEnabled} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, daemon: { ...runtimeRecipe.daemon, browserEnabled: event.target.checked } })} /> Browser worker enabled</label><label><input type="checkbox" checked={runtimeRecipe.daemon.browserUseClaudeLogin} onChange={(event) => setRuntimeRecipe({ ...runtimeRecipe, daemon: { ...runtimeRecipe.daemon, browserUseClaudeLogin: event.target.checked } })} /> Browser worker uses Claude login</label></div>
          <div className="runtime-readonly"><strong>Current daemon (restart to change environment values)</strong><code>{runtimeDaemon ? `${runtimeDaemon.host}:${runtimeDaemon.port} · ${runtimeDaemon.platform} · ${runtimeDaemon.dataDir}` : "Loading…"}</code><small>Allowed roots: {runtimeDaemon?.allowedRoots.join(", ") ?? "unknown"}</small><details><summary>Browser and managed-agent settings</summary><pre>{JSON.stringify({ browser: runtimeDaemon?.browser, managedAgent: runtimeDaemon?.managedAgent }, null, 2)}</pre></details></div>
          <button className="primary" disabled={busy === "runtime:config"}>Save recipe configuration</button>
        </form> : <p>Loading runtime configuration…</p>}
      </details>
      {permissionMode === "bypassPermissions" ? <p className="permission-warning dispatcher-permission-warning">Bypass removes Claude Code permission prompts. Use it only in an environment you trust and isolate.</p> : null}
      <form onSubmit={(event) => void submit(event)}>
        <textarea aria-label="Dispatcher field" autoFocus value={request}
          onChange={(event) => setRequest(event.target.value)}
          onKeyDown={dispatcherKeyDown}
          placeholder={'Tell the assistant what outcome you want…\nExample: “Remember the Linux version and environment here.”'} />
        <div className="dispatcher-submit-row">
          <p>{selectedFolder ? `New dispatcher work will be placed in “${selectedFolder.name}”.` : "New dispatcher work will be placed in the base workspace."} Automatic delivers dispatcher prompts immediately; risky external writes, protected commands, and destructive controls still require approval. Explicit terminal-open requests run immediately and remain audited. <kbd>Ctrl/⌘ + Enter</kbd> submits.</p>
          <button className="primary" disabled={busy === "dispatcher" || !request.trim() || !mainController}>
            {busy === "dispatcher" ? "Routing…" : "Dispatch"}
          </button>
        </div>
      </form>
      {dispatcherActivities.length > 0 ? <div className="dispatcher-activity-strip" aria-label="Dispatcher activity">
        {dispatcherActivities.slice(0, 5).map((activity, index) => <DispatcherActivity
          key={`${activity.kind}-${activity.label}-${index}`} {...activity} />)}
      </div> : null}
      {feedback ? <p className="dispatcher-feedback">{feedback}</p> : null}
      {error ? <p className="error banner">{error}</p> : null}
    </section>

    <section className="workspace-canvas-shell" aria-label="Spatial item workspace">
      <div className="workspace-canvas">
        <ReactFlow<CanvasFlowNode>
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={canvasNodeTypes}
          onNodesChange={onFlowNodesChange}
          onNodeDragStart={nodeDragStart}
          onNodeDrag={nodeDrag}
          onNodeDragStop={nodeDragStop}
          onNodeContextMenu={openContextMenu}
          onNodeClick={selectCanvasNode}
          onSelectionChange={({ nodes }) => {
            if (!contextMenu) selectionSnapshot.current = new Set(nodes.map((node) => node.id));
          }}
          onPaneClick={() => setContextMenu(undefined)}
          onInit={(instance) => { flowInstance.current = instance; }}
          onMoveEnd={(_event, viewport) => window.localStorage.setItem("cc-assistant-canvas-viewport", JSON.stringify(viewport))}
          defaultViewport={defaultViewport}
          minZoom={0.2}
          maxZoom={2.5}
          nodesConnectable={false}
          deleteKeyCode={null}
          zoomOnDoubleClick={false}
          selectionOnDrag={false}
          selectionMode={SelectionMode.Partial}
          selectNodesOnDrag={false}
          panOnDrag
          selectionKeyCode="Shift"
          multiSelectionKeyCode="Shift"
          fitViewOptions={{ padding: 0.18, minZoom: 0.35, maxZoom: 1.2, duration: 350 }}
        >
          <Background gap={22} size={1} color="var(--line)" />
          <Controls position="bottom-left" showInteractive={false} />
          <MiniMap position="bottom-right" pannable zoomable nodeColor="var(--accent)" maskColor="color-mix(in srgb, var(--page) 72%, transparent)" />
          <Panel position="top-left" className="canvas-context-panel">
            <div className="canvas-location">
              <p className="eyebrow">Spatial workspace</p>
              <div><h2>{trashOpen ? "⌫ Trash" : archiveOpen ? "🗄 Archive" : selectedFolder ? `${folderIconPresentation[selectedFolder.icon]} ${selectedFolder.name}` : "Base workspace"}</h2><span>{canvasItemCount} visible · {selectedCount} selected</span></div>
              <small>{trashOpen ? "Right-click an item to restore it." : archiveOpen ? "Completed items are collected here automatically." : selectedFolder ? "New prompts land in this folder." : "Drag the background to pan. Shift-click icons to build a multi-selection."}</small>
            </div>
            {baseOpen ? <button type="button" className="archive-shortcut" onClick={() => setFolderFilter(ARCHIVE_FOLDER_ID)}>🗄 Open Archive <span>{archiveCount}</span></button> : null}
            {archiveOpen || trashOpen ? <button type="button" className="folder-manage-toggle" onClick={() => setFolderFilter(null)}>← Back to base</button> : null}
            {selectedFolder ? <div ref={baseDropRef} className="canvas-base-drop" data-drop-active={dropTarget === "base"}>
              <button type="button" onClick={() => { setFolderFilter(null); setEditingFolder(false); }}>← Back to base</button><small>Drop here to remove an item from this folder</small>
            </div> : null}
            {selectedFolder ? <button type="button" className="folder-manage-toggle" onClick={() => setEditingFolder((current) => !current)}>{editingFolder ? "Close folder settings" : "Rename or delete folder"}</button> : null}
            {editingFolder && selectedFolder ? <form className="folder-editor canvas-folder-editor nodrag nopan" onSubmit={(event) => void saveFolder(event)}>
              <label><span>Folder name</span><input aria-label="Folder name" value={folderName} onChange={(event) => setFolderName(event.target.value)} /></label>
              <div className="folder-icon-picker" role="group" aria-label="Folder icon">{(Object.entries(folderIconPresentation) as Array<[WorkspaceFolderIcon, string]>).map(([icon, symbol]) => <button type="button" key={icon} className={folderIcon === icon ? "selected" : ""} aria-label={`Use ${icon} icon`} onClick={() => setFolderIcon(icon)}>{symbol}</button>)}</div>
              <div className="folder-editor-actions"><button type="button" className="danger" onClick={() => void removeFolder()}>Delete</button><button className="primary" disabled={!folderName.trim() || busy === "organizer"}>Save</button></div>
            </form> : null}
          </Panel>
          <Panel position="top-right" className="canvas-preferences-panel">
            <label className="hover-toggle"><input type="checkbox" checked={expandOnHover} onChange={(event) => setExpandOnHover(event.target.checked)} /><span>Expand on hover</span></label>
            <div className="theme-picker" role="group" aria-label="Color theme">{themes.map((candidate) => <button key={candidate.id} type="button" className={theme === candidate.id ? "selected" : ""} aria-label={`Use ${candidate.label} theme`} title={candidate.label} onClick={() => setTheme(candidate.id)}><i style={{ background: candidate.swatch }} /></button>)}</div>
            <button type="button" disabled={busy === "canvas"} onClick={() => void resetLayout()}>Reset layout</button>
          </Panel>
          <Panel position="top-center" className="canvas-arrange-panel" aria-label="Auto arrange canvas">
            <span>Auto arrange</span>
            <div>
              <button type="button" disabled={busy === "canvas"} onClick={() => void autoArrange("grid")}>Grid</button>
              <button type="button" disabled={busy === "canvas"} onClick={() => void autoArrange("status")}>Status</button>
              <button type="button" disabled={busy === "canvas"} onClick={() => void autoArrange("category")}>Category</button>
              <button type="button" disabled={busy === "canvas"} onClick={() => void autoArrange("time")}>Newest</button>
            </div>
          </Panel>
          <Panel position="bottom-center" className="canvas-bottom-panel">
            <div className="status-legend" aria-label="Status legend">{(Object.entries(statusPresentation) as Array<[CompactStatus, { icon: string; label: string }]>).map(([status, value]) => <span className={`status-${status}`} key={status}><i>{value.icon}</i>{value.label}</span>)}</div>
            <button type="button" ref={trashDropRef} className="canvas-trash" data-drop-active={dropTarget === "trash"} onClick={() => setFolderFilter(TRASH_FOLDER_ID)}><span>⌫</span><strong>Trash</strong><small>Drop selected items · {trashedItems.length}</small></button>
          </Panel>
          <Panel position="bottom-right" className="canvas-diagnostics-panel">
            <details>
              <summary><span className={error ? "diagnostic-dot error" : busy ? "diagnostic-dot busy" : "diagnostic-dot"} />Status & diagnostics</summary>
              <div className="diagnostic-summary">
                <span>Daemon <strong>live</strong></span>
                <span>Controller <strong>{mainController ? statusPresentation[mainControllerStatus].label : "unavailable"}</strong></span>
                <span>Browser <strong>{browserStatus.state}</strong></span>
                <span>Approvals <strong>{approvals.length}</strong></span>
                <span>Selection <strong>{selectedCount}</strong></span>
                <span>Operation <strong>{busy ?? "idle"}</strong></span>
              </div>
              <div className="diagnostic-log" aria-live="polite">
                {diagnosticMessages.length === 0 ? <small>No diagnostic messages yet.</small> : diagnosticMessages.map((message) => <p key={message.id} className={message.level}><time>{message.at}</time><span>{message.text}</span></p>)}
              </div>
            </details>
          </Panel>
          {canvasItemCount === 0 ? <Panel position="top-left" className="canvas-empty-panel"><EmptyPane label="No items in this view" /></Panel> : null}
        </ReactFlow>
        {contextMenu && contextNode ? <div className="canvas-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" onClick={(event) => event.stopPropagation()}>
          <div><strong>{contextNodes.length > 1 ? `${contextNodes.length} ${contextMenu.scope === "branch" ? "branch" : "selected"} items` : contextNode.data.arrange.title}</strong><small>{contextNode.data.kind === "folder" ? "Folder" : contextNode.data.arrange.category}</small></div>
          {contextNode.data.kind === "folder" && contextNode.data.folder ? <>
            <button type="button" role="menuitem" onClick={() => { contextNode.data.onOpen?.(); setContextMenu(undefined); }}>Open folder</button>
            {!contextNode.data.systemFolder ? <button type="button" role="menuitem" className="danger" onClick={() => { void removeFolderById(contextNode.data.folder!); setContextMenu(undefined); }}>Delete folder</button> : null}
          </> : null}
          {contextItems.length > 0 && trashOpen ? <button type="button" role="menuitem" onClick={() => { void restoreItems(contextItems); setContextMenu(undefined); }}>Restore to base workspace</button> : null}
          {contextItems.length > 1 && !trashOpen ? <button type="button" role="menuitem" onClick={() => { void groupItems(contextItems.slice(1), contextItems[0]!); setContextMenu(undefined); }}>Create folder from {contextMenu.scope === "branch" ? "branch" : "selected items"}</button> : null}
          {contextItems.length > 0 && !trashOpen && (selectedFolder || contextItems.some((candidate) => placementByItem.has(placementKey(candidate.itemType, candidate.itemId)))) ? <button type="button" role="menuitem" onClick={() => { void moveItemsToFolder(contextItems, null); setContextMenu(undefined); }}>Remove from folder</button> : null}
          {contextItems.length > 0 && !trashOpen ? <button type="button" role="menuitem" className="danger" onClick={() => { void trashItems(contextItems); setContextMenu(undefined); }}>Move {contextItems.length > 1 ? (contextMenu.scope === "branch" ? "branch" : "selected items") : "item"} to Trash</button> : null}
        </div> : null}
      </div>
    </section>
    <div className="transcript-window-layer" aria-label="Claude transcript windows">
      {transcriptWindows.filter((candidate) => !candidate.minimized).map((windowState) => <section
        key={windowState.id}
        className={`transcript-window${windowState.collapsed ? " collapsed" : ""}`}
        style={{ left: windowState.x, top: windowState.y }}
      >
        <div className="transcript-window-titlebar" onPointerDown={(event) => beginTranscriptDrag(event, windowState.id)}>
          <div><strong>{windowState.session.name ?? windowState.session.id ?? "Claude session"}</strong><small>{windowState.transcript.source} · {new Date(windowState.transcript.capturedAt).toLocaleTimeString()}</small></div>
          <div><button title="Refresh transcript" onClick={() => void refreshTranscript(windowState.id)}>↻</button><button title={windowState.collapsed ? "Expand" : "Collapse"} onClick={() => setTranscriptWindows((current) => current.map((candidate) => candidate.id === windowState.id ? { ...candidate, collapsed: !candidate.collapsed } : candidate))}>{windowState.collapsed ? "▢" : "—"}</button><button title="Minimize" onClick={() => setTranscriptWindows((current) => current.map((candidate) => candidate.id === windowState.id ? { ...candidate, minimized: true } : candidate))}>▾</button><button title="Close" onClick={() => setTranscriptWindows((current) => current.filter((candidate) => candidate.id !== windowState.id))}>×</button></div>
        </div>
        {!windowState.collapsed ? <pre>{windowState.transcript.available
          ? (windowState.transcript.content || "No transcript output yet.")
          : `Transcript unavailable\n${windowState.transcript.error ?? "The session has no readable transcript source."}`}</pre> : null}
      </section>)}
    </div>
    {transcriptWindows.some((candidate) => candidate.minimized) ? <div className="transcript-taskbar" aria-label="Minimized transcript windows">
      <span>Sessions</span>{transcriptWindows.filter((candidate) => candidate.minimized).map((windowState) => <button key={windowState.id} onClick={() => setTranscriptWindows((current) => current.map((candidate) => candidate.id === windowState.id ? { ...candidate, minimized: false } : candidate))}>{windowState.session.name ?? windowState.session.id ?? "Claude"}</button>)}
    </div> : null}
  </div>;
}
