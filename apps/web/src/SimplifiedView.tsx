import { useMemo, useState, type FormEvent, type ReactNode } from "react";
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
} from "@cc-assistant/shared";
import { cancelRun, dispatchInput, markNotificationRead, resolveApproval } from "./api.js";

type CompactStatus = "idle" | "paused" | "stopped" | "running" | "waiting" | "attention" | "complete" | "neutral";

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

function sessionStatus(session: ClaudeAgentSession): CompactStatus {
  if (session.waitingFor?.toLowerCase().includes("permission") || session.state === "failed") return "attention";
  if (session.status === "busy" || session.state === "working") return "running";
  if (session.state === "blocked") return "paused";
  if (session.status === "waiting") return "waiting";
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

function CompactPane({
  type,
  title,
  description,
  status,
  children,
}: {
  type: string;
  title: string;
  description: string;
  status: CompactStatus;
  children?: ReactNode;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const presentation = statusPresentation[status];
  return (
    <article className={`compact-pane status-${status}${expanded ? " expanded" : ""}`}>
      <button
        className="compact-pane-toggle"
        type="button"
        aria-expanded={expanded}
        title={expanded ? `Collapse ${title}` : `Expand ${title}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="compact-status" aria-label={presentation.label}>{presentation.icon}</span>
        <span className="compact-type">{type}</span>
        <span className="compact-copy">
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
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
  onChange: () => void;
}): React.JSX.Element {
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [error, setError] = useState<string>();
  const mainController = useMemo(() => sessions
    .filter((session) => session.pid && session.name === "cc-assistant-controller")
    .sort((left, right) => right.startedAt - left.startedAt)[0], [sessions]);

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

  const activeTasks = tasks.filter((task) => !["done", "cancelled"].includes(task.status));
  const activeRuns = runs.filter((run) => !["succeeded", "failed", "cancelled"].includes(run.status));
  const recentRuns = runs.filter((run) => ["succeeded", "failed", "cancelled"].includes(run.status));

  return <div className="simplified-view">
    <section className="dispatcher-panel">
      <div className="dispatcher-heading">
        <div><p className="eyebrow">Main input</p><h2>Dispatcher</h2></div>
        <span className={`controller-indicator status-${mainController ? sessionStatus(mainController) : "attention"}`}>
          {mainController ? `${statusPresentation[sessionStatus(mainController)].icon} ${mainController.status ?? mainController.state ?? "available"}` : "! controller unavailable"}
        </span>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <textarea
          aria-label="Dispatcher field"
          autoFocus
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          placeholder={'Tell the assistant what outcome you want…\nExample: “Remember the Linux version and environment here.”'}
        />
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

    <div className="status-legend" aria-label="Status legend">
      {(Object.entries(statusPresentation) as Array<[CompactStatus, { icon: string; label: string }]>).map(([status, item]) =>
        <span className={`status-${status}`} key={status}><i>{item.icon}</i>{item.label}</span>)}
    </div>

    <CompactGroup title="Needs attention" subtitle="Approvals, unread alerts, and blocked or failed work.">
      {approvals.map((approval) => <CompactPane key={approval.id} type="Approval" title={approval.summary}
        description={sentence(`A one-time ${approval.actionType.replaceAll("_", " ")} decision is waiting`, "Approval required")}
        status="attention">
        <pre>{JSON.stringify(approval.payload, null, 2)}</pre>
        <div className="compact-actions"><button disabled={busy === approval.id} onClick={() => void decide(approval, "denied")}>Deny</button><button className="primary" disabled={busy === approval.id} onClick={() => void decide(approval, "approved")}>Approve once</button></div>
      </CompactPane>)}
      {notifications.map((notification) => <CompactPane key={notification.id} type="Alert" title={notification.title}
        description={sentence(notification.body, "An unread assistant notification needs review")} status="attention">
        <p>{notification.body || "No additional details."}</p>
        <button disabled={busy === notification.id} onClick={() => { setBusy(notification.id); void markNotificationRead(notification.id).then(onChange).finally(() => setBusy(undefined)); }}>Dismiss</button>
      </CompactPane>)}
      {tasks.filter((task) => task.status === "blocked").map((task) => <CompactPane key={`blocked-${task.id}`} type="Task" title={task.title}
        description={sentence(task.description, "A task is blocked and needs a decision or external change")} status="attention"><p>{task.description || "No blocker was recorded."}</p></CompactPane>)}
      {recentRuns.filter((run) => run.status === "failed").map((run) => <CompactPane key={`failed-${run.id}`} type="Run" title={run.title}
        description={sentence(run.error ?? "A managed run failed", "A managed run failed")} status="attention"><pre>{run.error ?? run.result ?? "No failure detail."}</pre></CompactPane>)}
      {approvals.length + notifications.length + tasks.filter((task) => task.status === "blocked").length + recentRuns.filter((run) => run.status === "failed").length === 0 ? <EmptyPane label="Nothing needs attention" /> : null}
    </CompactGroup>

    <CompactGroup title="In motion" subtitle="Current tasks, Claude sessions, and managed work.">
      {activeTasks.map((task) => <CompactPane key={task.id} type="Task" title={task.title}
        description={sentence(task.description, `A ${task.status} task${task.project ? ` in ${task.project}` : ""}`)} status={taskStatus(task)}>
        <p>{task.description || "No description."}</p><small>Priority P{task.priority} · {task.project ?? "No project"}</small>
      </CompactPane>)}
      {sessions.map((session) => <CompactPane key={session.sessionId ?? `${session.cwd}-${session.startedAt}`} type="Claude" title={session.name ?? session.id ?? "Interactive session"}
        description={sentence(`A ${session.kind} Claude session is ${session.waitingFor ?? session.status ?? session.state ?? "saved"}`, "A Claude session")}
        status={sessionStatus(session)}>
        <p>{session.cwd}</p>{session.id ? <code>claude attach {session.id}</code> : null}
      </CompactPane>)}
      {activeRuns.map((run) => <CompactPane key={run.id} type="Run" title={run.title}
        description={sentence(run.prompt ?? `${run.kind} work is ${run.status.replaceAll("_", " ")}`, "Managed work")}
        status={runStatus(run)}>
        <p>{run.prompt ?? run.result ?? run.cwd}</p><button onClick={() => void cancelRun(run.id).then(onChange)}>Cancel</button>
      </CompactPane>)}
      {activeTasks.length + sessions.length + activeRuns.length === 0 ? <EmptyPane label="No active work" /> : null}
    </CompactGroup>

    <CompactGroup title="Scheduled & connected" subtitle="Automations, browser activity, and callable abilities.">
      {schedules.map((schedule) => <CompactPane key={schedule.id} type="Trigger" title={schedule.name}
        description={sentence(`${schedule.triggerKind.replaceAll("_", " ")} triggers ${schedule.actionKind}; next run ${formatTime(schedule.nextRunAt)}`, "Configured automation")}
        status={scheduleStatus(schedule)}><pre>{JSON.stringify({ trigger: schedule.trigger, action: schedule.action }, null, 2)}</pre></CompactPane>)}
      <CompactPane type="Browser" title="Calendar & Slack worker"
        description={sentence(`The signed-in browser worker is ${browserStatus.state}`, "Browser integration status")}
        status={browserStatus.state === "running" ? "running" : browserStatus.state === "ready" ? "idle" : browserStatus.state === "error" ? "attention" : "stopped"}>
        <p>{browserStatus.lastError ?? (browserStatus.lastCompletedAt ? `Last completed ${formatTime(browserStatus.lastCompletedAt)}` : "No recent browser activity.")}</p>
      </CompactPane>
      {abilities.map((ability) => <CompactPane key={ability.id} type="Ability" title={ability.name}
        description={sentence(ability.description, "An installed command ability is available")} status="neutral"><code>{ability.id}</code></CompactPane>)}
    </CompactGroup>

    <CompactGroup title="Recent & remembered" subtitle="Browser results, completed work, and durable memory.">
      {browserJobs.map((job) => <CompactPane key={job.id}
        type={job.adapter === "google_calendar" ? (job.action === "create_event" ? "Calendar" : "Calendar check") : "Slack"}
        title={String(job.input.title ?? job.input.channelName ?? job.action.replaceAll("_", " "))}
        description={sentence(`${job.adapter.replaceAll("_", " ")} ${job.action.replaceAll("_", " ")} ${job.status}`, "Browser job")}
        status={browserJobStatus(job)}><pre>{JSON.stringify(job.error ?? job.result ?? job.input, null, 2)}</pre></CompactPane>)}
      {recentRuns.filter((run) => run.status !== "failed").map((run) => <CompactPane key={`recent-${run.id}`} type="Run" title={run.title}
        description={sentence(run.result ?? `${run.kind} work ${run.status}`, "Completed managed work")} status={runStatus(run)}><pre>{run.result ?? run.error ?? "No result detail."}</pre></CompactPane>)}
      {memories.map((memory) => <CompactPane key={memory.id} type="Memory" title={memory.title}
        description={sentence(memory.summary ?? memory.body, "A durable memory page")}
        status="complete"><p>{clip(memory.body, 600)}</p><small>{memory.kind} · revision {memory.revision}</small></CompactPane>)}
      {browserJobs.length + recentRuns.filter((run) => run.status !== "failed").length + memories.length === 0 ? <EmptyPane label="No recent or remembered items" /> : null}
    </CompactGroup>
  </div>;
}
