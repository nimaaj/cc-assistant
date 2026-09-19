#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { DaemonClient } from "@cc-assistant/client";
import {
  ApprovalListSchema,
  ClaudeAgentSessionListSchema,
  ClaudeSessionListSchema,
  RunListSchema,
  RunSchema,
  TaskListSchema,
  TaskSchema,
  taskStatuses,
  type ClaudeSession,
  type ClaudeAgentSession,
  type Task,
  type TaskStatus,
} from "@cc-assistant/shared";
import { readAllEvents, readAllMemories } from "./state-export.js";

const rawArgs = process.argv.slice(2);
const jsonIndex = rawArgs.indexOf("--json");
const jsonOutput = jsonIndex !== -1;
if (jsonIndex !== -1) rawArgs.splice(jsonIndex, 1);

const client = new DaemonClient({
  source: "cli",
  // This CLI ships with the project and its documented development daemon uses
  // the repository-local data directory. Explicit environment configuration
  // still wins for installed/service deployments.
  dataDir: process.env.CC_ASSISTANT_DATA_DIR ?? resolve(import.meta.dirname, "../../..", ".data"),
});

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printTasks(tasks: Task[]): void {
  if (jsonOutput) return printJson({ tasks });
  console.table(
    tasks.map((task) => ({
      id: task.id,
      status: task.status,
      priority: task.priority,
      project: task.project ?? "",
      title: task.title,
      revision: task.revision,
      updated: task.updatedAt,
    })),
  );
}

function printSessions(sessions: ClaudeSession[]): void {
  if (jsonOutput) return printJson({ sessions });
  console.table(
    sessions.map((session) => ({
      id: session.id,
      status: session.status,
      cwd: session.cwd,
      model: session.model ?? "",
      event: session.lastEvent,
      updated: session.lastEventAt,
    })),
  );
}

function printClaudeAgentSessions(sessions: ClaudeAgentSession[]): void {
  if (jsonOutput) return printJson({ sessions });
  console.table(sessions.map((session) => ({
    id: session.id ?? "", name: session.name ?? "", kind: session.kind,
    state: session.state ?? "", status: session.status ?? "", waitingFor: session.waitingFor ?? "",
    cwd: session.cwd, sessionId: session.sessionId ?? "",
  })));
}

function help(): never {
  console.log(`cc-assistant developer CLI

Usage:
  pnpm cca status [--json]
  pnpm cca task list [--status <status>] [--json]
  pnpm cca task get <id> [--json]
  pnpm cca task create <title> [--project <name>] [--description <text>]
                       [--status <status>] [--priority <0-4>] [--due <ISO time>]
  pnpm cca task update <id> [--title <title>] [--description <text>]
                       [--project <name> | --clear-project] [--status <status>]
                       [--priority <0-4>] [--due <ISO time> | --clear-due]
                       [--revision <number>]
  pnpm cca task focus <id> [--revision <number>]
  pnpm cca task complete <id> [--revision <number>]
  pnpm cca session list [--all] [--json]
  pnpm cca session get <id> [--json]
  pnpm cca claude-session list [--active] [--json]
  pnpm cca claude-session logs <id-or-name>
  pnpm cca claude-session message <id-or-name> <message>
  pnpm cca claude-session dispatch <prompt> --cwd <path> [--name <name>]
                                  [--model <model>] [--effort <level>]
                                  [--permission-mode <mode>]
  pnpm cca claude-session continue <id-or-name> <prompt>
  pnpm cca claude-session stop|respawn|remove <id-or-name>
  pnpm cca run list [--status <status>] [--json]
  pnpm cca run get <id> [--json]
  pnpm cca run logs <id> [--after <sequence>] [--json]
  pnpm cca run agent <title> --prompt <text> [--cwd <path>] [--model <model>]
                     [--effort <level>] [--max-turns <n>] [--max-budget <usd>]
                     [--task <id>] [--worktree]
  pnpm cca run command <title> <executable> [args...] [--cwd <path>]
                       [--timeout <ms>] [--task <id>]
  pnpm cca run cancel <id>
  pnpm cca approval list [--status <status>] [--json]
  pnpm cca approval approve <id> [--note <text>]
  pnpm cca approval deny <id> [--note <text>]
  pnpm cca memory list [--project <name>] [--kind <kind>] [--tag <tag>] [--all]
  pnpm cca memory search <query> [--project <name>] [--limit <n>]
  pnpm cca memory recall <query> [--project <name>] [--limit <n>] [--characters <n>]
  pnpm cca memory get <id-or-slug> [--json]
  pnpm cca memory create <title> [--slug <slug>] [--body <text> | --body-file <file> | --stdin]
                         [--tag <tag>...] [--alias <name>...] [--project <name>] [--kind <kind>]
  pnpm cca memory update <id-or-slug> --revision <n> [--title <text>]
                         [--body <text> | --body-file <file> | --stdin] [--tag <tag>...]
  pnpm cca memory archive <id-or-slug> --revision <n>
  pnpm cca memory revisions|links <id-or-slug>
  pnpm cca schedule list [--json]
  pnpm cca schedule create <name> --trigger-kind <kind> --trigger <json>
                           --action-kind <kind> --action <json>
  pnpm cca schedule enable|disable <id> --revision <n>
  pnpm cca notification list [--all] [--json]
  pnpm cca notification read <id>
  pnpm cca ability list [--json]
  pnpm cca ability install <manifest.json>
  pnpm cca ability invoke <id> [json-input]
  pnpm cca browser calendar list [YYYY-MM-DD] [--view day|week|month]
  pnpm cca browser calendar create <json-input>
  pnpm cca browser slack unreads
  pnpm cca browser slack read <channel>
  pnpm cca browser slack send <channel> <text>
  pnpm cca native clipboard-image --output <file>
  pnpm cca native notify <title> [body]
  pnpm cca event list [--after <id>] [--limit <1-500>] [--json]
  pnpm cca state export [--json]
  pnpm cca api <METHOD> </api/path> [json-body] [--json]

Configuration:
  CC_ASSISTANT_DATA_DIR   Directory containing access-token
  CC_ASSISTANT_DAEMON_URL  Daemon URL (default http://127.0.0.1:4317)
  CC_ASSISTANT_TOKEN      Explicit token override
`);
  process.exit(0);
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing required ${name}`);
  return value;
}

function numberOption(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

function statusOption(value: string | undefined): TaskStatus | undefined {
  if (value === undefined) return undefined;
  if (!taskStatuses.includes(value as TaskStatus)) {
    throw new Error(`status must be one of: ${taskStatuses.join(", ")}`);
  }
  return value as TaskStatus;
}

async function taskCommand(args: string[]): Promise<void> {
  const action = args.shift();
  if (action === "list") {
    const parsed = parseArgs({
      args,
      options: { status: { type: "string" } },
      strict: true,
    });
    const status = statusOption(parsed.values.status);
    const query = status ? `?status=${status}` : "";
    const payload = TaskListSchema.parse(await client.request(`/api/tasks${query}`));
    return printTasks(payload.tasks);
  }

  if (action === "get") {
    const id = required(args[0], "task ID");
    const payload = (await client.request(`/api/tasks/${encodeURIComponent(id)}`)) as {
      task: unknown;
    };
    const task = TaskSchema.parse(payload.task);
    return jsonOutput ? printJson({ task }) : printTasks([task]);
  }

  if (action === "create") {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        project: { type: "string" },
        description: { type: "string" },
        status: { type: "string" },
        priority: { type: "string" },
        due: { type: "string" },
      },
      strict: true,
    });
    const title = required(parsed.positionals[0], "task title");
    const body = {
      title,
      ...(parsed.values.project ? { project: parsed.values.project } : {}),
      ...(parsed.values.description ? { description: parsed.values.description } : {}),
      ...(parsed.values.status ? { status: statusOption(parsed.values.status) } : {}),
      ...(parsed.values.priority
        ? { priority: numberOption(parsed.values.priority, "priority") }
        : {}),
      ...(parsed.values.due ? { dueAt: parsed.values.due } : {}),
    };
    const payload = (await client.request("/api/tasks", {
      method: "POST",
      body: JSON.stringify(body),
    })) as { task: unknown };
    const task = TaskSchema.parse(payload.task);
    return jsonOutput ? printJson({ task }) : printTasks([task]);
  }

  if (action === "update") {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        title: { type: "string" },
        description: { type: "string" },
        project: { type: "string" },
        "clear-project": { type: "boolean" },
        status: { type: "string" },
        priority: { type: "string" },
        due: { type: "string" },
        "clear-due": { type: "boolean" },
        revision: { type: "string" },
      },
      strict: true,
    });
    const id = required(parsed.positionals[0], "task ID");
    const body = {
      ...(parsed.values.title !== undefined ? { title: parsed.values.title } : {}),
      ...(parsed.values.description !== undefined
        ? { description: parsed.values.description }
        : {}),
      ...(parsed.values["clear-project"]
        ? { project: null }
        : parsed.values.project !== undefined
          ? { project: parsed.values.project }
          : {}),
      ...(parsed.values.status ? { status: statusOption(parsed.values.status) } : {}),
      ...(parsed.values.priority !== undefined
        ? { priority: numberOption(parsed.values.priority, "priority") }
        : {}),
      ...(parsed.values["clear-due"]
        ? { dueAt: null }
        : parsed.values.due !== undefined
          ? { dueAt: parsed.values.due }
          : {}),
      ...(parsed.values.revision !== undefined
        ? { expectedRevision: numberOption(parsed.values.revision, "revision") }
        : {}),
    };
    const payload = (await client.request(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    })) as { task: unknown };
    const task = TaskSchema.parse(payload.task);
    return jsonOutput ? printJson({ task }) : printTasks([task]);
  }

  if (action === "focus" || action === "complete") {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      options: { revision: { type: "string" } },
      strict: true,
    });
    const id = required(parsed.positionals[0], "task ID");
    const body = {
      status: action === "focus" ? "active" : "done",
      ...(parsed.values.revision
        ? { expectedRevision: numberOption(parsed.values.revision, "revision") }
        : {}),
    };
    const payload = (await client.request(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    })) as { task: unknown };
    const task = TaskSchema.parse(payload.task);
    return jsonOutput ? printJson({ task }) : printTasks([task]);
  }

  help();
}

async function sessionCommand(args: string[]): Promise<void> {
  const action = args.shift();
  if (action === "list") {
    const parsed = parseArgs({
      args,
      options: { all: { type: "boolean" } },
      strict: true,
    });
    const payload = ClaudeSessionListSchema.parse(
      await client.request(`/api/sessions${parsed.values.all ? "?includeEnded=true" : ""}`),
    );
    return printSessions(payload.sessions);
  }
  if (action === "get") {
    const id = required(args[0], "session ID");
    const payload = (await client.request(`/api/sessions/${encodeURIComponent(id)}`)) as {
      session: unknown;
    };
    return jsonOutput ? printJson(payload) : printSessions([payload.session as ClaudeSession]);
  }
  help();
}

async function claudeSessionCommand(args: string[]): Promise<void> {
  const action = args.shift();
  if (action === "list") {
    const parsed = parseArgs({ args, options: { active: { type: "boolean" } }, strict: true });
    const payload = ClaudeAgentSessionListSchema.parse(await client.request(
      `/api/claude/sessions?includeCompleted=${!parsed.values.active}`,
    ));
    return printClaudeAgentSessions(payload.sessions);
  }
  if (action === "logs") {
    const target = required(args[0], "session ID or name");
    const payload = await client.request(`/api/claude/sessions/${encodeURIComponent(target)}/logs`) as { logs: string };
    if (jsonOutput) printJson(payload);
    else process.stdout.write(payload.logs.endsWith("\n") ? payload.logs : `${payload.logs}\n`);
    return;
  }
  if (action === "dispatch") {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        cwd: { type: "string" }, name: { type: "string" }, model: { type: "string" },
        effort: { type: "string" }, "permission-mode": { type: "string" },
      },
    });
    const body = {
      action, prompt: required(parsed.positionals[0], "prompt"), cwd: required(parsed.values.cwd, "--cwd"),
      ...(parsed.values.name ? { name: parsed.values.name } : {}),
      ...(parsed.values.model ? { model: parsed.values.model } : {}),
      ...(parsed.values.effort ? { effort: parsed.values.effort } : {}),
      ...(parsed.values["permission-mode"] ? { permissionMode: parsed.values["permission-mode"] } : {}),
    };
    return printJson(await client.request("/api/claude/sessions/control", { method: "POST", body: JSON.stringify(body) }));
  }
  if (action === "message" || action === "continue") {
    const target = required(args[0], "session ID or name");
    const text = required(args[1], action === "message" ? "message" : "prompt");
    const body = action === "message" ? { action, target, message: text } : { action, target, prompt: text };
    return printJson(await client.request("/api/claude/sessions/control", { method: "POST", body: JSON.stringify(body) }));
  }
  if (action === "stop" || action === "respawn" || action === "remove") {
    const target = required(args[0], "session ID or name");
    return printJson(await client.request("/api/claude/sessions/control", {
      method: "POST", body: JSON.stringify({ action, target }),
    }));
  }
  help();
}

async function eventCommand(args: string[]): Promise<void> {
  const action = args.shift();
  if (action !== "list") help();
  const parsed = parseArgs({
    args,
    options: { after: { type: "string" }, limit: { type: "string" } },
    strict: true,
  });
  const after = numberOption(parsed.values.after, "after") ?? 0;
  const limit = numberOption(parsed.values.limit, "limit") ?? 100;
  const payload = await client.request(`/api/events?after=${after}&limit=${limit}`);
  if (jsonOutput) return printJson(payload);
  console.table(
    (payload as { events: Array<Record<string, unknown>> }).events.map((event) => ({
      id: event.id,
      type: event.type,
      source: event.source,
      entity: `${event.entityType ?? ""}:${event.entityId ?? ""}`,
      occurredAt: event.occurredAt,
    })),
  );
}

async function runCommand(args: string[]): Promise<void> {
  const action = args.shift();
  if (action === "list") {
    const parsed = parseArgs({ args, options: { status: { type: "string" } }, strict: true });
    const suffix = parsed.values.status ? `?status=${encodeURIComponent(parsed.values.status)}` : "";
    const payload = RunListSchema.parse(await client.request(`/api/runs${suffix}`));
    if (jsonOutput) return printJson(payload);
    console.table(payload.runs.map((run) => ({
      id: run.id,
      kind: run.kind,
      status: run.status,
      title: run.title,
      cwd: run.cwd,
      created: run.createdAt,
    })));
    return;
  }
  if (action === "get") {
    const id = required(args[0], "run ID");
    const payload = (await client.request(`/api/runs/${encodeURIComponent(id)}`)) as { run: unknown };
    return printJson({ run: RunSchema.parse(payload.run) });
  }
  if (action === "logs") {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      options: { after: { type: "string" } },
      strict: true,
    });
    const id = required(parsed.positionals[0], "run ID");
    const after = numberOption(parsed.values.after, "after") ?? -1;
    const payload = await client.request(`/api/runs/${encodeURIComponent(id)}/logs?after=${after}`);
    if (jsonOutput) return printJson(payload);
    for (const log of (payload as { logs: Array<Record<string, unknown>> }).logs) {
      console.log(`${log.occurredAt} [${log.level}] ${log.message}`);
    }
    return;
  }
  if (action === "agent") {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        prompt: { type: "string" }, cwd: { type: "string" }, model: { type: "string" },
        effort: { type: "string" }, "max-turns": { type: "string" },
        "max-budget": { type: "string" }, task: { type: "string" },
        worktree: { type: "boolean" },
      },
      strict: true,
    });
    const body = {
      title: required(parsed.positionals[0], "run title"),
      prompt: required(parsed.values.prompt, "--prompt"),
      cwd: parsed.values.cwd ?? process.cwd(),
      ...(parsed.values.model ? { model: parsed.values.model } : {}),
      ...(parsed.values.effort ? { effort: parsed.values.effort } : {}),
      ...(parsed.values["max-turns"] ? { maxTurns: numberOption(parsed.values["max-turns"], "max-turns") } : {}),
      ...(parsed.values["max-budget"] ? { maxBudgetUsd: Number(parsed.values["max-budget"]) } : {}),
      ...(parsed.values.task ? { taskId: parsed.values.task } : {}),
      useWorktree: parsed.values.worktree ?? false,
    };
    return printJson(await client.request("/api/runs/agent", { method: "POST", body: JSON.stringify(body) }));
  }
  if (action === "command") {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      options: { cwd: { type: "string" }, timeout: { type: "string" }, task: { type: "string" } },
      strict: true,
    });
    const body = {
      title: required(parsed.positionals[0], "run title"),
      executable: required(parsed.positionals[1], "executable"),
      args: parsed.positionals.slice(2),
      cwd: parsed.values.cwd ?? process.cwd(),
      ...(parsed.values.timeout ? { timeoutMs: numberOption(parsed.values.timeout, "timeout") } : {}),
      ...(parsed.values.task ? { taskId: parsed.values.task } : {}),
    };
    return printJson(await client.request("/api/runs/command", { method: "POST", body: JSON.stringify(body) }));
  }
  if (action === "cancel") {
    const id = required(args[0], "run ID");
    return printJson(await client.request(`/api/runs/${encodeURIComponent(id)}/cancel`, { method: "POST" }));
  }
  help();
}

async function approvalCommand(args: string[]): Promise<void> {
  const action = args.shift();
  if (action === "list") {
    const parsed = parseArgs({ args, options: { status: { type: "string" } }, strict: true });
    const suffix = parsed.values.status ? `?status=${encodeURIComponent(parsed.values.status)}` : "";
    const payload = ApprovalListSchema.parse(await client.request(`/api/approvals${suffix}`));
    if (jsonOutput) return printJson(payload);
    console.table(payload.approvals.map((approval) => ({
      id: approval.id,
      status: approval.status,
      action: approval.actionType,
      summary: approval.summary,
      run: approval.runId,
      created: approval.createdAt,
    })));
    return;
  }
  if (action === "approve" || action === "deny") {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      options: { note: { type: "string" } },
      strict: true,
    });
    const id = required(parsed.positionals[0], "approval ID");
    return printJson(await client.request(`/api/approvals/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      body: JSON.stringify({ decision: action === "approve" ? "approved" : "denied", note: parsed.values.note ?? null }),
    }));
  }
  help();
}

async function memoryCommand(args: string[]): Promise<void> {
  const action = args.shift();
  if (action === "list") {
    const parsed = parseArgs({ args, options: { project: { type: "string" }, kind: { type: "string" }, tag: { type: "string" }, all: { type: "boolean" } }, strict: true });
    const params = new URLSearchParams();
    if (parsed.values.project) params.set("project", parsed.values.project);
    if (parsed.values.kind) params.set("kind", parsed.values.kind);
    if (parsed.values.tag) params.set("tag", parsed.values.tag);
    if (parsed.values.all) params.set("includeArchived", "true");
    return printJson(await client.request(`/api/memories?${params}`));
  }
  if (action === "search" || action === "recall") {
    const parsed = parseArgs({ args, allowPositionals: true, options: { project: { type: "string" }, kind: { type: "string" }, tag: { type: "string" }, limit: { type: "string" }, characters: { type: "string" } }, strict: true });
    const query = required(parsed.positionals[0], "search query");
    if (action === "search") {
      const params = new URLSearchParams({ q: query, limit: String(numberOption(parsed.values.limit, "limit") ?? 20) });
      if (parsed.values.project) params.set("project", parsed.values.project);
      if (parsed.values.kind) params.set("kind", parsed.values.kind);
      if (parsed.values.tag) params.set("tag", parsed.values.tag);
      return printJson(await client.request(`/api/memories/search?${params}`));
    }
    return printJson(await client.request("/api/memories/recall", { method: "POST", body: JSON.stringify({
      query, project: parsed.values.project, kind: parsed.values.kind, tag: parsed.values.tag,
      limit: numberOption(parsed.values.limit, "limit") ?? 5,
      characterLimit: numberOption(parsed.values.characters, "characters") ?? 12_000,
    }) }));
  }
  if (action === "get") {
    const id = encodeURIComponent(required(args[0], "memory ID or slug"));
    const [memory, links] = await Promise.all([client.request(`/api/memories/${id}`), client.request(`/api/memories/${id}/links`)]);
    return printJson({ ...(memory as object), links });
  }
  if (action === "create") {
    const parsed = parseArgs({ args, allowPositionals: true, options: { slug: { type: "string" }, body: { type: "string" }, "body-file": { type: "string" }, stdin: { type: "boolean" }, tag: { type: "string", multiple: true }, alias: { type: "string", multiple: true }, project: { type: "string" }, kind: { type: "string" }, summary: { type: "string" }, "source-type": { type: "string" }, "source-uri": { type: "string" } }, strict: true });
    const bodyText = parsed.values["body-file"] ? readFileSync(parsed.values["body-file"], "utf8") : parsed.values.stdin ? readFileSync(0, "utf8") : parsed.values.body ?? "";
    return printJson(await client.request("/api/memories", { method: "POST", body: JSON.stringify({
      title: required(parsed.positionals[0], "title"), body: bodyText, slug: parsed.values.slug,
      tags: parsed.values.tag ?? [], aliases: parsed.values.alias ?? [], project: parsed.values.project,
      kind: parsed.values.kind, summary: parsed.values.summary, sourceType: parsed.values["source-type"], sourceUri: parsed.values["source-uri"],
    }) }));
  }
  if (action === "update") {
    const parsed = parseArgs({ args, allowPositionals: true, options: { title: { type: "string" }, body: { type: "string" }, "body-file": { type: "string" }, stdin: { type: "boolean" }, tag: { type: "string", multiple: true }, alias: { type: "string", multiple: true }, project: { type: "string" }, kind: { type: "string" }, summary: { type: "string" }, revision: { type: "string" } }, strict: true });
    const id = required(parsed.positionals[0], "memory ID or slug");
    const bodyText = parsed.values["body-file"] ? readFileSync(parsed.values["body-file"], "utf8") : parsed.values.stdin ? readFileSync(0, "utf8") : parsed.values.body;
    const body = { ...(parsed.values.title !== undefined ? { title: parsed.values.title } : {}),
      ...(bodyText !== undefined ? { body: bodyText } : {}), ...(parsed.values.tag ? { tags: parsed.values.tag } : {}),
      ...(parsed.values.alias ? { aliases: parsed.values.alias } : {}), ...(parsed.values.project ? { project: parsed.values.project } : {}),
      ...(parsed.values.kind ? { kind: parsed.values.kind } : {}), ...(parsed.values.summary ? { summary: parsed.values.summary } : {}),
      expectedRevision: numberOption(required(parsed.values.revision, "--revision"), "revision") };
    return printJson(await client.request(`/api/memories/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }));
  }
  if (action === "archive") {
    const parsed = parseArgs({ args, allowPositionals: true, options: { revision: { type: "string" } }, strict: true });
    const id = required(parsed.positionals[0], "memory ID or slug");
    const expectedRevision = numberOption(required(parsed.values.revision, "--revision"), "revision");
    return printJson(await client.request(`/api/memories/${encodeURIComponent(id)}/archive`, { method: "POST", body: JSON.stringify({ expectedRevision }) }));
  }
  if (action === "revisions" || action === "links") {
    const id = encodeURIComponent(required(args[0], "memory ID or slug"));
    return printJson(await client.request(`/api/memories/${id}/${action}`));
  }
  help();
}

async function scheduleCommand(args: string[]): Promise<void> {
  const action = args.shift();
  if (action === "list") return printJson(await client.request("/api/schedules"));
  if (action === "create") {
    const parsed = parseArgs({ args, allowPositionals: true, options: {
      "trigger-kind": { type: "string" }, trigger: { type: "string" },
      "action-kind": { type: "string" }, action: { type: "string" },
    }, strict: true });
    return printJson(await client.request("/api/schedules", { method: "POST", body: JSON.stringify({
      name: required(parsed.positionals[0], "schedule name"),
      triggerKind: required(parsed.values["trigger-kind"], "--trigger-kind"),
      trigger: JSON.parse(required(parsed.values.trigger, "--trigger")),
      actionKind: required(parsed.values["action-kind"], "--action-kind"),
      action: JSON.parse(required(parsed.values.action, "--action")),
    }) }));
  }
  if (action === "enable" || action === "disable") {
    const parsed = parseArgs({ args, allowPositionals: true, options: { revision: { type: "string" } }, strict: true });
    const id = required(parsed.positionals[0], "schedule ID");
    const expectedRevision = numberOption(required(parsed.values.revision, "--revision"), "revision");
    return printJson(await client.request(`/api/schedules/${id}`, { method: "PATCH", body: JSON.stringify({ enabled: action === "enable", expectedRevision }) }));
  }
  help();
}

async function notificationCommand(args: string[]): Promise<void> {
  const action = args.shift();
  if (action === "list") {
    const parsed = parseArgs({ args, options: { all: { type: "boolean" } }, strict: true });
    return printJson(await client.request(`/api/notifications${parsed.values.all ? "?includeRead=true" : ""}`));
  }
  if (action === "read") {
    await client.request(`/api/notifications/${required(args[0], "notification ID")}/read`, { method: "POST" });
    return printJson({ ok: true });
  }
  help();
}

async function abilityCommand(args: string[]): Promise<void> {
  const action = args.shift();
  if (action === "list") return printJson(await client.request("/api/abilities"));
  if (action === "install") {
    const manifest = JSON.parse(readFileSync(required(args[0], "manifest file"), "utf8"));
    return printJson(await client.request("/api/abilities", { method: "POST", body: JSON.stringify(manifest) }));
  }
  if (action === "invoke") {
    const id = required(args.shift(), "ability ID");
    const input = args[0] ? JSON.parse(args[0]) : {};
    return printJson(await client.request(`/api/abilities/${id}/invoke`, { method: "POST", body: JSON.stringify({ input }) }));
  }
  help();
}

async function browserCommand(args: string[]): Promise<void> {
  const adapterName = args.shift();
  const action = args.shift();
  let adapter: "google_calendar" | "slack";
  let browserAction: string;
  let input: Record<string, unknown> = {};
  if (adapterName === "calendar" && action === "list") {
    const parsed = parseArgs({ args, allowPositionals: true, options: { view: { type: "string" } }, strict: true });
    adapter = "google_calendar";
    browserAction = parsed.positionals[0] ? "list_events" : "list_visible_events";
    input = parsed.positionals[0] ? { date: parsed.positionals[0], view: parsed.values.view ?? "day" } : {};
  }
  else if (adapterName === "calendar" && action === "create") { adapter = "google_calendar"; browserAction = "create_event"; input = JSON.parse(required(args[0], "event JSON")); }
  else if (adapterName === "slack" && action === "unreads") { adapter = "slack"; browserAction = "list_unreads"; }
  else if (adapterName === "slack" && action === "read") { adapter = "slack"; browserAction = "read_channel"; input = { channelName: required(args[0], "channel") }; }
  else if (adapterName === "slack" && action === "send") { adapter = "slack"; browserAction = "send_message"; input = { channelName: required(args[0], "channel"), text: required(args[1], "message") }; }
  else help();
  return printJson(await client.request("/api/browser/jobs", { method: "POST", body: JSON.stringify({ adapter, action: browserAction, input }) }));
}

async function nativeCommand(args: string[]): Promise<void> {
  const action = args.shift();
  if (action === "clipboard-image") {
    const parsed = parseArgs({ args, options: { output: { type: "string" } }, strict: true });
    const output = required(parsed.values.output, "--output");
    const payload = await client.request("/api/native/clipboard/image") as { image: { base64: string; mimeType: string } };
    writeFileSync(output, Buffer.from(payload.image.base64, "base64"));
    return printJson({ output, mimeType: payload.image.mimeType });
  }
  if (action === "notify") {
    await client.request("/api/native/notify", { method: "POST", body: JSON.stringify({ title: required(args[0], "title"), body: args[1] ?? "" }) });
    return printJson({ ok: true });
  }
  help();
}

async function main(): Promise<void> {
  const command = rawArgs.shift();
  if (!command || command === "help" || command === "--help" || command === "-h") help();
  if (command === "task") return taskCommand(rawArgs);
  if (command === "session") return sessionCommand(rawArgs);
  if (command === "claude-session") return claudeSessionCommand(rawArgs);
  if (command === "event") return eventCommand(rawArgs);
  if (command === "run") return runCommand(rawArgs);
  if (command === "approval") return approvalCommand(rawArgs);
  if (command === "memory") return memoryCommand(rawArgs);
  if (command === "schedule") return scheduleCommand(rawArgs);
  if (command === "notification") return notificationCommand(rawArgs);
  if (command === "ability") return abilityCommand(rawArgs);
  if (command === "browser") return browserCommand(rawArgs);
  if (command === "native") return nativeCommand(rawArgs);

  if (command === "status") {
    const [health, tasks, sessions, runs, approvals, schedules, notifications, memories, browser] = await Promise.all([
      client.request("/api/health"),
      client.request("/api/tasks"),
      client.request("/api/sessions"),
      client.request("/api/runs"),
      client.request("/api/approvals?status=pending"),
      client.request("/api/schedules"),
      client.request("/api/notifications"),
      client.request("/api/memories"),
      client.request("/api/browser/status"),
    ]);
    const value = {
      health,
      tasks: (tasks as { tasks: unknown[] }).tasks.length,
      sessions: (sessions as { sessions: unknown[] }).sessions.length,
      runs: (runs as { runs: unknown[] }).runs.length,
      pendingApprovals: (approvals as { approvals: unknown[] }).approvals.length,
      schedules: (schedules as { schedules: unknown[] }).schedules.length,
      notifications: (notifications as { notifications: unknown[] }).notifications.length,
      memories: (memories as { memories: unknown[] }).memories.length,
      browser,
    };
    return printJson(value);
  }

  if (command === "state" && rawArgs.shift() === "export") {
    const request = (path: string) => client.request(path);
    const [tasks, sessions, runs, approvals, schedules, notifications, memoryRecords, abilities, browserJobs, eventRecords] = await Promise.all([
      client.request("/api/tasks"),
      client.request("/api/sessions?includeEnded=true"),
      client.request("/api/runs"),
      client.request("/api/approvals"),
      client.request("/api/schedules"),
      client.request("/api/notifications?includeRead=true"),
      readAllMemories(request),
      client.request("/api/abilities"),
      client.request("/api/browser/jobs"),
      readAllEvents(request),
    ]);
    const memories = { memories: memoryRecords };
    const events = { events: eventRecords };
    return printJson({ exportedAt: new Date().toISOString(), tasks, sessions, runs, approvals, schedules, notifications, memories, abilities, browserJobs, events });
  }

  if (command === "api") {
    const method = required(rawArgs.shift(), "HTTP method").toUpperCase();
    const path = required(rawArgs.shift(), "API path");
    const bodyText = rawArgs.shift();
    const body = bodyText === undefined ? undefined : JSON.stringify(JSON.parse(bodyText));
    return printJson(await client.request(path, { method, ...(body ? { body } : {}) }));
  }

  help();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `Error: ${error.message}` : error);
  process.exitCode = 1;
});
