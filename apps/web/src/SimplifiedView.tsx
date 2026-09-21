import { useEffect, useMemo, useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import type {
  AbilityManifest,
  Approval,
  AssistantNotification,
  BrowserAutomationStatus,
  BrowserJob,
  ClaudeAgentSession,
  Memory,
  Run,
  Schedule,
  Task,
  WorkspaceFolder,
  WorkspaceFolderIcon,
  WorkspaceItemPlacement,
  WorkspaceItemType,
} from "@cc-assistant/shared";
import { isMainControllerName } from "@cc-assistant/shared";
import {
  cancelRun,
  createWorkspaceFolder,
  deleteWorkspaceFolder,
  dispatchInput,
  markNotificationRead,
  moveWorkspaceItem,
  resolveApproval,
  updateTask,
  updateWorkspaceFolder,
} from "./api.js";

type CompactStatus = "idle" | "paused" | "stopped" | "running" | "waiting" | "attention" | "complete" | "neutral";
type FolderFilter = "all" | "unfiled" | string;
type ThemeId = "forest" | "midnight" | "ocean" | "ember" | "plum" | "graphite";
type DraggableItem = { itemType: WorkspaceItemType; itemId: string; title: string };

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

export function placementKey(itemType: WorkspaceItemType, itemId: string): string {
  return `${itemType}:${itemId}`;
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

function CompactPane({ type, title, description, status, item, onDragStart, onDragEnd, children }: {
  type: string;
  title: string;
  description: string;
  status: CompactStatus;
  item?: DraggableItem;
  onDragStart?: (item: DraggableItem) => void;
  onDragEnd?: () => void;
  children?: ReactNode;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const presentation = statusPresentation[status];
  return (
    <article
      className={`compact-pane status-${status}${expanded ? " expanded" : ""}${item ? " draggable" : ""}`}
      draggable={Boolean(item)}
      data-item-type={item?.itemType}
      data-item-id={item?.itemId}
      onDragStart={(event) => {
        if (!item) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-cc-assistant-item", JSON.stringify(item));
        event.dataTransfer.setData("text/plain", item.title);
        onDragStart?.(item);
      }}
      onDragEnd={onDragEnd}
    >
      <button
        className="compact-pane-toggle"
        type="button"
        aria-expanded={expanded}
        title={expanded ? `Collapse ${title}` : `Expand ${title}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="compact-status" aria-label={presentation.label}>{presentation.icon}</span>
        <span className="compact-type">{type}</span>
        <span className="compact-copy"><strong>{title}</strong><small>{description}</small></span>
        <span className="compact-chevron" aria-hidden="true">{expanded ? "←" : "→"}</span>
      </button>
      {expanded && children ? <div className="compact-detail">{children}</div> : null}
    </article>
  );
}

function CompactGroup({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }): React.JSX.Element {
  return <section className="compact-group">
    <div className="compact-group-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div>
    <div className="compact-track">{children}</div>
  </section>;
}

function EmptyPane({ label }: { label: string }): React.JSX.Element {
  return <div className="compact-empty">{label}</div>;
}

function sessionItemId(session: ClaudeAgentSession): string {
  return session.sessionId ?? session.id ?? `${session.cwd}:${session.startedAt}`;
}

function parseDraggedItem(event: DragEvent<HTMLElement>, current: DraggableItem | undefined): DraggableItem | undefined {
  if (current) return current;
  try {
    const parsed = JSON.parse(event.dataTransfer.getData("application/x-cc-assistant-item")) as Partial<DraggableItem>;
    if (typeof parsed.itemType === "string" && typeof parsed.itemId === "string" && typeof parsed.title === "string") {
      return parsed as DraggableItem;
    }
  } catch { /* Ignore drags originating outside the dashboard. */ }
  return undefined;
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
  onChange: () => void;
}): React.JSX.Element {
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [error, setError] = useState<string>();
  const [draggedItem, setDraggedItem] = useState<DraggableItem>();
  const [dropTarget, setDropTarget] = useState<string>();
  const [folderFilter, setFolderFilter] = useState<FolderFilter>("all");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderIcon, setFolderIcon] = useState<WorkspaceFolderIcon>("folder");
  const [editingFolder, setEditingFolder] = useState(false);
  const [theme, setTheme] = useState<ThemeId>(() => {
    if (typeof window === "undefined") return "forest";
    const saved = window.localStorage.getItem("cc-assistant-theme");
    return themes.some((candidate) => candidate.id === saved) ? saved as ThemeId : "forest";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("cc-assistant-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (folderFilter !== "all" && folderFilter !== "unfiled" && !folders.some((folder) => folder.id === folderFilter)) {
      setFolderFilter("all");
    }
  }, [folderFilter, folders]);

  const placementByItem = useMemo(() => new Map(
    placements.map((placement) => [placementKey(placement.itemType, placement.itemId), placement.folderId]),
  ), [placements]);
  const selectedFolder = folders.find((folder) => folder.id === folderFilter);
  const mainController = useMemo(() => sessions
    .filter((session) => session.pid && isMainControllerName(session.name))
    .sort((left, right) => right.startedAt - left.startedAt)[0], [sessions]);
  const mainControllerStatus = mainController ? sessionStatus(mainController) : "attention";

  const visible = (itemType: WorkspaceItemType, itemId: string): boolean => {
    if (folderFilter === "all") return true;
    const folderId = placementByItem.get(placementKey(itemType, itemId));
    return folderFilter === "unfiled" ? folderId === undefined : folderId === folderFilter;
  };
  const item = (itemType: WorkspaceItemType, itemId: string, title: string): DraggableItem => ({ itemType, itemId, title });
  const dragProps = (draggableItem: DraggableItem) => ({
    item: draggableItem,
    onDragStart: setDraggedItem,
    onDragEnd: () => { setDraggedItem(undefined); setDropTarget(undefined); },
  });

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const input = request.trim();
    if (!input) return;
    setBusy("dispatcher"); setError(undefined); setFeedback(undefined);
    try {
      await dispatchInput(input);
      setRequest("");
      setFeedback("Dispatcher request queued for one-time approval.");
      onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reach the dispatcher");
    } finally { setBusy(undefined); }
  };

  const decide = async (approval: Approval, decision: "approved" | "denied"): Promise<void> => {
    setBusy(approval.id); setError(undefined);
    try { await resolveApproval(approval.id, decision); onChange(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not resolve approval"); }
    finally { setBusy(undefined); }
  };

  const fileItem = async (event: DragEvent<HTMLElement>, folderId: string | null): Promise<void> => {
    event.preventDefault();
    const dragged = parseDraggedItem(event, draggedItem);
    setDropTarget(undefined);
    if (!dragged) return;
    setBusy("organizer"); setError(undefined);
    try {
      await moveWorkspaceItem({ itemType: dragged.itemType, itemId: dragged.itemId, folderId });
      setFeedback(folderId ? `Moved “${dragged.title}” into a folder.` : `Moved “${dragged.title}” out of its folder.`);
      onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not move the item");
    } finally { setBusy(undefined); setDraggedItem(undefined); }
  };

  const trashTask = async (event: DragEvent<HTMLElement>): Promise<void> => {
    event.preventDefault();
    const dragged = parseDraggedItem(event, draggedItem);
    setDropTarget(undefined);
    if (!dragged) return;
    if (dragged.itemType !== "task") {
      setError("Trash accepts tasks only. Other assistant records stay available for audit and history.");
      setDraggedItem(undefined);
      return;
    }
    const task = tasks.find((candidate) => candidate.id === dragged.itemId);
    if (!task) return;
    setBusy("organizer"); setError(undefined);
    try {
      await updateTask(task.id, { status: "cancelled", expectedRevision: task.revision });
      await moveWorkspaceItem({ itemType: "task", itemId: task.id, folderId: null });
      setFeedback(`Moved “${task.title}” to Trash. It remains recoverable as a cancelled task.`);
      onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not move the task to Trash");
    } finally { setBusy(undefined); setDraggedItem(undefined); }
  };

  const createFolder = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!folderName.trim()) return;
    setBusy("organizer"); setError(undefined);
    try {
      const folder = await createWorkspaceFolder({ name: folderName, icon: folderIcon });
      setFolderName(""); setFolderIcon("folder"); setCreatingFolder(false); setFolderFilter(folder.id);
      setFeedback(`Created folder “${folder.name}”.`);
      onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the folder");
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
      setFolderFilter("unfiled"); setEditingFolder(false);
      setFeedback(`Deleted folder “${selectedFolder.name}”; its items are now unfiled.`); onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the folder");
    } finally { setBusy(undefined); }
  };

  const activeTasks = tasks.filter((task) => !["done", "cancelled", "blocked"].includes(task.status) && visible("task", task.id));
  const blockedTasks = tasks.filter((task) => task.status === "blocked" && visible("task", task.id));
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

  return <div className="simplified-view">
    <section className="dispatcher-panel">
      <div className="dispatcher-heading">
        <div><p className="eyebrow">Main input</p><h2>Dispatcher</h2></div>
        <span className={`controller-indicator status-${mainControllerStatus}`}>
          {mainController ? `${statusPresentation[mainControllerStatus].icon} ${statusPresentation[mainControllerStatus].label.toLowerCase()}` : "! controller unavailable"}
        </span>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <textarea aria-label="Dispatcher field" autoFocus value={request}
          onChange={(event) => setRequest(event.target.value)}
          placeholder={'Tell the assistant what outcome you want…\nExample: “Remember the Linux version and environment here.”'} />
        <div className="dispatcher-submit-row">
          <p>The controller gathers context, calls the right tools, or delegates multi-step work. External writes and session messages still require approval.</p>
          <button className="primary" disabled={busy === "dispatcher" || !request.trim() || !mainController}>
            {busy === "dispatcher" ? "Routing…" : "Dispatch"}
          </button>
        </div>
      </form>
      {feedback ? <p className="dispatcher-feedback">{feedback}</p> : null}
      {error ? <p className="error banner">{error}</p> : null}
    </section>

    <section className="workspace-organizer" aria-label="Item organizer">
      <div className="organizer-heading">
        <div><p className="eyebrow">Arrange</p><h2>Folders & appearance</h2><small>Drag any pane into a folder. Drag a task to Trash to cancel it.</small></div>
        <div className="theme-picker" role="group" aria-label="Color theme">
          {themes.map((candidate) => <button key={candidate.id} type="button"
            className={theme === candidate.id ? "selected" : ""} aria-label={`Use ${candidate.label} theme`}
            title={candidate.label} onClick={() => setTheme(candidate.id)}>
            <i style={{ background: candidate.swatch }} />
          </button>)}
        </div>
      </div>
      <div className="folder-shelf">
        <button type="button" className={`folder-tile all-items${folderFilter === "all" ? " selected" : ""}`}
          onClick={() => setFolderFilter("all")}><span>▦</span><strong>All items</strong><small>Show everything</small></button>
        <button type="button" className={`folder-tile drop-zone${folderFilter === "unfiled" ? " selected" : ""}${dropTarget === "unfiled" ? " drag-over" : ""}`}
          onClick={() => setFolderFilter("unfiled")} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget("unfiled"); }}
          onDragLeave={() => setDropTarget(undefined)} onDrop={(event) => void fileItem(event, null)}>
          <span>◫</span><strong>Unfiled</strong><small>Drop here to remove folder</small></button>
        {folders.map((folder) => <button key={folder.id} type="button"
          className={`folder-tile drop-zone${folderFilter === folder.id ? " selected" : ""}${dropTarget === folder.id ? " drag-over" : ""}`}
          onClick={() => { setFolderFilter(folder.id); setEditingFolder(false); }}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(folder.id); }}
          onDragLeave={() => setDropTarget(undefined)} onDrop={(event) => void fileItem(event, folder.id)}>
          <span>{folderIconPresentation[folder.icon]}</span><strong>{folder.name}</strong>
          <small>{placements.filter((placement) => placement.folderId === folder.id).length} items</small>
        </button>)}
        <button type="button" className="folder-tile create-folder" onClick={() => {
          setCreatingFolder(!creatingFolder); setEditingFolder(false); setFolderName(""); setFolderIcon("folder");
        }}><span>＋</span><strong>New folder</strong><small>Choose a name and icon</small></button>
        <button type="button" className={`folder-tile trash drop-zone${dropTarget === "trash" ? " drag-over" : ""}`}
          aria-label="Trash tasks" title="Drop a task here to mark it cancelled"
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = draggedItem?.itemType === "task" ? "move" : "none"; setDropTarget("trash"); }}
          onDragLeave={() => setDropTarget(undefined)} onDrop={(event) => void trashTask(event)}>
          <span>⌫</span><strong>Trash</strong><small>Tasks only</small></button>
      </div>

      {creatingFolder ? <form className="folder-editor" onSubmit={(event) => void createFolder(event)}>
        <label><span>Folder name</span><input aria-label="New folder name" value={folderName} autoFocus onChange={(event) => setFolderName(event.target.value)} placeholder="Research" /></label>
        <div className="folder-icon-picker" role="group" aria-label="Folder icon">
          {(Object.entries(folderIconPresentation) as Array<[WorkspaceFolderIcon, string]>).map(([icon, symbol]) =>
            <button type="button" key={icon} className={folderIcon === icon ? "selected" : ""} aria-label={`Use ${icon} icon`} onClick={() => setFolderIcon(icon)}>{symbol}</button>)}
        </div>
        <div className="folder-editor-actions"><button type="button" onClick={() => setCreatingFolder(false)}>Cancel</button><button className="primary" disabled={!folderName.trim() || busy === "organizer"}>Create folder</button></div>
      </form> : null}

      {selectedFolder ? <div className="selected-folder-tools">
        <span>{folderIconPresentation[selectedFolder.icon]} Viewing <strong>{selectedFolder.name}</strong></span>
        <button type="button" onClick={() => {
          setEditingFolder(!editingFolder); setCreatingFolder(false); setFolderName(selectedFolder.name); setFolderIcon(selectedFolder.icon);
        }}>{editingFolder ? "Close manager" : "Manage folder"}</button>
      </div> : null}
      {editingFolder && selectedFolder ? <form className="folder-editor" onSubmit={(event) => void saveFolder(event)}>
        <label><span>Folder name</span><input aria-label="Folder name" value={folderName} onChange={(event) => setFolderName(event.target.value)} /></label>
        <div className="folder-icon-picker" role="group" aria-label="Folder icon">
          {(Object.entries(folderIconPresentation) as Array<[WorkspaceFolderIcon, string]>).map(([icon, symbol]) =>
            <button type="button" key={icon} className={folderIcon === icon ? "selected" : ""} aria-label={`Use ${icon} icon`} onClick={() => setFolderIcon(icon)}>{symbol}</button>)}
        </div>
        <div className="folder-editor-actions"><button type="button" className="danger" onClick={() => void removeFolder()}>Delete folder</button><button className="primary" disabled={!folderName.trim() || busy === "organizer"}>Save changes</button></div>
      </form> : null}
    </section>

    <div className="status-legend" aria-label="Status legend">
      {(Object.entries(statusPresentation) as Array<[CompactStatus, { icon: string; label: string }]>).map(([status, value]) =>
        <span className={`status-${status}`} key={status}><i>{value.icon}</i>{value.label}</span>)}
    </div>

    <CompactGroup title="Needs attention" subtitle="Approvals, unread alerts, and blocked or failed work.">
      {visibleApprovals.map((approval) => <CompactPane key={approval.id} type="Approval" title={approval.summary}
        description={sentence(`A one-time ${approval.actionType.replaceAll("_", " ")} decision is waiting`, "Approval required")}
        status="attention" {...dragProps(item("approval", approval.id, approval.summary))}>
        <pre>{JSON.stringify(approval.payload, null, 2)}</pre>
        <div className="compact-actions"><button disabled={busy === approval.id} onClick={() => void decide(approval, "denied")}>Deny</button><button className="primary" disabled={busy === approval.id} onClick={() => void decide(approval, "approved")}>Approve once</button></div>
      </CompactPane>)}
      {visibleNotifications.map((notification) => <CompactPane key={notification.id} type="Alert" title={notification.title}
        description={sentence(notification.body, "An unread assistant notification needs review")} status="attention" {...dragProps(item("notification", notification.id, notification.title))}>
        <p>{notification.body || "No additional details."}</p>
        <button disabled={busy === notification.id} onClick={() => { setBusy(notification.id); void markNotificationRead(notification.id).then(onChange).finally(() => setBusy(undefined)); }}>Dismiss</button>
      </CompactPane>)}
      {blockedTasks.map((task) => <CompactPane key={`blocked-${task.id}`} type="Task" title={task.title}
        description={sentence(task.description, "A task is blocked and needs a decision or external change")} status="attention" {...dragProps(item("task", task.id, task.title))}><p>{task.description || "No blocker was recorded."}</p></CompactPane>)}
      {failedRuns.map((run) => <CompactPane key={`failed-${run.id}`} type="Run" title={run.title}
        description={sentence(run.error ?? "A managed run failed", "A managed run failed")} status="attention" {...dragProps(item("run", run.id, run.title))}><pre>{run.error ?? run.result ?? "No failure detail."}</pre></CompactPane>)}
      {visibleApprovals.length + visibleNotifications.length + blockedTasks.length + failedRuns.length === 0 ? <EmptyPane label="Nothing needs attention" /> : null}
    </CompactGroup>

    <CompactGroup title="In motion" subtitle="Current tasks, Claude sessions, and managed work.">
      {activeTasks.map((task) => <CompactPane key={task.id} type="Task" title={task.title}
        description={sentence(task.description, `A ${task.status} task${task.project ? ` in ${task.project}` : ""}`)} status={taskStatus(task)} {...dragProps(item("task", task.id, task.title))}>
        <p>{task.description || "No description."}</p><small>Priority P{task.priority} · {task.project ?? "No project"}</small>
      </CompactPane>)}
      {visibleSessions.map((session) => <CompactPane key={sessionItemId(session)} type="Claude" title={session.name ?? session.id ?? "Interactive session"}
        description={sentence(`A ${session.kind} Claude session is ${session.waitingFor ?? session.status ?? session.state ?? "saved"}`, "A Claude session")}
        status={sessionStatus(session)} {...dragProps(item("claude_session", sessionItemId(session), session.name ?? session.id ?? "Interactive session"))}>
        <p>{session.cwd}</p>{session.id ? <code>claude attach {session.id}</code> : null}
      </CompactPane>)}
      {activeRuns.map((run) => <CompactPane key={run.id} type="Run" title={run.title}
        description={sentence(run.prompt ?? `${run.kind} work is ${run.status.replaceAll("_", " ")}`, "Managed work")}
        status={runStatus(run)} {...dragProps(item("run", run.id, run.title))}>
        <p>{run.prompt ?? run.result ?? run.cwd}</p><button onClick={() => void cancelRun(run.id).then(onChange)}>Cancel</button>
      </CompactPane>)}
      {activeTasks.length + visibleSessions.length + activeRuns.length === 0 ? <EmptyPane label="No active work in this view" /> : null}
    </CompactGroup>

    <CompactGroup title="Scheduled & connected" subtitle="Automations, browser activity, and callable abilities.">
      {visibleSchedules.map((schedule) => <CompactPane key={schedule.id} type="Trigger" title={schedule.name}
        description={sentence(`${schedule.triggerKind.replaceAll("_", " ")} triggers ${schedule.actionKind}; next run ${formatTime(schedule.nextRunAt)}`, "Configured automation")}
        status={scheduleStatus(schedule)} {...dragProps(item("schedule", schedule.id, schedule.name))}><pre>{JSON.stringify({ trigger: schedule.trigger, action: schedule.action }, null, 2)}</pre></CompactPane>)}
      {folderFilter === "all" || folderFilter === "unfiled" ? <CompactPane type="Browser" title="Calendar & Slack worker"
        description={sentence(`The signed-in browser worker is ${browserStatus.state}`, "Browser integration status")}
        status={browserStatus.state === "running" ? "running" : browserStatus.state === "ready" ? "idle" : browserStatus.state === "error" ? "attention" : "stopped"}>
        <p>{browserStatus.lastError ?? (browserStatus.lastCompletedAt ? `Last completed ${formatTime(browserStatus.lastCompletedAt)}` : "No recent browser activity.")}</p>
      </CompactPane> : null}
      {visibleAbilities.map((ability) => <CompactPane key={ability.id} type="Ability" title={ability.name}
        description={sentence(ability.description, "An installed command ability is available")} status="neutral" {...dragProps(item("ability", ability.id, ability.name))}><code>{ability.id}</code></CompactPane>)}
      {visibleSchedules.length + visibleAbilities.length === 0 && folderFilter !== "all" && folderFilter !== "unfiled" ? <EmptyPane label="No scheduled or connected items in this folder" /> : null}
    </CompactGroup>

    <CompactGroup title="Recent & remembered" subtitle="Browser results, completed work, and durable memory.">
      {visibleBrowserJobs.map((job) => <CompactPane key={job.id}
        type={job.adapter === "google_calendar" ? (job.action === "create_event" ? "Calendar" : "Calendar check") : "Slack"}
        title={String(job.input.title ?? job.input.channelName ?? job.action.replaceAll("_", " "))}
        description={sentence(`${job.adapter.replaceAll("_", " ")} ${job.action.replaceAll("_", " ")} ${job.status}`, "Browser job")}
        status={browserJobStatus(job)} {...dragProps(item("browser_job", job.id, String(job.input.title ?? job.input.channelName ?? job.action)))}><pre>{JSON.stringify(job.error ?? job.result ?? job.input, null, 2)}</pre></CompactPane>)}
      {recentRuns.map((run) => <CompactPane key={`recent-${run.id}`} type="Run" title={run.title}
        description={sentence(run.result ?? `${run.kind} work ${run.status}`, "Completed managed work")} status={runStatus(run)} {...dragProps(item("run", run.id, run.title))}><pre>{run.result ?? run.error ?? "No result detail."}</pre></CompactPane>)}
      {visibleMemories.map((memory) => <CompactPane key={memory.id} type="Memory" title={memory.title}
        description={sentence(memory.summary ?? memory.body, "A durable memory page")}
        status="complete" {...dragProps(item("memory", memory.id, memory.title))}><p>{clip(memory.body, 600)}</p><small>{memory.kind} · revision {memory.revision}</small></CompactPane>)}
      {visibleBrowserJobs.length + recentRuns.length + visibleMemories.length === 0 ? <EmptyPane label="No recent or remembered items in this view" /> : null}
    </CompactGroup>
  </div>;
}
