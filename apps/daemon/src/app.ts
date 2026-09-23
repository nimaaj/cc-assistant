import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import cookie from "@fastify/cookie";
import {
  ApprovalSchema,
  AbilityManifestSchema,
  BrowserJobRequestSchema,
  ClaudeSessionControlSchema,
  CreateMemorySchema,
  DispatcherRequestSchema,
  isMainControllerName,
  IngestMemorySchema,
  MemoryImportPlanSchema,
  MemoryMarkdownExportSchema,
  MemoryMarkdownImportRequestSchema,
  MoveWorkspaceItemSchema,
  SetWorkspaceItemLayoutSchema,
  TrashWorkspaceItemSchema,
  CreateScheduleSchema,
  CreateWorkspaceFolderSchema,
  CreateTaskSchema,
  ProposeCommandSchema,
  ResolveApprovalSchema,
  RuntimeControlSchema,
  RuntimeTranscriptSchema,
  RunStatusSchema,
  StartAgentRunSchema,
  TaskStatusSchema,
  UpdateMemorySchema,
  UpdateScheduleSchema,
  UpdateTaskSchema,
  UpdateWorkspaceFolderSchema,
} from "@cc-assistant/shared";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { z } from "zod";
import type { DaemonConfig } from "./config.js";
import {
  AssistantRepository,
  ScheduleNotFoundError,
  ScheduleRevisionConflictError,
  WorkspaceFolderNotFoundError,
  WorkspaceFolderRevisionConflictError,
} from "./assistant-repository.js";
import { AutomationService } from "./automation-service.js";
import { BrowserAutomationService, type BrowserAgentQuery } from "./browser-automation-service.js";
import { ClaudeSessionControlService } from "./claude-session-control-service.js";
import { EventHub } from "./event-hub.js";
import { ExecutionRepository } from "./execution-repository.js";
import { ExecutionInputError, ExecutionService, RunNotFoundError } from "./execution-service.js";
import { NativeService } from "./native-service.js";
import { MemoryNotFoundError, MemoryRepository, MemoryRevisionConflictError } from "./memory-repository.js";
import { parseMemoryMarkdown, serializeMemoryMarkdown, type ImportedMemory } from "./memory-markdown.js";
import { SessionRepository } from "./session-repository.js";
import { RuntimeService } from "./runtime-service.js";
import {
  RevisionConflictError,
  TaskNotFoundError,
  TaskRepository,
} from "./task-repository.js";

const SessionSchema = z.object({ token: z.string().min(1) });
const TaskParamsSchema = z.object({ id: z.uuid() });
const IdParamsSchema = z.object({ id: z.uuid() });
const EventsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const allowedHosts = new Set(["localhost", "127.0.0.1", "::1"]);

function secretsMatch(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function tokenFromAuthorization(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length);
}

function requestSource(header: string | string[] | undefined): "mcp" | "cli" | "web" {
  if (header === "mcp") return "mcp";
  if (header === "cli") return "cli";
  return "web";
}

function normalizedImportValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].sort();
}

function importedMemoryMatches(current: ReturnType<MemoryRepository["get"]>, imported: ImportedMemory): boolean {
  return current !== undefined && current.slug === imported.slug && current.title === imported.title &&
    current.body === imported.body && current.summary === imported.summary && current.kind === imported.kind &&
    JSON.stringify(current.tags) === JSON.stringify(normalizedImportValues(imported.tags)) &&
    JSON.stringify(current.aliases) === JSON.stringify(normalizedImportValues(imported.aliases)) &&
    current.project === imported.project && current.status === imported.status &&
    JSON.stringify(current.provenance) === JSON.stringify(imported.provenance);
}

function planMemoryMarkdownImport(
  memoryRepository: MemoryRepository,
  files: Array<{ path: string; content: string }>,
): { plan: ReturnType<typeof MemoryImportPlanSchema.parse>; parsed: Map<string, ImportedMemory> } {
  const parsed = new Map<string, ImportedMemory>();
  const errors = new Map<string, string>();
  const pathCounts = new Map<string, number>();
  for (const file of files) {
    pathCounts.set(file.path, (pathCounts.get(file.path) ?? 0) + 1);
    try { parsed.set(file.path, parseMemoryMarkdown(file.path, file.content)); }
    catch (error) { errors.set(file.path, error instanceof Error ? error.message : "Invalid memory Markdown"); }
  }
  const slugCounts = new Map<string, number>();
  const idCounts = new Map<string, number>();
  for (const memory of parsed.values()) {
    slugCounts.set(memory.slug, (slugCounts.get(memory.slug) ?? 0) + 1);
    if (memory.id) idCounts.set(memory.id, (idCounts.get(memory.id) ?? 0) + 1);
  }
  const entries = files.map((file) => {
    const imported = parsed.get(file.path);
    if (!imported) return { path: file.path, slug: null, action: "invalid" as const,
      reason: errors.get(file.path) ?? "Invalid memory Markdown", currentRevision: null, importedRevision: null };
    if ((pathCounts.get(file.path) ?? 0) > 1) return { path: file.path, slug: imported.slug,
      action: "invalid" as const, reason: `Duplicate import path ${file.path}`,
      currentRevision: null, importedRevision: imported.revision };
    if ((slugCounts.get(imported.slug) ?? 0) > 1 || (imported.id && (idCounts.get(imported.id) ?? 0) > 1)) {
      return { path: file.path, slug: imported.slug, action: "invalid" as const,
        reason: "Duplicate memory identity appears more than once in the import",
        currentRevision: null, importedRevision: imported.revision };
    }
    const byId = imported.id ? memoryRepository.get(imported.id) : undefined;
    const bySlug = memoryRepository.get(imported.slug);
    if (byId && bySlug && byId.id !== bySlug.id) return { path: file.path, slug: imported.slug,
      action: "conflict" as const, reason: "The exported ID and slug resolve to different memories",
      currentRevision: bySlug.revision, importedRevision: imported.revision };
    const current = byId ?? bySlug;
    if (byId && byId.slug !== imported.slug) return { path: file.path, slug: imported.slug,
      action: "conflict" as const, reason: `Memory IDs are stable; ${byId.slug} cannot be renamed to ${imported.slug}`,
      currentRevision: byId.revision, importedRevision: imported.revision };
    if (!current) return { path: file.path, slug: imported.slug, action: "create" as const,
      reason: null, currentRevision: null, importedRevision: imported.revision };
    if (importedMemoryMatches(current, imported)) return { path: file.path, slug: imported.slug,
      action: "unchanged" as const, reason: null, currentRevision: current.revision, importedRevision: imported.revision };
    if (imported.revision !== current.revision) return { path: file.path, slug: imported.slug,
      action: "conflict" as const,
      reason: `Markdown revision ${imported.revision} does not match current revision ${current.revision}`,
      currentRevision: current.revision, importedRevision: imported.revision };
    return { path: file.path, slug: imported.slug, action: "update" as const,
      reason: null, currentRevision: current.revision, importedRevision: imported.revision };
  });
  const summary = { create: 0, update: 0, unchanged: 0, conflict: 0, invalid: 0 };
  for (const entry of entries) summary[entry.action] += 1;
  return { plan: MemoryImportPlanSchema.parse({ entries, summary }), parsed };
}

export interface AppDependencies {
  config: DaemonConfig;
  repository?: TaskRepository;
  sessionRepository?: SessionRepository;
  executionRepository?: ExecutionRepository;
  executionService?: ExecutionService;
  assistantRepository?: AssistantRepository;
  automationService?: AutomationService;
  browserAutomationService?: BrowserAutomationService;
  browserAgentQuery?: BrowserAgentQuery;
  claudeSessionControlService?: ClaudeSessionControlService;
  runtimeService?: RuntimeService;
  nativeService?: NativeService;
  memoryRepository?: MemoryRepository;
  eventHub?: EventHub;
  webRoot?: string;
}

const staticContentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function isWithin(candidate: string, root: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const eventHub = dependencies.eventHub ?? new EventHub();
  const ownsRepository = dependencies.repository === undefined;
  const ownsSessionRepository = dependencies.sessionRepository === undefined;
  const ownsExecutionRepository = dependencies.executionRepository === undefined;
  const ownsAssistantRepository = dependencies.assistantRepository === undefined;
  const ownsMemoryRepository = dependencies.memoryRepository === undefined;
  const repository =
    dependencies.repository ??
    new TaskRepository(dependencies.config.databasePath, (event) => eventHub.publish(event));
  const sessionRepository =
    dependencies.sessionRepository ??
    new SessionRepository(dependencies.config.databasePath, (event) => eventHub.publish(event));
  const executionRepository =
    dependencies.executionRepository ??
    new ExecutionRepository(dependencies.config.databasePath, (event) => eventHub.publish(event));
  const executionService =
    dependencies.executionService ?? new ExecutionService(executionRepository, dependencies.config);
  const claudeSessionControlService = dependencies.claudeSessionControlService ??
    new ClaudeSessionControlService(executionService, dependencies.config);
  const runtimeService = dependencies.runtimeService ?? new RuntimeService(dependencies.config);
  const assistantRepository = dependencies.assistantRepository ??
    new AssistantRepository(dependencies.config.databasePath, (event) => eventHub.publish(event));
  const nativeService = dependencies.nativeService ?? new NativeService();
  const memoryRepository = dependencies.memoryRepository ??
    new MemoryRepository(dependencies.config.databasePath, (event) => eventHub.publish(event));
  const webRoot = resolve(dependencies.webRoot ?? resolve(import.meta.dirname, "../../web/dist"));
  const automationService = dependencies.automationService ??
    new AutomationService(assistantRepository, executionService, nativeService, dependencies.config, claudeSessionControlService);
  const browserAutomationService = dependencies.browserAutomationService ??
    new BrowserAutomationService(assistantRepository, executionRepository, dependencies.config, dependencies.browserAgentQuery);
  automationService.start();
  browserAutomationService.start();

  await app.register(cookie);

  app.addHook("onRequest", async (request, reply) => {
    const hostname = request.hostname.replace(/^\[|\]$/g, "");
    if (!allowedHosts.has(hostname)) {
      return reply.code(400).send({ error: "invalid_host", message: "Host is not allowed" });
    }

    const pathname = request.url.split("?", 1)[0] ?? request.url;
    if (!pathname.startsWith("/api/") && pathname !== "/api") return;
    if (pathname === "/api/health" || pathname === "/api/session") return;

    const candidate =
      tokenFromAuthorization(request.headers.authorization) ?? request.cookies.cc_assistant_session;
    if (!secretsMatch(candidate, dependencies.config.accessToken)) {
      return reply.code(401).send({ error: "unauthorized", message: "Authentication is required" });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof TaskNotFoundError) {
      return reply.code(404).send({ error: "task_not_found", message: error.message });
    }
    if (error instanceof RevisionConflictError) {
      return reply.code(409).send({ error: "revision_conflict", message: error.message });
    }
    if (error instanceof ScheduleNotFoundError) {
      return reply.code(404).send({ error: "schedule_not_found", message: error.message });
    }
    if (error instanceof ScheduleRevisionConflictError) {
      return reply.code(409).send({ error: "schedule_revision_conflict", message: error.message });
    }
    if (error instanceof WorkspaceFolderNotFoundError) {
      return reply.code(404).send({ error: "workspace_folder_not_found", message: error.message });
    }
    if (error instanceof WorkspaceFolderRevisionConflictError) {
      return reply.code(409).send({ error: "workspace_folder_revision_conflict", message: error.message });
    }
    if (error instanceof ExecutionInputError) {
      return reply.code(400).send({ error: "invalid_execution_request", message: error.message });
    }
    if (error instanceof RunNotFoundError) {
      return reply.code(404).send({ error: "run_not_found", message: error.message });
    }
    if (error instanceof MemoryNotFoundError) {
      return reply.code(404).send({ error: "memory_not_found", message: error.message });
    }
    if (error instanceof MemoryRevisionConflictError) {
      return reply.code(409).send({ error: "memory_revision_conflict", message: error.message });
    }
    if (error instanceof z.ZodError) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "Request validation failed",
        details: z.treeifyError(error),
      });
    }

    app.log.error(error);
    return reply.code(500).send({ error: "internal_error", message: "Unexpected server error" });
  });

  async function sendStatic(reply: FastifyReply, path: string, cache = false) {
    const candidate = resolve(webRoot, path);
    if (!isWithin(candidate, webRoot)) {
      return reply.code(404).send({ error: "asset_not_found", message: "Asset was not found" });
    }
    try {
      const body = await readFile(candidate);
      reply.type(staticContentTypes.get(extname(candidate).toLowerCase()) ?? "application/octet-stream");
      reply.header("Cache-Control", cache ? "public, max-age=31536000, immutable" : "no-cache");
      return reply.send(body);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return reply.code(404).send({ error: "asset_not_found", message: "Asset was not found" });
      }
      throw error;
    }
  }

  app.get("/", async (_request, reply) => sendStatic(reply, "index.html"));
  app.get("/assets/*", async (request, reply) => {
    const path = z.object({ "*": z.string().min(1) }).parse(request.params)["*"];
    return sendStatic(reply, join("assets", path), true);
  });

  app.get("/api/health", async () => ({
    ok: true as const,
    version: "0.1.0",
    now: new Date().toISOString(),
  }));

  app.get("/api/config", async () => ({
    platform: process.platform,
    allowedRoots: dependencies.config.allowedRoots,
    dataDir: dependencies.config.dataDir,
  }));

  app.get("/api/runtime/config", async () => ({
    recipe: await runtimeService.recipe(),
    daemon: {
      platform: process.platform,
      host: dependencies.config.host,
      port: dependencies.config.port,
      allowedRoots: dependencies.config.allowedRoots,
      dataDir: dependencies.config.dataDir,
      browser: dependencies.config.browser,
      managedAgent: dependencies.config.managedAgent,
    },
  }));

  app.put("/api/runtime/config", async (request) => ({ recipe: await runtimeService.saveRecipe(request.body) }));

  app.get("/api/runtime/status", async () => {
    let controller = null;
    try {
      controller = (await claudeSessionControlService.list(false))
        .filter((session) => session.pid && isMainControllerName(session.name))
        .sort((left, right) => right.startedAt - left.startedAt)[0] ?? null;
    } catch { /* Runtime health remains useful when Claude Code inventory is unavailable. */ }
    return runtimeService.status(controller);
  });

  app.post("/api/runtime/control", async (request, reply) => {
    const input = RuntimeControlSchema.parse(request.body);
    const target = input.action === "open_session_terminal"
      ? await claudeSessionControlService.get(input.target)
      : undefined;
    const proposed = await runtimeService.propose(executionService, input, target);
    return reply.code(202).send(proposed);
  });

  app.post("/api/session", async (request, reply) => {
    const { token } = SessionSchema.parse(request.body);
    if (!secretsMatch(token, dependencies.config.accessToken)) {
      return reply.code(401).send({ error: "unauthorized", message: "Invalid access token" });
    }

    reply.setCookie("cc_assistant_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: false,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return reply.code(204).send();
  });

  app.delete("/api/session", async (_request, reply) => {
    reply.clearCookie("cc_assistant_session", { path: "/" });
    return reply.code(204).send();
  });

  app.get("/api/tasks", async (request) => {
    const query = z.object({ status: TaskStatusSchema.optional() }).parse(request.query);
    return { tasks: repository.list(query.status) };
  });

  app.get("/api/tasks/:id", async (request, reply) => {
    const { id } = TaskParamsSchema.parse(request.params);
    const task = repository.get(id);
    if (!task) {
      return reply.code(404).send({ error: "task_not_found", message: `Task ${id} was not found` });
    }
    return { task };
  });

  app.post("/api/tasks", async (request, reply) => {
    const input = CreateTaskSchema.parse(request.body);
    const task = repository.create(input, requestSource(request.headers["x-cc-assistant-source"]));
    return reply.code(201).send({ task });
  });

  app.patch("/api/tasks/:id", async (request) => {
    const { id } = TaskParamsSchema.parse(request.params);
    const input = UpdateTaskSchema.parse(request.body);
    return {
      task: repository.update(
        id,
        input,
        requestSource(request.headers["x-cc-assistant-source"]),
      ),
    };
  });

  app.get("/api/events", async (request) => {
    const query = EventsQuerySchema.parse(request.query);
    return { events: repository.listEvents(query.after, query.limit) };
  });

  app.get("/api/sessions", async (request) => {
    const query = z
      .object({ includeEnded: z.stringbool().default(false) })
      .parse(request.query);
    return { sessions: sessionRepository.list(query.includeEnded) };
  });

  app.get("/api/sessions/:id", async (request, reply) => {
    const id = z.object({ id: z.string().min(1) }).parse(request.params).id;
    const session = sessionRepository.get(id);
    if (!session) {
      return reply
        .code(404)
        .send({ error: "session_not_found", message: `Session ${id} was not found` });
    }
    return { session };
  });

  app.post("/api/hooks/claude", async (request) => {
    const session = sessionRepository.ingest(request.body);
    return { accepted: true, session };
  });

  app.get("/api/claude/sessions", async (request) => {
    const query = z.object({ includeCompleted: z.stringbool().default(true) }).parse(request.query);
    return { sessions: await claudeSessionControlService.list(query.includeCompleted) };
  });

  app.get("/api/claude/sessions/:reference", async (request) => {
    const reference = z.object({ reference: z.string().min(1) }).parse(request.params).reference;
    return { session: await claudeSessionControlService.get(reference) };
  });

  app.get("/api/claude/sessions/:reference/logs", async (request) => {
    const reference = z.object({ reference: z.string().min(1) }).parse(request.params).reference;
    return { logs: await claudeSessionControlService.logs(reference) };
  });

  app.get("/api/claude/sessions/:reference/transcript", async (request) => {
    const reference = z.object({ reference: z.string().min(1) }).parse(request.params).reference;
    const session = await claudeSessionControlService.get(reference);
    const source = session.kind === "background" && session.id ? "claude_logs" as const : "tmux" as const;
    try {
      if (source === "claude_logs") {
        return RuntimeTranscriptSchema.parse({
          reference, source, available: true, content: await claudeSessionControlService.logs(reference), error: null,
          capturedAt: new Date().toISOString(),
        });
      }
      return runtimeService.capturePane(reference, session);
    } catch (error) {
      return RuntimeTranscriptSchema.parse({
        reference, source, available: false, content: "",
        error: error instanceof Error ? error.message : "Transcript source is unavailable",
        capturedAt: new Date().toISOString(),
      });
    }
  });

  app.post("/api/claude/sessions/control", async (request, reply) => {
    const proposed = await claudeSessionControlService.propose(ClaudeSessionControlSchema.parse(request.body));
    return reply.code(202).send(proposed);
  });

  app.post("/api/dispatcher", async (request, reply) => {
    const body = z.object({
      input: z.string(),
      target: z.string().optional(),
      context: z.record(z.string(), z.unknown()).optional(),
    }).strict().parse(request.body);
    const input = DispatcherRequestSchema.parse({
      ...body,
      source: "web",
      context: body.context ?? {},
    });
    const proposed = await claudeSessionControlService.proposeDispatcher(input);
    return reply.code(202).send(proposed);
  });

  app.get("/api/runs", async (request) => {
    const query = z.object({ status: RunStatusSchema.optional() }).parse(request.query);
    return { runs: executionRepository.listRuns(query.status) };
  });

  app.get("/api/runs/:id", async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const run = executionRepository.getRun(id);
    if (!run) return reply.code(404).send({ error: "run_not_found", message: `Run ${id} was not found` });
    return { run };
  });

  app.get("/api/runs/:id/logs", async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    if (!executionRepository.getRun(id)) {
      return reply.code(404).send({ error: "run_not_found", message: `Run ${id} was not found` });
    }
    const query = z
      .object({
        after: z.coerce.number().int().min(-1).default(-1),
        limit: z.coerce.number().int().min(1).max(2_000).default(500),
      })
      .parse(request.query);
    return { logs: executionRepository.listLogs(id, query.after, query.limit) };
  });

  app.post("/api/runs/agent", async (request, reply) => {
    const run = executionService.startAgent(StartAgentRunSchema.parse(request.body));
    return reply.code(202).send({ run });
  });

  app.post("/api/runs/command", async (request, reply) => {
    const proposed = executionService.proposeCommand(ProposeCommandSchema.parse(request.body));
    return reply.code(202).send(proposed);
  });

  app.post("/api/runs/:id/cancel", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    browserAutomationService.cancelByRunId(id);
    const run = executionService.cancel(id);
    return { run };
  });

  app.get("/api/approvals", async (request) => {
    const query = z.object({ status: ApprovalSchema.shape.status.optional() }).parse(request.query);
    return { approvals: executionRepository.listApprovals(query.status) };
  });

  app.post("/api/approvals/:id/resolve", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const resolution = ResolveApprovalSchema.parse(request.body);
    const pending = executionRepository.getApproval(id);
    const approval = executionService.resolveApproval(id, resolution);
    if (pending?.actionType === "browser_action" && resolution.decision === "approved") {
      const adapter = z.enum(["google_calendar", "slack"]).parse(pending.payload.adapter);
      const action = z.string().min(1).parse(pending.payload.action);
      const input = z.record(z.string(), z.unknown()).parse(pending.payload.input);
      const job = assistantRepository.createBrowserJob(adapter, action, input, pending.runId);
      executionService.updateExternalRun(pending.runId, {
        status: "running",
        metadata: { ...(executionRepository.getRun(pending.runId)?.metadata ?? {}), browserJobId: job.id },
      });
      browserAutomationService.submit(job.id);
    }
    return { approval };
  });

  app.get("/api/schedules", async () => ({ schedules: assistantRepository.listSchedules() }));

  app.get("/api/schedules/:id", async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const schedule = assistantRepository.getSchedule(id);
    if (!schedule) return reply.code(404).send({ error: "schedule_not_found", message: `Schedule ${id} was not found` });
    return { schedule };
  });

  app.post("/api/schedules", async (request, reply) => {
    const schedule = assistantRepository.createSchedule(CreateScheduleSchema.parse(request.body));
    return reply.code(201).send({ schedule });
  });

  app.patch("/api/schedules/:id", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    return { schedule: assistantRepository.updateSchedule(id, UpdateScheduleSchema.parse(request.body)) };
  });

  app.get("/api/notifications", async (request) => {
    const query = z.object({ includeRead: z.stringbool().default(false) }).parse(request.query);
    return { notifications: assistantRepository.listNotifications(query.includeRead) };
  });

  app.post("/api/notifications/:id/read", async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    assistantRepository.markNotificationRead(id);
    return reply.code(204).send();
  });

  app.get("/api/workspace/folders", async () => ({ folders: assistantRepository.listWorkspaceFolders() }));

  app.post("/api/workspace/folders", async (request, reply) => {
    const folder = assistantRepository.createWorkspaceFolder(CreateWorkspaceFolderSchema.parse(request.body));
    return reply.code(201).send({ folder });
  });

  app.patch("/api/workspace/folders/:id", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    return { folder: assistantRepository.updateWorkspaceFolder(id, UpdateWorkspaceFolderSchema.parse(request.body)) };
  });

  app.delete("/api/workspace/folders/:id", async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    assistantRepository.deleteWorkspaceFolder(id);
    return reply.code(204).send();
  });

  app.get("/api/workspace/placements", async () => ({
    placements: assistantRepository.listWorkspaceItemPlacements(),
  }));

  app.put("/api/workspace/placements", async (request) => ({
    placement: assistantRepository.moveWorkspaceItem(MoveWorkspaceItemSchema.parse(request.body)),
  }));

  app.get("/api/workspace/layouts", async () => ({
    layouts: assistantRepository.listWorkspaceItemLayouts(),
  }));

  app.put("/api/workspace/layouts", async (request) => ({
    layout: assistantRepository.setWorkspaceItemLayout(SetWorkspaceItemLayoutSchema.parse(request.body)),
  }));

  app.delete("/api/workspace/layouts", async (_request, reply) => {
    assistantRepository.clearWorkspaceItemLayouts();
    return reply.code(204).send();
  });

  app.get("/api/workspace/trash", async () => ({
    items: assistantRepository.listWorkspaceTrashedItems(),
  }));

  app.put("/api/workspace/trash", async (request) => ({
    item: assistantRepository.trashWorkspaceItem(TrashWorkspaceItemSchema.parse(request.body)),
  }));

  app.post("/api/workspace/trash/restore", async (request, reply) => {
    assistantRepository.restoreWorkspaceItem(TrashWorkspaceItemSchema.parse(request.body));
    return reply.code(204).send();
  });

  app.post("/api/triggers/system-notification", async (request) => {
    const input = z.object({ app: z.string().optional(), title: z.string().optional(), body: z.string().optional() }).parse(request.body);
    return { matched: await automationService.ingestSystemNotification(input) };
  });

  app.get("/api/memories/tags", async (request) => {
    const query = z.object({ includeArchived: z.stringbool().default(false) }).parse(request.query);
    return { tags: memoryRepository.listTags(query.includeArchived) };
  });

  app.get("/api/memories/export", async (request) => {
    const query = z.object({ includeArchived: z.stringbool().default(false) }).parse(request.query);
    return MemoryMarkdownExportSchema.parse({
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      files: memoryRepository.exportAll(query.includeArchived).map((memory) => ({
        path: `memories/${memory.slug}.md`, content: serializeMemoryMarkdown(memory),
      })),
    });
  });

  app.post("/api/memories/import/preview", { bodyLimit: 100 * 1024 * 1024 }, async (request) => {
    const input = MemoryMarkdownImportRequestSchema.parse(request.body);
    return planMemoryMarkdownImport(memoryRepository, input.files).plan;
  });

  app.post("/api/memories/import", { bodyLimit: 100 * 1024 * 1024 }, async (request, reply) => {
    const input = MemoryMarkdownImportRequestSchema.parse(request.body);
    const { plan, parsed } = planMemoryMarkdownImport(memoryRepository, input.files);
    if (plan.summary.conflict > 0 || plan.summary.invalid > 0) {
      return reply.code(409).send({ error: "memory_import_blocked",
        message: "Resolve invalid files and revision conflicts before applying this import", plan });
    }
    const source = requestSource(request.headers["x-cc-assistant-source"]);
    const memories = [];
    for (const entry of plan.entries) {
      if (entry.action === "unchanged") continue;
      const imported = parsed.get(entry.path);
      if (!imported) continue;
      if (entry.action === "create") {
        let memory = memoryRepository.ingest({
          slug: imported.slug, title: imported.title, body: imported.body, summary: imported.summary,
          kind: imported.kind, tags: imported.tags, aliases: imported.aliases, project: imported.project,
          sourceType: imported.provenance.sourceType, sourceUri: imported.provenance.sourceUri,
          sourceRef: imported.provenance.sourceRef, capturedAt: imported.provenance.capturedAt,
        }, source);
        if (imported.status === "archived") memory = memoryRepository.archive(memory.id, memory.revision, source);
        memories.push(memory);
      } else if (entry.action === "update") {
        memories.push(memoryRepository.update(imported.slug, {
          title: imported.title, body: imported.body, summary: imported.summary, kind: imported.kind,
          tags: imported.tags, aliases: imported.aliases, project: imported.project, status: imported.status,
          sourceType: imported.provenance.sourceType, sourceUri: imported.provenance.sourceUri,
          sourceRef: imported.provenance.sourceRef, capturedAt: imported.provenance.capturedAt,
          expectedRevision: imported.revision,
        }, source));
      }
    }
    return { plan, memories };
  });

  app.get("/api/memories", async (request) => {
    const query = z.object({ status: z.enum(["active", "archived"]).optional(), kind: z.string().optional(),
      project: z.string().optional(), tag: z.string().optional(), includeArchived: z.stringbool().default(false),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    return { memories: memoryRepository.list(query) };
  });

  app.get("/api/memories/search", async (request) => {
    const query = z.object({ q: z.string().default(""), status: z.enum(["active", "archived"]).optional(),
      kind: z.string().optional(), project: z.string().optional(), tag: z.string().optional(),
      includeArchived: z.stringbool().default(false), limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(request.query);
    return { query: query.q, hits: memoryRepository.search(query.q, query) };
  });

  app.post("/api/memories/recall", async (request) => {
    const body = z.object({ query: z.string(), status: z.enum(["active", "archived"]).optional(),
      kind: z.string().optional(), project: z.string().optional(), tag: z.string().optional(),
      includeArchived: z.boolean().default(false), limit: z.number().int().min(1).max(20).default(5),
      characterLimit: z.number().int().min(500).max(100_000).default(12_000),
      expandLinks: z.boolean().default(true) }).parse(request.body);
    return memoryRepository.recall(body.query, body);
  });

  app.get("/api/memories/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const memory = memoryRepository.get(id);
    if (!memory) return reply.code(404).send({ error: "memory_not_found", message: `Memory ${id} was not found` });
    return { memory };
  });

  app.post("/api/memories", async (request, reply) => {
    const memory = memoryRepository.create(CreateMemorySchema.parse(request.body), requestSource(request.headers["x-cc-assistant-source"]));
    return reply.code(201).send({ memory });
  });

  app.post("/api/memories/ingest", async (request, reply) => {
    const memory = memoryRepository.ingest(IngestMemorySchema.parse(request.body), requestSource(request.headers["x-cc-assistant-source"]));
    return reply.code(201).send({ memory });
  });

  app.patch("/api/memories/:id", async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    return { memory: memoryRepository.update(id, UpdateMemorySchema.parse(request.body), requestSource(request.headers["x-cc-assistant-source"])) };
  });

  app.post("/api/memories/:id/archive", async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({ expectedRevision: z.number().int().positive() }).parse(request.body);
    return { memory: memoryRepository.archive(id, body.expectedRevision, requestSource(request.headers["x-cc-assistant-source"])) };
  });

  app.get("/api/memories/:id/revisions", async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    return { revisions: memoryRepository.revisions(id) };
  });

  app.get("/api/memories/:id/links", async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    return memoryRepository.links(id);
  });

  app.get("/api/abilities", async () => ({ abilities: assistantRepository.listAbilities() }));

  app.post("/api/abilities", async (request, reply) => {
    const ability = assistantRepository.installAbility(AbilityManifestSchema.parse(request.body));
    return reply.code(201).send({ ability });
  });

  app.post("/api/abilities/:id/invoke", async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({ input: z.record(z.string(), z.unknown()).default({}), taskId: z.uuid().nullable().optional() }).parse(request.body);
    return reply.code(202).send(automationService.invokeAbility(id, body.input, body.taskId));
  });

  app.get("/api/native/clipboard/image", async () => {
    const image = await nativeService.readClipboardImage();
    return { image: { ...image, dataUrl: `data:${image.mimeType};base64,${image.base64}` } };
  });

  app.post("/api/native/notify", async (request, reply) => {
    const body = z.object({ title: z.string().min(1), body: z.string().default("") }).parse(request.body);
    await nativeService.notify(body.title, body.body);
    return reply.code(204).send();
  });

  app.post("/api/browser/jobs", async (request, reply) => {
    const body = BrowserJobRequestSchema.parse(request.body);
    const readActions = new Set(["list_visible_events", "list_events", "list_unreads", "read_channel"]);
    if (!readActions.has(body.action)) {
      return reply.code(202).send(executionService.proposeBrowser(body.adapter, body.action, body.input));
    }
    const job = assistantRepository.createBrowserJob(body.adapter, body.action, body.input);
    browserAutomationService.submit(job.id);
    return reply.code(202).send({ job });
  });

  app.get("/api/browser/status", async () => browserAutomationService.status());

  app.get("/api/browser/jobs", async (request) => {
    const query = z.object({ status: z.enum(["queued", "claimed", "succeeded", "failed", "cancelled"]).optional() }).parse(request.query);
    return { jobs: assistantRepository.listBrowserJobs(query.status) };
  });

  app.get("/api/browser/jobs/:id", async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const job = assistantRepository.getBrowserJob(id);
    if (!job) return reply.code(404).send({ error: "browser_job_not_found", message: `Browser job ${id} was not found` });
    return { job };
  });

  app.get("/api/events/stream", async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const unsubscribe = eventHub.subscribe(reply.raw);
    request.raw.once("close", unsubscribe);
  });

  app.addHook("onClose", async () => {
    await browserAutomationService.shutdown();
    automationService.stop();
    executionService.shutdown();
    if (ownsRepository) repository.close();
    if (ownsSessionRepository) sessionRepository.close();
    if (ownsExecutionRepository) executionRepository.close();
    if (ownsAssistantRepository) assistantRepository.close();
    if (ownsMemoryRepository) memoryRepository.close();
  });

  return app;
}
