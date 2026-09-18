import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { type Approval, type AssistantNotification, type BrowserAutomationStatus, type ClaudeSession, type Memory, type MemoryLink, type Run, type Schedule, type Task, type TaskStatus } from "@cc-assistant/shared";
import {
  AuthenticationError,
  archiveMemory,
  cancelRun,
  createMemory,
  createReminder,
  createTask,
  getConfig,
  getBrowserStatus,
  getMemoryBundle,
  listMemories,
  listNotifications,
  listPendingApprovals,
  listRuns,
  listSchedules,
  listSessions,
  listTasks,
  login,
  logout,
  markNotificationRead,
  resolveApproval,
  searchMemories,
  startAgent,
  updateMemory,
  updateTask,
} from "./api.js";

const statusLabels: Record<TaskStatus, string> = {
  inbox: "Inbox",
  planned: "Planned",
  active: "Active",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

const visibleStatuses: TaskStatus[] = ["active", "inbox", "planned", "blocked", "done"];

function formatRelative(value: string): string {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

function Login({ onAuthenticated }: { onAuthenticated: () => void }): React.JSX.Element {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await login(token);
      onAuthenticated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="mark">CC</div>
        <p className="eyebrow">Local workspace</p>
        <h1>Open your assistant</h1>
        <p className="muted">Paste the token stored in <code>.data/access-token</code>.</p>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="token">Access token</label>
          <input
            id="token"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="current-password"
            autoFocus
          />
          {error ? <p className="error">{error}</p> : null}
          <button className="primary" disabled={busy || token.length === 0}>
            {busy ? "Opening…" : "Open assistant"}
          </button>
        </form>
      </section>
    </main>
  );
}

function TaskCard({ task, onChange }: { task: Task; onChange: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false);

  const setStatus = async (status: TaskStatus): Promise<void> => {
    setBusy(true);
    try {
      await updateTask(task.id, { status, expectedRevision: task.revision });
      onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`task-card status-${task.status}`}>
      <div className="task-topline">
        <span className={`priority priority-${task.priority}`}>P{task.priority}</span>
        {task.project ? <span className="project">{task.project}</span> : null}
        <span className="updated">{formatRelative(task.updatedAt)}</span>
      </div>
      <h3>{task.title}</h3>
      {task.description ? <p>{task.description}</p> : null}
      <div className="task-actions">
        {task.status !== "active" && task.status !== "done" ? (
          <button disabled={busy} onClick={() => void setStatus("active")}>Focus</button>
        ) : null}
        {task.status !== "done" ? (
          <button disabled={busy} onClick={() => void setStatus("done")}>Complete</button>
        ) : (
          <button disabled={busy} onClick={() => void setStatus("inbox")}>Reopen</button>
        )}
      </div>
    </article>
  );
}

function NewTask({ onCreated }: { onCreated: () => void }): React.JSX.Element {
  const [title, setTitle] = useState("");
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      await createTask({ title, project: project || null });
      setTitle("");
      setProject("");
      onCreated();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="capture" onSubmit={(event) => void submit(event)}>
      <div>
        <label htmlFor="new-task">Capture a task</label>
        <input
          id="new-task"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="What needs your attention?"
        />
      </div>
      <div className="project-field">
        <label htmlFor="new-project">Project</label>
        <input
          id="new-project"
          value={project}
          onChange={(event) => setProject(event.target.value)}
          placeholder="Optional"
        />
      </div>
      <button className="primary" disabled={busy || title.trim().length === 0}>
        {busy ? "Adding…" : "Add task"}
      </button>
    </form>
  );
}

function SessionStrip({ sessions }: { sessions: ClaudeSession[] }): React.JSX.Element {
  return (
    <section className="sessions">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Claude Code</p>
          <h2>Observed sessions</h2>
        </div>
        <span>{sessions.length} live</span>
      </div>
      <div className="session-list">
        {sessions.map((session) => (
          <article className="session-card" key={session.id}>
            <div className="session-title">
              <i className={`session-dot ${session.status}`} />
              <strong>{session.cwd.split("/").filter(Boolean).at(-1) ?? session.cwd}</strong>
              <span className={`session-status ${session.status}`}>{session.status}</span>
            </div>
            <p>{session.lastEvent.replaceAll(/([a-z])([A-Z])/g, "$1 $2")}</p>
            <div className="session-meta">
              <span>{session.model ?? "Model unknown"}</span>
              <span>{formatRelative(session.lastEventAt)}</span>
            </div>
          </article>
        ))}
        {sessions.length === 0 ? (
          <div className="session-empty">
            Restart Claude Code once to activate the project lifecycle hooks.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ExecutionPanel({
  runs,
  approvals,
  onChange,
}: {
  runs: Run[];
  approvals: Approval[];
  onChange: () => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState<string>();
  const decide = async (id: string, decision: "approved" | "denied"): Promise<void> => {
    setBusy(id);
    try {
      await resolveApproval(id, decision);
      onChange();
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <section className="execution">
      <div className="section-heading">
        <div><p className="eyebrow">Execution</p><h2>Managed work</h2></div>
        <span>{approvals.length} awaiting approval</span>
      </div>
      {approvals.length > 0 ? (
        <div className="approval-list">
          {approvals.map((approval) => (
            <article className="approval-card" key={approval.id}>
              <div><span>{approval.actionType.replaceAll("_", " ")}</span><strong>{approval.summary}</strong></div>
              <details className="approval-details">
                <summary>Inspect exact request</summary>
                <pre>{JSON.stringify(approval.payload, null, 2)}</pre>
              </details>
              <div className="approval-actions">
                <button disabled={busy === approval.id} onClick={() => void decide(approval.id, "denied")}>Deny</button>
                <button className="primary" disabled={busy === approval.id} onClick={() => void decide(approval.id, "approved")}>Approve once</button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
      <div className="run-list">
        {runs.slice(0, 8).map((run) => (
          <article className="run-card" key={run.id}>
            <div className="run-title"><i className={`run-dot ${run.status}`} /><strong>{run.title}</strong><span>{run.kind}</span></div>
            <p>{run.error ?? run.result ?? run.prompt ?? run.cwd}</p>
            <div className="run-meta"><span>{run.status.replaceAll("_", " ")}</span><span>{formatRelative(run.createdAt)}</span></div>
            {!["succeeded", "failed", "cancelled"].includes(run.status) ? (
              <button className="run-cancel" onClick={() => void cancelRun(run.id).then(onChange)}>Cancel</button>
            ) : null}
          </article>
        ))}
        {runs.length === 0 ? <div className="session-empty">No managed runs yet. Start one from Claude through MCP or with <code>pnpm cca run</code>.</div> : null}
      </div>
    </section>
  );
}

function NotificationInbox({ notifications, onChange }: { notifications: AssistantNotification[]; onChange: () => void }): React.JSX.Element | null {
  if (notifications.length === 0) return null;
  return <section className="notification-inbox">{notifications.map((notification) => (
    <article key={notification.id}>
      <div><strong>{notification.title}</strong>{notification.body ? <p>{notification.body}</p> : null}</div>
      <button onClick={() => void markNotificationRead(notification.id).then(onChange)}>Dismiss</button>
    </article>
  ))}</section>;
}

function AssistantTools({
  schedules, memories, defaultCwd, onChange,
}: { schedules: Schedule[]; memories: Memory[]; defaultCwd: string; onChange: () => void }): React.JSX.Element {
  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderAt, setReminderAt] = useState("");
  const [agentTitle, setAgentTitle] = useState("");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [cwd, setCwd] = useState(defaultCwd);
  const [memoryTitle, setMemoryTitle] = useState("");
  const [memoryBody, setMemoryBody] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!cwd && defaultCwd) setCwd(defaultCwd); }, [cwd, defaultCwd]);
  const reminderSubmit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { await createReminder({ title: reminderTitle, body: "", at: new Date(reminderAt).toISOString() }); setReminderTitle(""); setReminderAt(""); onChange(); }
    finally { setBusy(false); }
  };
  const agentSubmit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { await startAgent({ title: agentTitle, prompt: agentPrompt, cwd }); setAgentTitle(""); setAgentPrompt(""); onChange(); }
    finally { setBusy(false); }
  };
  const memorySubmit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    const slug = memoryTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    try { await createMemory({ slug, title: memoryTitle, body: memoryBody, tags: [] }); setMemoryTitle(""); setMemoryBody(""); onChange(); }
    finally { setBusy(false); }
  };
  return <section className="tools-grid">
    <details open><summary>New reminder <span>{schedules.filter((item) => item.enabled && item.actionKind === "reminder").length} scheduled</span></summary>
      <form onSubmit={(event) => void reminderSubmit(event)}><input placeholder="Reminder title" value={reminderTitle} onChange={(event) => setReminderTitle(event.target.value)} /><input type="datetime-local" value={reminderAt} onChange={(event) => setReminderAt(event.target.value)} /><button className="primary" disabled={busy || !reminderTitle || !reminderAt}>Schedule</button></form>
    </details>
    <details><summary>Spin off Claude <span>managed run</span></summary>
      <form onSubmit={(event) => void agentSubmit(event)}><input placeholder="Run title" value={agentTitle} onChange={(event) => setAgentTitle(event.target.value)} /><textarea placeholder="What should Claude accomplish?" value={agentPrompt} onChange={(event) => setAgentPrompt(event.target.value)} /><input placeholder="Working directory" value={cwd} onChange={(event) => setCwd(event.target.value)} /><button className="primary" disabled={busy || !agentTitle || !agentPrompt || !cwd}>Start run</button></form>
    </details>
    <details><summary>Add memory <span>{memories.length} stored</span></summary>
      <form onSubmit={(event) => void memorySubmit(event)}><input placeholder="Memory title" value={memoryTitle} onChange={(event) => setMemoryTitle(event.target.value)} /><textarea placeholder="What should the assistant remember?" value={memoryBody} onChange={(event) => setMemoryBody(event.target.value)} /><button className="primary" disabled={busy || !memoryTitle || !memoryBody}>Remember</button></form>
      <div className="memory-peek">{memories.slice(0, 3).map((memory) => <span key={memory.id}>{memory.title}</span>)}</div>
    </details>
  </section>;
}

function MemoryWorkspace({ memories, onChange }: { memories: Memory[]; onChange: () => void }): React.JSX.Element {
  type ListItem = Pick<Memory, "id" | "title" | "kind" | "revision" | "summary"> & { snippet: string };
  const initialItems = (items: Memory[]): ListItem[] => items.map((memory) => ({ id: memory.id, title: memory.title, kind: memory.kind, revision: memory.revision, summary: memory.summary, snippet: memory.summary ?? memory.body.slice(0, 100) }));
  const [results, setResults] = useState<ListItem[]>(initialItems(memories));
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [tag, setTag] = useState("");
  const [selected, setSelected] = useState<Memory>();
  const [links, setLinks] = useState<{ outgoing: MemoryLink[]; backlinks: MemoryLink[] }>({ outgoing: [], backlinks: [] });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", body: "", summary: "", kind: "note", project: "", tags: "", aliases: "" });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!query && !project && !tag) setResults(initialItems(memories)); }, [memories, query, project, tag]);
  const open = async (id: string): Promise<void> => {
    setBusy(true); setError(undefined);
    try {
      const bundle = await getMemoryBundle(id);
      setSelected(bundle.memory); setLinks(bundle.links as { outgoing: MemoryLink[]; backlinks: MemoryLink[] }); setEditing(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load memory"); }
    finally { setBusy(false); }
  };
  const search = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); setBusy(true); setError(undefined);
    try { setResults((await searchMemories(query, project, tag)).map((hit) => ({ ...hit.memory, snippet: hit.snippet }))); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Search failed"); }
    finally { setBusy(false); }
  };
  const beginEdit = (): void => {
    if (!selected) return;
    setDraft({ title: selected.title, body: selected.body, summary: selected.summary ?? "", kind: selected.kind, project: selected.project ?? "", tags: selected.tags.join(", "), aliases: selected.aliases.join(", ") });
    setEditing(true); setError(undefined);
  };
  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); if (!selected) return; setBusy(true); setError(undefined);
    try {
      const updated = await updateMemory(selected.id, { title: draft.title, body: draft.body, summary: draft.summary || null, kind: draft.kind, project: draft.project || null, tags: draft.tags.split(",").map((item) => item.trim()).filter(Boolean), aliases: draft.aliases.split(",").map((item) => item.trim()).filter(Boolean), expectedRevision: selected.revision });
      setSelected(updated); setEditing(false); onChange(); await open(updated.id);
    } catch (caught) { setError(caught instanceof Error ? `${caught.message}. Refresh the page before retrying if another editor changed it.` : "Save failed"); }
    finally { setBusy(false); }
  };
  const archive = async (): Promise<void> => {
    if (!selected || !globalThis.confirm(`Archive “${selected.title}”?`)) return;
    setBusy(true); setError(undefined);
    try { await archiveMemory(selected.id, selected.revision); setSelected(undefined); setEditing(false); onChange(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Archive failed"); }
    finally { setBusy(false); }
  };
  return <section className="memory-workspace">
    <div className="section-heading"><div><p className="eyebrow">Knowledge base</p><h2>Memory</h2></div><span>{results.length} active pages</span></div>
    <form className="memory-search" onSubmit={(event) => void search(event)}>
      <input aria-label="Search memory" placeholder="Search titles, aliases, summaries, body, and tags" value={query} onChange={(event) => setQuery(event.target.value)} />
      <input aria-label="Memory project filter" placeholder="Project" value={project} onChange={(event) => setProject(event.target.value)} />
      <input aria-label="Memory tag filter" placeholder="Tag" value={tag} onChange={(event) => setTag(event.target.value)} />
      <button disabled={busy}>Search</button>
    </form>
    {error ? <p className="error banner">{error}</p> : null}
    <div className="memory-layout">
      <nav className="memory-list" aria-label="Memory pages">{results.map((memory) => <button className={selected?.id === memory.id ? "selected" : ""} key={memory.id} onClick={() => void open(memory.id)}><strong>{memory.title}</strong><span>{memory.kind} · r{memory.revision}</span><small>{memory.snippet}</small></button>)}{results.length === 0 ? <p className="empty">No matching memories</p> : null}</nav>
      <article className="memory-reader">
        {!selected ? <p className="empty">Select a memory page to read or edit it.</p> : editing ? <form onSubmit={(event) => void save(event)}>
          <input aria-label="Memory title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          <div className="memory-fields"><input aria-label="Memory kind" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value })} /><input aria-label="Memory project" placeholder="Project" value={draft.project} onChange={(event) => setDraft({ ...draft, project: event.target.value })} /></div>
          <input aria-label="Memory summary" placeholder="Summary" value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} />
          <textarea aria-label="Memory Markdown" value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
          <div className="memory-fields"><input aria-label="Memory tags" placeholder="tags, comma separated" value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} /><input aria-label="Memory aliases" placeholder="aliases, comma separated" value={draft.aliases} onChange={(event) => setDraft({ ...draft, aliases: event.target.value })} /></div>
          <div className="memory-actions"><button type="button" onClick={() => setEditing(false)}>Cancel</button><button className="primary" disabled={busy}>Save revision {selected.revision + 1}</button></div>
        </form> : <>
          <div className="memory-title"><div><h3>{selected.title}</h3><p>{selected.slug} · {selected.kind} · revision {selected.revision}</p></div><div><button onClick={beginEdit}>Edit</button><button onClick={() => void archive()}>Archive</button></div></div>
          {selected.summary ? <p className="memory-summary">{selected.summary}</p> : null}
          <pre>{selected.body}</pre>
          <div className="memory-metadata"><span>Project: {selected.project ?? "none"}</span><span>Tags: {selected.tags.join(", ") || "none"}</span><span>Aliases: {selected.aliases.join(", ") || "none"}</span><span>Source: {selected.provenance.sourceType}{selected.provenance.sourceUri ? ` · ${selected.provenance.sourceUri}` : ""}</span><span>Captured: {new Date(selected.provenance.capturedAt).toLocaleString()}</span></div>
          <div className="memory-links"><div><strong>Links</strong>{links.outgoing.map((link) => link.resolved && link.recordId ? <button key={`${link.slug}-${link.label}`} onClick={() => void open(link.recordId!)}>{link.label ?? link.title ?? link.slug}</button> : <span key={`${link.slug}-${link.label}`}>{link.label ?? link.slug} (unresolved)</span>)}</div><div><strong>Backlinks</strong>{links.backlinks.map((link) => <button key={link.slug} onClick={() => void open(link.recordId!)}>{link.title ?? link.slug}</button>)}</div></div>
        </>}
      </article>
    </div>
  </section>;
}

export default function App(): React.JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [notifications, setNotifications] = useState<AssistantNotification[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [defaultCwd, setDefaultCwd] = useState("");
  const [browserStatus, setBrowserStatus] = useState<BrowserAutomationStatus>({
    backend: "claude_in_chrome", enabled: true, state: "stopped", activeJobId: null,
    lastStartedAt: null, lastCompletedAt: null, lastError: null,
  });
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextTasks, nextSessions, nextRuns, nextApprovals, nextNotifications, nextSchedules, nextMemories, config, nextBrowserStatus] = await Promise.all([
        listTasks(), listSessions(), listRuns(), listPendingApprovals(), listNotifications(), listSchedules(), listMemories(), getConfig(), getBrowserStatus(),
      ]);
      setTasks(nextTasks);
      setSessions(nextSessions);
      setRuns(nextRuns);
      setApprovals(nextApprovals);
      setNotifications(nextNotifications);
      setSchedules(nextSchedules);
      setMemories(nextMemories);
      setDefaultCwd(config.allowedRoots[0] ?? "");
      setBrowserStatus(nextBrowserStatus);
      setAuthenticated(true);
      setError(undefined);
    } catch (caught) {
      if (caught instanceof AuthenticationError) setAuthenticated(false);
      else setError(caught instanceof Error ? caught.message : "Could not load tasks");
    }
  }, []);

  useEffect(() => void refresh(), [refresh]);

  useEffect(() => {
    if (!authenticated) return;
    const events = new EventSource("/api/events/stream", { withCredentials: true });
    events.addEventListener("assistant-event", () => void refresh());
    const refreshTimer = window.setInterval(() => void refresh(), 15_000);
    return () => {
      events.close();
      window.clearInterval(refreshTimer);
    };
  }, [authenticated, refresh]);

  const grouped = useMemo(() => {
    const groups: Record<TaskStatus, Task[]> = {
      inbox: [],
      planned: [],
      active: [],
      blocked: [],
      done: [],
      cancelled: [],
    };
    for (const task of tasks) groups[task.status].push(task);
    return groups;
  }, [tasks]);

  if (authenticated === undefined) return <main className="loading">Starting assistant…</main>;
  if (!authenticated) return <Login onAuthenticated={() => void refresh()} />;

  return (
    <main className="app-shell">
      <header>
        <div>
          <p className="eyebrow">Personal workspace</p>
          <h1>What are we working on?</h1>
        </div>
        <div className="header-meta">
          <span
            className={`browser-health ${browserStatus.state === "ready" || browserStatus.state === "running" ? "connected" : "offline"}`}
            title={browserStatus.lastError ?? (browserStatus.activeJobId ? `Running job ${browserStatus.activeJobId}` : "Uses Claude Code's built-in Chrome integration")}
          ><i /> Chrome {browserStatus.state}</span>
          <span className="live"><i /> Live</span>
          <button
            className="quiet"
            onClick={() => void logout().then(() => setAuthenticated(false))}
          >
            Lock
          </button>
        </div>
      </header>

      <NewTask onCreated={() => void refresh()} />
      {error ? <p className="error banner">{error}</p> : null}
      <NotificationInbox notifications={notifications} onChange={() => void refresh()} />

      <AssistantTools schedules={schedules} memories={memories} defaultCwd={defaultCwd} onChange={() => void refresh()} />

      <MemoryWorkspace memories={memories} onChange={() => void refresh()} />

      <SessionStrip sessions={sessions} />
      <ExecutionPanel runs={runs} approvals={approvals} onChange={() => void refresh()} />

      <section className="summary">
        <div><strong>{grouped.active.length}</strong><span>in focus</span></div>
        <div><strong>{grouped.inbox.length}</strong><span>in inbox</span></div>
        <div><strong>{grouped.blocked.length}</strong><span>blocked</span></div>
      </section>

      <section className="board">
        {visibleStatuses.map((status) => (
          <div className="lane" key={status}>
            <div className="lane-heading">
              <h2>{statusLabels[status]}</h2>
              <span>{grouped[status].length}</span>
            </div>
            <div className="task-list">
              {grouped[status].map((task) => (
                <TaskCard key={task.id} task={task} onChange={() => void refresh()} />
              ))}
              {grouped[status].length === 0 ? <p className="empty">Nothing here</p> : null}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
