import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  type AbilityManifest,
  type Approval,
  type AssistantNotification,
  type BrowserAutomationStatus,
  type BrowserJob,
  type ClaudeAgentSession,
  type ClaudePermissionMode,
  type ClaudeSession,
  type Memory,
  type MemoryLink,
  type Run,
  type Schedule,
  type ScheduleActionKind,
  type ScheduleTriggerKind,
  type Task,
  type TaskStatus,
} from "@cc-assistant/shared";
import {
  AuthenticationError,
  archiveMemory,
  cancelRun,
  controlClaudeSession,
  createBrowserJob,
  createMemory,
  createReminder,
  createSchedule,
  createTask,
  getConfig,
  getBrowserStatus,
  getMemoryBundle,
  installAbility,
  invokeAbility,
  listAbilities,
  listBrowserJobs,
  listClaudeAgentSessions,
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
  proposeCommand,
  readClipboardImage,
  rawApiRequest,
  resolveApproval,
  searchMemories,
  startAgent,
  updateMemory,
  updateSchedule,
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

function localDateValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function resultText(value: unknown): string {
  if (value === null || value === undefined) return "No result yet";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
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

function ClaudeSessionControlPanel({ sessions, defaultCwd, onChange }: {
  sessions: ClaudeAgentSession[]; defaultCwd: string; onChange: () => void;
}): React.JSX.Element {
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("");
  const [permissionMode, setPermissionMode] = useState<ClaudePermissionMode>("manual");
  const [busy, setBusy] = useState<string>();
  const propose = async (key: string, input: Parameters<typeof controlClaudeSession>[0]): Promise<void> => {
    setBusy(key);
    try { await controlClaudeSession(input); onChange(); } finally { setBusy(undefined); }
  };
  return <section className="sessions session-control">
    <div className="section-heading"><div><p className="eyebrow">Orchestration</p><h2>Claude sessions</h2></div><span>{sessions.filter((session) => session.pid).length} running</span></div>
    <form className="session-dispatch" onSubmit={(event) => {
      event.preventDefault();
      if (prompt.trim()) void propose("dispatch", { action: "dispatch", cwd: defaultCwd, prompt, permissionMode, ...(name.trim() ? { name } : {}) }).then(() => { setPrompt(""); setName(""); });
    }}>
      <input aria-label="Session name" placeholder="Optional session name" value={name} onChange={(event) => setName(event.target.value)} />
      <input aria-label="Session task" placeholder="Dispatch a background task…" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
      <select aria-label="Claude permission mode" value={permissionMode} onChange={(event) => setPermissionMode(event.target.value as ClaudePermissionMode)}>
        <option value="manual">Manual permissions</option>
        <option value="auto">Automatic mode</option>
        <option value="bypassPermissions">Bypass permissions</option>
      </select>
      <button className="primary" disabled={busy === "dispatch" || !prompt.trim()}>Propose dispatch</button>
    </form>
    <div className="controller-quickstart">
      <span>Start the main controller as an attachable terminal session.</span>
      <button disabled={busy === "main-controller" || !defaultCwd} onClick={() => void propose("main-controller", {
        action: "dispatch", cwd: defaultCwd, name: "cc-assistant-controller", permissionMode,
        prompt: "Enter cc-assistant controller mode, load durable state read-only, summarize current focus, and wait for direction.",
      })}>Propose main controller</button>
    </div>
    {permissionMode === "bypassPermissions" ? <p className="permission-warning">Bypass mode removes Claude Code permission prompts. Use it only inside an environment you independently trust and isolate.</p> : null}
    <div className="session-list">
      {sessions.map((session) => {
        const target = session.id ?? session.sessionId ?? session.name ?? "";
        const key = session.sessionId ?? `${session.cwd}:${session.startedAt}`;
        return <article className="session-card controllable" key={key}>
          <div className="session-title"><i className={`session-dot ${session.status ?? session.state ?? "ended"}`} /><strong>{session.name ?? session.id ?? "Unnamed"}</strong><span className={`session-status ${session.status ?? session.state ?? "ended"}`}>{session.status ?? session.state ?? "saved"}</span></div>
          <p>{session.kind} · {session.waitingFor ?? session.state ?? "unknown"}</p>
          <div className="session-meta"><span>{session.cwd.split("/").filter(Boolean).at(-1) ?? session.cwd}</span><span>{session.id ?? "interactive"}</span></div>
          {session.kind === "background" && session.id ? <code className="attach-command">claude attach {session.id}</code> : null}
          {session.pid && session.name ? <div className="session-message"><input aria-label={`Message ${session.name}`} placeholder="Message this session…" value={messages[key] ?? ""} onChange={(event) => setMessages({ ...messages, [key]: event.target.value })} /><button disabled={!messages[key]?.trim() || busy === key} onClick={() => void propose(key, { action: "message", target, message: messages[key]! }).then(() => setMessages({ ...messages, [key]: "" }))}>Propose message</button></div> : null}
          {session.kind === "background" && session.id ? <div className="session-actions"><button disabled={busy === key} onClick={() => void propose(key, { action: "stop", target })}>Stop</button><button disabled={busy === key} onClick={() => void propose(key, { action: "respawn", target })}>Respawn</button><button className="danger" disabled={busy === key} onClick={() => void propose(key, { action: "remove", target })}>Remove</button></div> : null}
        </article>;
      })}
      {sessions.length === 0 ? <div className="session-empty">No Claude Code sessions are currently registered with agent view.</div> : null}
    </div>
    <p className="session-safety">Every message and lifecycle action is queued for one-time approval. Target-session permission rules still apply.</p>
  </section>;
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
        {runs.length === 0 ? <div className="session-empty">No managed runs yet. Start one from Claude through MCP or with the <code>cca run</code> developer CLI.</div> : null}
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

function BrowserWorkspace({
  status,
  jobs,
  onChange,
}: {
  status: BrowserAutomationStatus;
  jobs: BrowserJob[];
  onChange: () => void;
}): React.JSX.Element {
  const [calendarDate, setCalendarDate] = useState(localDateValue());
  const [calendarView, setCalendarView] = useState<"day" | "week" | "month">("day");
  const [eventTitle, setEventTitle] = useState("");
  const [eventStart, setEventStart] = useState("");
  const [eventEnd, setEventEnd] = useState("");
  const [channel, setChannel] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Browser request failed");
    } finally {
      setBusy(false);
    }
  };

  return <section className="integration-workspace">
    <div className="section-heading">
      <div><p className="eyebrow">Signed-in browser</p><h2>Calendar &amp; Slack</h2></div>
      <span>{status.enabled ? status.state : "disabled"} · {jobs.length} jobs</span>
    </div>
    {error ? <p className="error banner">{error}</p> : null}
    <div className="integration-grid">
      <article className="control-card">
        <h3>Google Calendar</h3>
        <p>Reads run immediately. Creating an event enters the one-time approval queue.</p>
        <form onSubmit={(event) => { event.preventDefault(); void run(() => createBrowserJob({ adapter: "google_calendar", action: "list_events", input: { date: calendarDate, view: calendarView } })); }}>
          <div className="inline-fields"><input aria-label="Calendar date" type="date" value={calendarDate} onChange={(event) => setCalendarDate(event.target.value)} /><select aria-label="Calendar view" value={calendarView} onChange={(event) => setCalendarView(event.target.value as typeof calendarView)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></div>
          <button disabled={busy || !calendarDate}>Check calendar</button>
        </form>
        <form onSubmit={(event) => { event.preventDefault(); void run(async () => {
          await createBrowserJob({ adapter: "google_calendar", action: "create_event", input: { title: eventTitle, start: new Date(eventStart).toISOString(), end: new Date(eventEnd).toISOString() } });
          setEventTitle(""); setEventStart(""); setEventEnd("");
        }); }}>
          <input aria-label="Calendar event title" placeholder="Event title" value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} />
          <div className="inline-fields"><input aria-label="Calendar event start" type="datetime-local" value={eventStart} onChange={(event) => setEventStart(event.target.value)} /><input aria-label="Calendar event end" type="datetime-local" value={eventEnd} onChange={(event) => setEventEnd(event.target.value)} /></div>
          <button className="primary" disabled={busy || !eventTitle || !eventStart || !eventEnd}>Request event creation</button>
        </form>
      </article>
      <article className="control-card">
        <h3>Slack</h3>
        <p>Uses the exact workspace channel name visible in the signed-in Chrome profile.</p>
        <button disabled={busy} onClick={() => void run(() => createBrowserJob({ adapter: "slack", action: "list_unreads", input: {} }))}>Check unreads</button>
        <form onSubmit={(event) => { event.preventDefault(); void run(() => createBrowserJob({ adapter: "slack", action: "read_channel", input: { channelName: channel } })); }}>
          <input aria-label="Slack channel" placeholder="Exact channel name" value={channel} onChange={(event) => setChannel(event.target.value)} />
          <button disabled={busy || !channel}>Read channel</button>
        </form>
        <form onSubmit={(event) => { event.preventDefault(); void run(async () => {
          await createBrowserJob({ adapter: "slack", action: "send_message", input: { channelName: channel, text: message } });
          setMessage("");
        }); }}>
          <textarea aria-label="Slack message" placeholder="Exact message to approve and send" value={message} onChange={(event) => setMessage(event.target.value)} />
          <button className="primary" disabled={busy || !channel || !message}>Request message send</button>
        </form>
      </article>
      <article className="job-card">
        <h3>Recent browser jobs</h3>
        <div className="job-list">{jobs.slice(0, 8).map((job) => <details key={job.id}>
          <summary><i className={`run-dot ${job.status === "claimed" ? "running" : job.status}`} />{job.adapter.replace("google_", "")} · {job.action.replaceAll("_", " ")}<span>{job.status}</span></summary>
          <pre>{job.error ?? resultText(job.result)}</pre>
        </details>)}{jobs.length === 0 ? <p className="empty">No browser jobs yet</p> : null}</div>
      </article>
    </div>
  </section>;
}

function TriggerWorkspace({
  schedules,
  abilities,
  defaultCwd,
  onChange,
}: {
  schedules: Schedule[];
  abilities: AbilityManifest[];
  defaultCwd: string;
  onChange: () => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [triggerKind, setTriggerKind] = useState<ScheduleTriggerKind>("at");
  const [actionKind, setActionKind] = useState<ScheduleActionKind>("reminder");
  const [triggerJson, setTriggerJson] = useState(() => JSON.stringify({ at: new Date(Date.now() + 3_600_000).toISOString() }, null, 2));
  const [actionJson, setActionJson] = useState(() => JSON.stringify({ title: "Assistant reminder", body: "" }, null, 2));
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const triggerTemplate = (kind: ScheduleTriggerKind): Record<string, unknown> => kind === "at"
    ? { at: new Date(Date.now() + 3_600_000).toISOString() }
    : kind === "interval" ? { everyMs: 3_600_000 } : { app: "Calendar", cooldownMs: 60_000 };
  const actionTemplate = (kind: ScheduleActionKind): Record<string, unknown> => kind === "reminder"
    ? { title: "Assistant reminder", body: "" }
    : kind === "agent" ? { title: "Scheduled agent", prompt: "Describe the task", cwd: defaultCwd }
      : kind === "command" ? { title: "Scheduled command", executable: "git", args: ["status"], cwd: defaultCwd }
        : { abilityId: abilities[0]?.id ?? "say-hello", input: {} };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); setBusy("create"); setError(undefined);
    try {
      await createSchedule({ name, triggerKind, trigger: parseJsonObject(triggerJson, "Trigger"), actionKind, action: parseJsonObject(actionJson, "Action") });
      setName(""); onChange();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create trigger"); }
    finally { setBusy(undefined); }
  };
  const toggle = async (schedule: Schedule): Promise<void> => {
    setBusy(schedule.id); setError(undefined);
    try { await updateSchedule(schedule.id, { enabled: !schedule.enabled, expectedRevision: schedule.revision }); onChange(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update trigger"); }
    finally { setBusy(undefined); }
  };

  return <section className="automation-workspace">
    <div className="section-heading"><div><p className="eyebrow">Automation</p><h2>Triggers</h2></div><span>{schedules.filter((item) => item.enabled).length} enabled</span></div>
    {error ? <p className="error banner">{error}</p> : null}
    <div className="automation-layout">
      <form className="automation-form" onSubmit={(event) => void submit(event)}>
        <input aria-label="Trigger name" placeholder="Trigger name" value={name} onChange={(event) => setName(event.target.value)} />
        <div className="inline-fields">
          <label>When<select value={triggerKind} onChange={(event) => { const value = event.target.value as ScheduleTriggerKind; setTriggerKind(value); setTriggerJson(JSON.stringify(triggerTemplate(value), null, 2)); }}><option value="at">At a time</option><option value="interval">On an interval</option><option value="system_notification">macOS notification</option></select></label>
          <label>Do<select value={actionKind} onChange={(event) => { const value = event.target.value as ScheduleActionKind; setActionKind(value); setActionJson(JSON.stringify(actionTemplate(value), null, 2)); }}><option value="reminder">Send reminder</option><option value="agent">Start agent</option><option value="command">Propose command</option><option value="ability">Invoke ability</option></select></label>
        </div>
        <label>Trigger configuration<textarea className="json-input" value={triggerJson} onChange={(event) => setTriggerJson(event.target.value)} /></label>
        <label>Action configuration<textarea className="json-input" value={actionJson} onChange={(event) => setActionJson(event.target.value)} /></label>
        <button className="primary" disabled={busy === "create" || !name}>Create trigger</button>
      </form>
      <div className="schedule-list">{schedules.map((schedule) => <article key={schedule.id}>
        <div><i className={`schedule-state ${schedule.enabled ? "enabled" : ""}`} /><strong>{schedule.name}</strong><span>revision {schedule.revision}</span></div>
        <p>{schedule.triggerKind.replaceAll("_", " ")} → {schedule.actionKind}</p>
        <small>{schedule.nextRunAt ? `Next ${new Date(schedule.nextRunAt).toLocaleString()}` : schedule.lastRunAt ? `Last ${new Date(schedule.lastRunAt).toLocaleString()}` : "Event-driven"}</small>
        <details><summary>Configuration</summary><pre>{JSON.stringify({ trigger: schedule.trigger, action: schedule.action }, null, 2)}</pre></details>
        <button disabled={busy === schedule.id} onClick={() => void toggle(schedule)}>{schedule.enabled ? "Disable" : "Enable"}</button>
      </article>)}{schedules.length === 0 ? <p className="empty">No triggers configured</p> : null}</div>
    </div>
  </section>;
}

function CapabilityWorkspace({
  abilities,
  defaultCwd,
  onChange,
}: {
  abilities: AbilityManifest[];
  defaultCwd: string;
  onChange: () => void;
}): React.JSX.Element {
  const [commandTitle, setCommandTitle] = useState("");
  const [executable, setExecutable] = useState("");
  const [commandArgs, setCommandArgs] = useState("");
  const [cwd, setCwd] = useState(defaultCwd);
  const [manifestJson, setManifestJson] = useState("");
  const [abilityInputs, setAbilityInputs] = useState<Record<string, string>>({});
  const [clipboard, setClipboard] = useState<{ mimeType: string; dataUrl: string }>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => { if (!cwd && defaultCwd) setCwd(defaultCwd); }, [cwd, defaultCwd]);
  const perform = async (key: string, action: () => Promise<void>): Promise<void> => {
    setBusy(key); setError(undefined);
    try { await action(); onChange(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Capability request failed"); }
    finally { setBusy(undefined); }
  };

  return <section className="capability-workspace">
    <div className="section-heading"><div><p className="eyebrow">Local capabilities</p><h2>Commands, abilities &amp; clipboard</h2></div><span>{abilities.length} abilities</span></div>
    {error ? <p className="error banner">{error}</p> : null}
    <div className="integration-grid">
      <article className="control-card">
        <h3>Propose local command</h3><p>Arguments are one per line and are passed without a shell. Nothing runs until approved.</p>
        <form onSubmit={(event) => { event.preventDefault(); void perform("command", async () => {
          await proposeCommand({ title: commandTitle, executable, args: commandArgs.split("\n").filter((value) => value.length > 0), cwd });
          setCommandTitle(""); setExecutable(""); setCommandArgs("");
        }); }}>
          <input placeholder="Purpose" value={commandTitle} onChange={(event) => setCommandTitle(event.target.value)} />
          <input placeholder="Executable, e.g. git" value={executable} onChange={(event) => setExecutable(event.target.value)} />
          <textarea placeholder={'Arguments, one per line\nstatus\n--short'} value={commandArgs} onChange={(event) => setCommandArgs(event.target.value)} />
          <input aria-label="Command working directory" value={cwd} onChange={(event) => setCwd(event.target.value)} />
          <button className="primary" disabled={busy === "command" || !commandTitle || !executable || !cwd}>Request approval</button>
        </form>
      </article>
      <article className="control-card">
        <h3>Abilities</h3><p>Invoke installed manifests or install a version-1 manifest. Invocations use normal command approval.</p>
        <div className="ability-list">{abilities.map((ability) => <form key={ability.id} onSubmit={(event) => { event.preventDefault(); void perform(ability.id, () => invokeAbility(ability.id, parseJsonObject(abilityInputs[ability.id] ?? "{}", "Ability input"))); }}>
          <label><strong>{ability.name}</strong><span>{ability.description}</span></label>
          <textarea className="json-input compact" aria-label={`${ability.name} input`} value={abilityInputs[ability.id] ?? "{}"} onChange={(event) => setAbilityInputs({ ...abilityInputs, [ability.id]: event.target.value })} />
          <button disabled={busy === ability.id}>Invoke</button>
        </form>)}</div>
        <details><summary>Install manifest JSON</summary><form onSubmit={(event) => { event.preventDefault(); void perform("install", async () => { await installAbility(parseJsonObject(manifestJson, "Manifest")); setManifestJson(""); }); }}><textarea className="json-input" placeholder='{"manifestVersion":1,...}' value={manifestJson} onChange={(event) => setManifestJson(event.target.value)} /><button disabled={busy === "install" || !manifestJson}>Install or update</button></form></details>
      </article>
      <article className="control-card clipboard-card">
        <h3>Clipboard image</h3><p>Read the current PNG/TIFF image from the local desktop without uploading it.</p>
        <button disabled={busy === "clipboard"} onClick={() => void perform("clipboard", async () => setClipboard(await readClipboardImage()))}>Read clipboard</button>
        {clipboard ? <figure><img src={clipboard.dataUrl} alt="Current clipboard" /><figcaption>{clipboard.mimeType}</figcaption></figure> : <div className="clipboard-empty">No clipboard image loaded</div>}
      </article>
    </div>
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
          <div className="memory-metadata"><span>Project: {selected.project ?? "none"}</span><span>Tags: {selected.tags.join(", ") || "none"}</span><span>Aliases: {selected.aliases.join(", ") || "none"}</span><span>Source: {selected.provenance.sourceType}{selected.provenance.sourceUri ? ` · ${selected.provenance.sourceUri}` : ""}{selected.provenance.sourceRef ? ` · ${selected.provenance.sourceRef}` : ""}</span><span>Captured: {new Date(selected.provenance.capturedAt).toLocaleString()}</span></div>
          <div className="memory-links"><div><strong>Links</strong>{links.outgoing.map((link) => link.resolved && link.recordId ? <button key={`${link.slug}-${link.label}`} onClick={() => void open(link.recordId!)}>{link.label ?? link.title ?? link.slug}</button> : <span key={`${link.slug}-${link.label}`}>{link.label ?? link.slug} (unresolved)</span>)}</div><div><strong>Backlinks</strong>{links.backlinks.map((link) => <button key={link.slug} onClick={() => void open(link.recordId!)}>{link.title ?? link.slug}</button>)}</div></div>
        </>}
      </article>
    </div>
  </section>;
}

function StateStudio({ snapshot, onChange }: { snapshot: Record<string, unknown>; onChange: () => void }): React.JSX.Element {
  const [method, setMethod] = useState<"GET" | "POST" | "PATCH" | "DELETE">("GET");
  const [path, setPath] = useState("/api/tasks");
  const [body, setBody] = useState("{}");
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const execute = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true); setError(undefined);
    try {
      if (!path.startsWith("/api/")) throw new Error("State requests must target an /api/ path");
      const init: RequestInit = { method };
      if (method !== "GET" && method !== "DELETE") init.body = JSON.stringify(JSON.parse(body) as unknown);
      setResult(await rawApiRequest(path, init));
      if (method !== "GET") onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "State request failed");
    } finally { setBusy(false); }
  };

  return <details className="state-studio">
    <summary><span><strong>Developer state studio</strong><small>Inspect the current snapshot and call validated daemon APIs directly</small></span></summary>
    <div className="state-studio-grid">
      <section>
        <h3>Current state</h3>
        <pre>{JSON.stringify(snapshot, null, 2)}</pre>
      </section>
      <section>
        <h3>API editor</h3>
        <p>Writes still pass schema validation, optimistic revisions, audit events, and live updates. They never edit SQLite directly.</p>
        <form onSubmit={(event) => void execute(event)}>
          <div className="state-request-line">
            <select aria-label="State request method" value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>
              <option>GET</option><option>POST</option><option>PATCH</option><option>DELETE</option>
            </select>
            <input aria-label="State API path" value={path} onChange={(event) => setPath(event.target.value)} />
          </div>
          {method !== "GET" && method !== "DELETE" ? <textarea className="json-input" aria-label="State request JSON" value={body} onChange={(event) => setBody(event.target.value)} /> : null}
          <button className="primary" disabled={busy || !path.startsWith("/api/")}>{busy ? "Running…" : "Execute request"}</button>
        </form>
        {error ? <p className="error banner">{error}</p> : null}
        {result !== undefined ? <pre>{JSON.stringify(result, null, 2)}</pre> : null}
      </section>
    </div>
  </details>;
}

export default function App(): React.JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [claudeAgentSessions, setClaudeAgentSessions] = useState<ClaudeAgentSession[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [notifications, setNotifications] = useState<AssistantNotification[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [abilities, setAbilities] = useState<AbilityManifest[]>([]);
  const [browserJobs, setBrowserJobs] = useState<BrowserJob[]>([]);
  const [defaultCwd, setDefaultCwd] = useState("");
  const [browserStatus, setBrowserStatus] = useState<BrowserAutomationStatus>({
    backend: "claude_in_chrome", enabled: true, state: "stopped", activeJobId: null,
    lastStartedAt: null, lastCompletedAt: null, lastError: null,
  });
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextTasks, nextSessions, nextClaudeAgentSessions, nextRuns, nextApprovals, nextNotifications, nextSchedules, nextMemories, nextAbilities, nextBrowserJobs, config, nextBrowserStatus] = await Promise.all([
        listTasks(), listSessions(), listClaudeAgentSessions(), listRuns(), listPendingApprovals(), listNotifications(), listSchedules(), listMemories(), listAbilities(), listBrowserJobs(), getConfig(), getBrowserStatus(),
      ]);
      setTasks(nextTasks);
      setSessions(nextSessions);
      setClaudeAgentSessions(nextClaudeAgentSessions);
      setRuns(nextRuns);
      setApprovals(nextApprovals);
      setNotifications(nextNotifications);
      setSchedules(nextSchedules);
      setMemories(nextMemories);
      setAbilities(nextAbilities);
      setBrowserJobs(nextBrowserJobs);
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

      <BrowserWorkspace status={browserStatus} jobs={browserJobs} onChange={() => void refresh()} />

      <TriggerWorkspace schedules={schedules} abilities={abilities} defaultCwd={defaultCwd} onChange={() => void refresh()} />

      <CapabilityWorkspace abilities={abilities} defaultCwd={defaultCwd} onChange={() => void refresh()} />

      <MemoryWorkspace memories={memories} onChange={() => void refresh()} />

      <ClaudeSessionControlPanel sessions={claudeAgentSessions} defaultCwd={defaultCwd} onChange={() => void refresh()} />
      <SessionStrip sessions={sessions} />
      <ExecutionPanel runs={runs} approvals={approvals} onChange={() => void refresh()} />

      <StateStudio snapshot={{
        tasks, observedSessions: sessions, claudeSessions: claudeAgentSessions, runs, approvals,
        notifications, schedules, memories, abilities, browserJobs, browserStatus,
      }} onChange={() => void refresh()} />

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
