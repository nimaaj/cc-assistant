import { z } from "zod";

export const taskStatuses = [
  "inbox",
  "planned",
  "active",
  "blocked",
  "done",
  "cancelled",
] as const;

export const TaskStatusSchema = z.enum(taskStatuses);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  description: z.string(),
  project: z.string().nullable(),
  status: TaskStatusSchema,
  priority: z.number().int().min(0).max(4),
  dueAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  revision: z.number().int().positive(),
});
export type Task = z.infer<typeof TaskSchema>;

export const CreateTaskSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(20_000).default(""),
  project: z.string().trim().min(1).max(160).nullable().optional(),
  status: TaskStatusSchema.default("inbox"),
  priority: z.number().int().min(0).max(4).default(2),
  dueAt: z.iso.datetime().nullable().optional(),
});
export type CreateTaskInput = z.input<typeof CreateTaskSchema>;

export const UpdateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    description: z.string().trim().max(20_000).optional(),
    project: z.string().trim().min(1).max(160).nullable().optional(),
    status: TaskStatusSchema.optional(),
    priority: z.number().int().min(0).max(4).optional(),
    dueAt: z.iso.datetime().nullable().optional(),
    expectedRevision: z.number().int().positive().optional(),
  })
  .refine(
    (value) => Object.keys(value).some((key) => key !== "expectedRevision"),
    "At least one task field must be supplied",
  );
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

export const TaskListSchema = z.object({
  tasks: z.array(TaskSchema),
});

export const AssistantEventSchema = z.object({
  id: z.number().int().positive(),
  type: z.string().min(1),
  source: z.string().min(1),
  occurredAt: z.iso.datetime(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
});
export type AssistantEvent = z.infer<typeof AssistantEventSchema>;

export const ApiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const HealthSchema = z.object({
  ok: z.literal(true),
  version: z.string(),
  now: z.iso.datetime(),
});

export const sessionStatuses = ["working", "waiting", "idle", "ended", "error"] as const;
export const SessionStatusSchema = z.enum(sessionStatuses);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const ClaudeSessionSchema = z.object({
  id: z.string().min(1),
  cwd: z.string().min(1),
  transcriptPath: z.string().nullable(),
  model: z.string().nullable(),
  agentType: z.string().nullable(),
  permissionMode: z.string().nullable(),
  status: SessionStatusSchema,
  lastEvent: z.string().min(1),
  startedAt: z.iso.datetime(),
  lastEventAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
});
export type ClaudeSession = z.infer<typeof ClaudeSessionSchema>;

export const ClaudeSessionListSchema = z.object({
  sessions: z.array(ClaudeSessionSchema),
});

export const ClaudeAgentSessionSchema = z.object({
  id: z.string().min(1).nullable(),
  sessionId: z.string().min(1).nullable(),
  name: z.string().min(1).nullable(),
  cwd: z.string().min(1),
  kind: z.enum(["interactive", "background"]),
  startedAt: z.number().int().nonnegative(),
  state: z.enum(["working", "blocked", "done", "failed", "stopped"]).nullable(),
  pid: z.number().int().positive().nullable(),
  status: z.enum(["busy", "waiting", "idle"]).nullable(),
  waitingFor: z.string().min(1).nullable(),
});
export type ClaudeAgentSession = z.infer<typeof ClaudeAgentSessionSchema>;
export const ClaudeAgentSessionListSchema = z.object({ sessions: z.array(ClaudeAgentSessionSchema) });

const ClaudeSessionTargetSchema = z.string().trim().min(1).max(240);
export const ClaudePermissionModeSchema = z.enum(["manual", "auto", "bypassPermissions"]);
export type ClaudePermissionMode = z.infer<typeof ClaudePermissionModeSchema>;
export const ClaudeSessionControlSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("message"),
    target: ClaudeSessionTargetSchema,
    message: z.string().trim().min(1).max(100_000),
  }).strict(),
  z.object({
    action: z.literal("continue"),
    target: ClaudeSessionTargetSchema,
    prompt: z.string().trim().min(1).max(100_000),
  }).strict(),
  z.object({
    action: z.enum(["stop", "respawn", "remove"]),
    target: ClaudeSessionTargetSchema,
  }).strict(),
  z.object({
    action: z.literal("dispatch"),
    cwd: z.string().min(1),
    prompt: z.string().trim().min(1).max(100_000),
    name: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/).optional(),
    model: z.string().trim().min(1).max(120).optional(),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    permissionMode: ClaudePermissionModeSchema.default("manual"),
  }).strict(),
]);
export type ClaudeSessionControlInput = z.input<typeof ClaudeSessionControlSchema>;

export const DispatcherSourceSchema = z.enum(["web", "schedule", "system_notification", "api"]);
export type DispatcherSource = z.infer<typeof DispatcherSourceSchema>;
export const DispatcherRequestSchema = z.object({
  input: z.string().trim().min(1).max(100_000),
  target: ClaudeSessionTargetSchema.optional(),
  source: DispatcherSourceSchema.default("web"),
  context: z.record(z.string(), z.unknown()).default({}),
}).strict();
export type DispatcherRequest = z.input<typeof DispatcherRequestSchema>;

export const ClaudeHookInputSchema = z
  .object({
    session_id: z.string().min(1),
    transcript_path: z.string().optional(),
    cwd: z.string().min(1),
    hook_event_name: z.string().min(1),
    model: z.string().optional(),
    agent_type: z.string().optional(),
    permission_mode: z.string().optional(),
    source: z.string().optional(),
    reason: z.string().optional(),
    notification_type: z.string().optional(),
    tool_name: z.string().optional(),
  })
  .loose();
export type ClaudeHookInput = z.infer<typeof ClaudeHookInputSchema>;

export const runKinds = ["agent", "command", "browser"] as const;
export const RunKindSchema = z.enum(runKinds);
export type RunKind = z.infer<typeof RunKindSchema>;

export const runStatuses = [
  "queued",
  "running",
  "waiting_approval",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export const RunStatusSchema = z.enum(runStatuses);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid().nullable(),
  kind: RunKindSchema,
  status: RunStatusSchema,
  title: z.string().min(1),
  prompt: z.string().nullable(),
  cwd: z.string().min(1),
  sessionId: z.string().nullable(),
  result: z.string().nullable(),
  error: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  revision: z.number().int().positive(),
});
export type Run = z.infer<typeof RunSchema>;

export const RunListSchema = z.object({ runs: z.array(RunSchema) });

export const RunLogSchema = z.object({
  id: z.number().int().positive(),
  runId: z.uuid(),
  sequence: z.number().int().nonnegative(),
  level: z.enum(["debug", "info", "warning", "error"]),
  message: z.string(),
  data: z.unknown().nullable(),
  occurredAt: z.iso.datetime(),
});
export type RunLog = z.infer<typeof RunLogSchema>;

export const ApprovalSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  actionType: z.string().min(1),
  summary: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  status: z.enum(["pending", "approved", "denied", "expired"]),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  resolutionNote: z.string().nullable(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const ApprovalListSchema = z.object({ approvals: z.array(ApprovalSchema) });

export const StartAgentRunSchema = z.object({
  taskId: z.uuid().nullable().optional(),
  title: z.string().trim().min(1).max(240),
  prompt: z.string().trim().min(1).max(100_000),
  cwd: z.string().min(1),
  model: z.string().min(1).optional(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
  maxTurns: z.number().int().min(1).max(200).default(50),
  maxBudgetUsd: z.number().positive().max(1_000).default(2),
  useWorktree: z.boolean().default(false),
});
export type StartAgentRunInput = z.input<typeof StartAgentRunSchema>;

export const ProposeCommandSchema = z.object({
  taskId: z.uuid().nullable().optional(),
  title: z.string().trim().min(1).max(240),
  executable: z.string().min(1),
  args: z.array(z.string()).max(200).default([]),
  cwd: z.string().min(1),
  timeoutMs: z.number().int().min(100).max(3_600_000).default(120_000),
  env: z.record(z.string(), z.string()).default({}),
});
export type ProposeCommandInput = z.input<typeof ProposeCommandSchema>;

export const ResolveApprovalSchema = z.object({
  decision: z.enum(["approved", "denied"]),
  note: z.string().trim().max(2_000).nullable().optional(),
});
export type ResolveApprovalInput = z.infer<typeof ResolveApprovalSchema>;

export const scheduleTriggerKinds = ["at", "interval", "system_notification"] as const;
export const ScheduleTriggerKindSchema = z.enum(scheduleTriggerKinds);
export type ScheduleTriggerKind = z.infer<typeof ScheduleTriggerKindSchema>;
export const scheduleActionKinds = ["reminder", "agent", "command", "ability", "dispatcher"] as const;
export const ScheduleActionKindSchema = z.enum(scheduleActionKinds);
export type ScheduleActionKind = z.infer<typeof ScheduleActionKindSchema>;

const AtTriggerSchema = z.object({ at: z.iso.datetime() }).strict();
const IntervalTriggerSchema = z.object({
  everyMs: z.number().int().min(1_000).max(31_536_000_000),
  startAt: z.iso.datetime().optional(),
}).strict();
const SystemNotificationTriggerSchema = z.object({
  app: z.string().trim().min(1).max(240).optional(),
  title: z.string().trim().min(1).max(1_000).optional(),
  body: z.string().trim().min(1).max(4_000).optional(),
  cooldownMs: z.number().int().min(1_000).max(31_536_000_000).default(60_000),
}).strict().refine((value) => value.app !== undefined || value.title !== undefined || value.body !== undefined, {
  message: "A system notification trigger requires an app, title, or body filter",
});
const ReminderActionSchema = z.object({
  title: z.string().trim().min(1).max(240),
  body: z.string().max(20_000).default(""),
}).strict();
const AbilityActionSchema = z.object({
  abilityId: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  input: z.record(z.string(), z.unknown()).default({}),
  taskId: z.uuid().optional(),
}).strict();
const DispatcherActionSchema = z.object({
  request: z.string().trim().min(1).max(100_000),
  target: ClaudeSessionTargetSchema.optional(),
}).strict();

function addNestedValidationIssue(
  result: z.ZodSafeParseResult<unknown>,
  path: "trigger" | "action",
  context: z.core.$RefinementCtx<unknown>,
): void {
  if (result.success) return;
  context.addIssue({
    code: "custom",
    path: [path, ...(result.error.issues[0]?.path ?? [])],
    message: result.error.issues[0]?.message ?? `Invalid schedule ${path}`,
  });
}

function validateScheduleConfiguration(
  value: { triggerKind: z.infer<typeof ScheduleTriggerKindSchema>; trigger: Record<string, unknown>; actionKind: z.infer<typeof ScheduleActionKindSchema>; action: Record<string, unknown> },
  context: z.core.$RefinementCtx<unknown>,
): void {
  const triggerSchema = value.triggerKind === "at" ? AtTriggerSchema :
    value.triggerKind === "interval" ? IntervalTriggerSchema : SystemNotificationTriggerSchema;
  const actionSchema = value.actionKind === "reminder" ? ReminderActionSchema :
    value.actionKind === "agent" ? StartAgentRunSchema :
    value.actionKind === "command" ? ProposeCommandSchema :
    value.actionKind === "ability" ? AbilityActionSchema : DispatcherActionSchema;
  addNestedValidationIssue(triggerSchema.safeParse(value.trigger), "trigger", context);
  addNestedValidationIssue(actionSchema.safeParse(value.action), "action", context);
}

export const ScheduleSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  enabled: z.boolean(),
  triggerKind: ScheduleTriggerKindSchema,
  trigger: z.record(z.string(), z.unknown()),
  actionKind: ScheduleActionKindSchema,
  action: z.record(z.string(), z.unknown()),
  nextRunAt: z.iso.datetime().nullable(),
  lastRunAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  revision: z.number().int().positive(),
});
export type Schedule = z.infer<typeof ScheduleSchema>;
export const ScheduleListSchema = z.object({ schedules: z.array(ScheduleSchema) });

export const CreateScheduleSchema = z.object({
  name: z.string().trim().min(1).max(240),
  enabled: z.boolean().default(true),
  triggerKind: ScheduleTriggerKindSchema,
  trigger: z.record(z.string(), z.unknown()),
  actionKind: ScheduleActionKindSchema,
  action: z.record(z.string(), z.unknown()),
}).superRefine(validateScheduleConfiguration);
export type CreateScheduleInput = z.input<typeof CreateScheduleSchema>;

export const UpdateScheduleSchema = z.object({
  name: z.string().trim().min(1).max(240).optional(),
  enabled: z.boolean().optional(),
  triggerKind: ScheduleTriggerKindSchema.optional(),
  trigger: z.record(z.string(), z.unknown()).optional(),
  actionKind: ScheduleActionKindSchema.optional(),
  action: z.record(z.string(), z.unknown()).optional(),
  expectedRevision: z.number().int().positive(),
}).refine((value) => Object.keys(value).some((key) => key !== "expectedRevision"), {
  message: "At least one schedule field must be supplied",
});
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleSchema>;

export const AssistantNotificationSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  body: z.string(),
  source: z.string().min(1),
  read: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type AssistantNotification = z.infer<typeof AssistantNotificationSchema>;
export const AssistantNotificationListSchema = z.object({
  notifications: z.array(AssistantNotificationSchema),
});

export const memoryStatuses = ["active", "archived"] as const;
export const MemoryStatusSchema = z.enum(memoryStatuses);
export const MemoryProvenanceSchema = z.object({
  sourceType: z.string().min(1).max(80),
  sourceUri: z.string().max(2_000).nullable(),
  sourceRef: z.string().max(500).nullable().default(null),
  capturedAt: z.iso.datetime(),
});
export type MemoryProvenance = z.infer<typeof MemoryProvenanceSchema>;

export const MemoryRecordSchema = z.object({
  id: z.uuid(),
  slug: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  summary: z.string().nullable(),
  kind: z.string().min(1),
  tags: z.array(z.string()),
  aliases: z.array(z.string()),
  project: z.string().nullable(),
  status: MemoryStatusSchema,
  provenance: MemoryProvenanceSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  revision: z.number().int().positive(),
});
export const MemorySchema = MemoryRecordSchema;
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;
export type Memory = MemoryRecord;
export const MemorySummarySchema = MemoryRecordSchema.omit({ body: true });
export type MemorySummary = z.infer<typeof MemorySummarySchema>;
export const MemoryListSchema = z.object({ memories: z.array(MemoryRecordSchema) });

export const MemoryMetadataInputSchema = z.object({
  summary: z.string().trim().max(2_000).nullable().optional(),
  kind: z.string().trim().regex(/^[a-z][a-z0-9_-]{0,63}$/).default("note"),
  tags: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  aliases: z.array(z.string().trim().min(1).max(160)).max(50).default([]),
  project: z.string().trim().min(1).max(160).nullable().optional(),
  sourceType: z.string().trim().min(1).max(80).default("manual"),
  sourceUri: z.string().trim().max(2_000).nullable().optional(),
  sourceRef: z.string().trim().max(500).nullable().optional(),
  capturedAt: z.iso.datetime().optional(),
});
export const CreateMemorySchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(160).optional(),
  title: z.string().trim().min(1).max(240),
  body: z.string().max(200_000),
}).extend(MemoryMetadataInputSchema.shape);
export type CreateMemoryInput = z.input<typeof CreateMemorySchema>;
export const IngestMemorySchema = CreateMemorySchema.extend({
  sourceType: z.string().trim().min(1).max(80).default("ingest"),
});
export type IngestMemoryInput = z.input<typeof IngestMemorySchema>;
export const UpdateMemorySchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  body: z.string().max(200_000).optional(),
  summary: z.string().trim().max(2_000).nullable().optional(),
  kind: z.string().trim().regex(/^[a-z][a-z0-9_-]{0,63}$/).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  aliases: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
  project: z.string().trim().min(1).max(160).nullable().optional(),
  status: MemoryStatusSchema.optional(),
  sourceType: z.string().trim().min(1).max(80).optional(),
  sourceUri: z.string().trim().max(2_000).nullable().optional(),
  sourceRef: z.string().trim().max(500).nullable().optional(),
  capturedAt: z.iso.datetime().optional(),
  expectedRevision: z.number().int().positive(),
}).refine((value) => Object.keys(value).some((key) => key !== "expectedRevision"), "At least one memory field must be supplied");
export type UpdateMemoryInput = z.infer<typeof UpdateMemorySchema>;

export const MemoryLinkSchema = z.object({
  slug: z.string(),
  label: z.string().nullable(),
  resolved: z.boolean(),
  recordId: z.uuid().nullable(),
  title: z.string().nullable(),
});
export type MemoryLink = z.infer<typeof MemoryLinkSchema>;
export const MemoryLinksSchema = z.object({
  outgoing: z.array(MemoryLinkSchema),
  backlinks: z.array(MemoryLinkSchema),
});

export const MemoryRevisionSchema = z.object({
  id: z.number().int().positive(),
  memoryId: z.uuid(),
  revision: z.number().int().positive(),
  snapshot: MemoryRecordSchema,
  changedAt: z.iso.datetime(),
  source: z.string().min(1),
});
export type MemoryRevision = z.infer<typeof MemoryRevisionSchema>;

export const MemorySearchHitSchema = z.object({
  memory: MemorySummarySchema,
  snippet: z.string(),
  score: z.number(),
  rank: z.number().int().positive(),
});
export type MemorySearchHit = z.infer<typeof MemorySearchHitSchema>;
export const MemorySearchResultSchema = z.object({
  query: z.string(),
  hits: z.array(MemorySearchHitSchema),
});

export const MemoryRecallItemSchema = z.object({
  id: z.uuid(), slug: z.string(), title: z.string(), revision: z.number().int().positive(),
  summary: z.string().nullable(), body: z.string(), project: z.string().nullable(),
  provenance: MemoryProvenanceSchema, updatedAt: z.iso.datetime(), truncated: z.boolean(),
});
export const MemoryRecallResultSchema = z.object({
  query: z.string(), items: z.array(MemoryRecallItemSchema), totalCharacters: z.number().int().nonnegative(),
  characterLimit: z.number().int().positive(),
});
export type MemoryRecallResult = z.infer<typeof MemoryRecallResultSchema>;

export const MemoryTagSchema = z.object({
  tag: z.string().min(1),
  count: z.number().int().nonnegative(),
});
export type MemoryTag = z.infer<typeof MemoryTagSchema>;
export const MemoryTagListSchema = z.object({ tags: z.array(MemoryTagSchema) });

export const MemoryMarkdownFileSchema = z.object({
  path: z.string().trim().min(1).max(500),
  content: z.string().max(300_000),
});
export type MemoryMarkdownFile = z.infer<typeof MemoryMarkdownFileSchema>;

export const MemoryMarkdownExportSchema = z.object({
  formatVersion: z.literal(1),
  exportedAt: z.iso.datetime(),
  files: z.array(MemoryMarkdownFileSchema).max(10_000),
});
export type MemoryMarkdownExport = z.infer<typeof MemoryMarkdownExportSchema>;

export const MemoryMarkdownImportRequestSchema = z.object({
  files: z.array(MemoryMarkdownFileSchema).min(1).max(10_000),
});
export type MemoryMarkdownImportRequest = z.infer<typeof MemoryMarkdownImportRequestSchema>;

export const memoryImportActions = ["create", "update", "unchanged", "conflict", "invalid"] as const;
export const MemoryImportActionSchema = z.enum(memoryImportActions);
export const MemoryImportEntrySchema = z.object({
  path: z.string().min(1),
  slug: z.string().nullable(),
  action: MemoryImportActionSchema,
  reason: z.string().nullable(),
  currentRevision: z.number().int().positive().nullable(),
  importedRevision: z.number().int().nonnegative().nullable(),
});
export const MemoryImportPlanSchema = z.object({
  entries: z.array(MemoryImportEntrySchema),
  summary: z.object({
    create: z.number().int().nonnegative(),
    update: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    conflict: z.number().int().nonnegative(),
    invalid: z.number().int().nonnegative(),
  }),
});
export type MemoryImportPlan = z.infer<typeof MemoryImportPlanSchema>;

const AbilityPropertySchema = z.object({
  type: z.enum(["string", "number", "integer", "boolean", "array", "object"]),
}).strict();

export const AbilityInputSchemaSchema = z.object({
  type: z.literal("object"),
  properties: z.record(z.string(), AbilityPropertySchema).default({}),
  required: z.array(z.string()).default([]),
  additionalProperties: z.boolean().default(true),
}).strict().superRefine((schema, context) => {
  const unknownRequired = schema.required.filter((name) => !(name in schema.properties));
  if (unknownRequired.length) {
    context.addIssue({
      code: "custom", path: ["required"],
      message: `Required ability inputs must be declared in properties: ${unknownRequired.join(", ")}`,
    });
  }
});

export const AbilityManifestSchema = z.object({
  manifestVersion: z.literal(1),
  id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  name: z.string().min(1).max(120),
  description: z.string().max(2_000),
  inputSchema: AbilityInputSchemaSchema,
  execution: z.object({
    kind: z.literal("command"),
    executable: z.string().min(1),
    args: z.array(z.string()).max(200),
    cwd: z.string().min(1).optional(),
    timeoutMs: z.number().int().min(100).max(3_600_000).default(120_000),
  }).strict(),
}).strict();
export type AbilityManifest = z.infer<typeof AbilityManifestSchema>;

export const CalendarListEventsInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  view: z.enum(["day", "week", "month"]).default("day"),
}).strict();

export const CalendarCreateEventInputSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().max(20_000).optional(),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
}).strict().refine((value) => Date.parse(value.end) > Date.parse(value.start), {
  message: "Calendar event end must be after start",
  path: ["end"],
});

export const SlackChannelInputSchema = z.object({
  channelName: z.string().trim().min(1).max(200),
}).strict();

export const SlackSendMessageInputSchema = SlackChannelInputSchema.extend({
  text: z.string().trim().min(1).max(40_000),
}).strict();

export const BrowserJobRequestSchema = z.union([
  z.object({ adapter: z.literal("google_calendar"), action: z.literal("list_visible_events"), input: z.object({}).strict() }).strict(),
  z.object({ adapter: z.literal("google_calendar"), action: z.literal("list_events"), input: CalendarListEventsInputSchema }).strict(),
  z.object({ adapter: z.literal("google_calendar"), action: z.literal("create_event"), input: CalendarCreateEventInputSchema }).strict(),
  z.object({ adapter: z.literal("slack"), action: z.literal("list_unreads"), input: z.object({}).strict() }).strict(),
  z.object({ adapter: z.literal("slack"), action: z.literal("read_channel"), input: SlackChannelInputSchema }).strict(),
  z.object({ adapter: z.literal("slack"), action: z.literal("send_message"), input: SlackSendMessageInputSchema }).strict(),
]);
export type BrowserJobRequest = z.infer<typeof BrowserJobRequestSchema>;

export const BrowserJobSchema = z.object({
  id: z.uuid(),
  runId: z.uuid().nullable(),
  adapter: z.enum(["google_calendar", "slack"]),
  action: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  status: z.enum(["queued", "claimed", "succeeded", "failed", "cancelled"]),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  claimedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
});
export type BrowserJob = z.infer<typeof BrowserJobSchema>;
export const BrowserJobListSchema = z.object({ jobs: z.array(BrowserJobSchema) });
export const BrowserAutomationStatusSchema = z.object({
  backend: z.literal("claude_in_chrome"),
  enabled: z.boolean(),
  state: z.enum(["ready", "running", "error", "stopped"]),
  activeJobId: z.uuid().nullable(),
  lastStartedAt: z.iso.datetime().nullable(),
  lastCompletedAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),
});
export type BrowserAutomationStatus = z.infer<typeof BrowserAutomationStatusSchema>;
