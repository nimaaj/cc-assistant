import {
  ApprovalListSchema,
  AbilityManifestSchema,
  AssistantNotificationListSchema,
  BrowserAutomationStatusSchema,
  BrowserJobListSchema,
  ClaudeAgentSessionListSchema,
  ClaudeSessionListSchema,
  DispatcherProposalSchema,
  MemoryListSchema,
  MemoryRecordSchema,
  MemorySearchResultSchema,
  MemoryLinksSchema,
  RunListSchema,
  ScheduleListSchema,
  TaskListSchema,
  TaskSchema,
  WorkspaceFolderListSchema,
  WorkspaceFolderSchema,
  WorkspaceItemPlacementListSchema,
  WorkspaceItemLayoutListSchema,
  WorkspaceItemLayoutSchema,
  WorkspaceTrashedItemListSchema,
  WorkspaceTrashedItemSchema,
  type CreateTaskInput,
  type ClaudeSession,
  type ClaudeAgentSession,
  type ClaudeSessionControlInput,
  type DispatcherProposal,
  type Approval,
  type AbilityManifest,
  type AssistantNotification,
  type BrowserAutomationStatus,
  type BrowserJob,
  type BrowserJobRequest,
  type CreateScheduleInput,
  type Memory,
  type MemorySearchHit,
  type Run,
  type Schedule,
  type Task,
  type UpdateScheduleInput,
  type UpdateTaskInput,
  type CreateWorkspaceFolderInput,
  type MoveWorkspaceItemInput,
  type SetWorkspaceItemLayoutInput,
  type TrashWorkspaceItemInput,
  type UpdateWorkspaceFolderInput,
  type WorkspaceFolder,
  type WorkspaceItemPlacement,
  type WorkspaceItemLayout,
  type WorkspaceTrashedItem,
} from "@cc-assistant/shared";

export class AuthenticationError extends Error {}

export async function rawApiRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (response.status === 401) throw new AuthenticationError("Authentication is required");
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      | { message?: string }
      | undefined;
    throw new Error(body?.message ?? `Request failed with HTTP ${response.status}`);
  }
  if (response.status === 204) return undefined;
  return response.json() as Promise<unknown>;
}

const request = rawApiRequest;

export async function login(token: string): Promise<void> {
  await rawApiRequest("/api/session", { method: "POST", body: JSON.stringify({ token }) });
}

export async function logout(): Promise<void> {
  await request("/api/session", { method: "DELETE" });
}

export async function listTasks(): Promise<Task[]> {
  return TaskListSchema.parse(await request("/api/tasks")).tasks;
}

export async function listSessions(): Promise<ClaudeSession[]> {
  return ClaudeSessionListSchema.parse(await request("/api/sessions")).sessions;
}

export async function listClaudeAgentSessions(): Promise<ClaudeAgentSession[]> {
  return ClaudeAgentSessionListSchema.parse(await request("/api/claude/sessions?includeCompleted=true")).sessions;
}

export async function controlClaudeSession(input: ClaudeSessionControlInput): Promise<void> {
  await request("/api/claude/sessions/control", { method: "POST", body: JSON.stringify(input) });
}

export async function dispatchInput(input: string, target?: string, context: Record<string, unknown> = {}): Promise<DispatcherProposal> {
  return DispatcherProposalSchema.parse(await request("/api/dispatcher", {
    method: "POST",
    body: JSON.stringify({ input, ...(target ? { target } : {}), context }),
  }));
}

export async function listRuns(): Promise<Run[]> {
  return RunListSchema.parse(await request("/api/runs")).runs;
}

export async function listPendingApprovals(): Promise<Approval[]> {
  return ApprovalListSchema.parse(await request("/api/approvals?status=pending")).approvals;
}

export async function resolveApproval(
  id: string,
  decision: "approved" | "denied",
): Promise<void> {
  await request(`/api/approvals/${id}/resolve`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}

export async function cancelRun(id: string): Promise<void> {
  await request(`/api/runs/${id}/cancel`, { method: "POST" });
}

export async function getConfig(): Promise<{ platform: string; allowedRoots: string[]; dataDir: string }> {
  return await request("/api/config") as { platform: string; allowedRoots: string[]; dataDir: string };
}

export async function getBrowserStatus(): Promise<BrowserAutomationStatus> {
  return BrowserAutomationStatusSchema.parse(await request("/api/browser/status"));
}

export async function listNotifications(): Promise<AssistantNotification[]> {
  return AssistantNotificationListSchema.parse(await request("/api/notifications")).notifications;
}

export async function markNotificationRead(id: string): Promise<void> {
  await request(`/api/notifications/${id}/read`, { method: "POST" });
}

export async function listWorkspaceFolders(): Promise<WorkspaceFolder[]> {
  return WorkspaceFolderListSchema.parse(await request("/api/workspace/folders")).folders;
}

export async function createWorkspaceFolder(input: CreateWorkspaceFolderInput): Promise<WorkspaceFolder> {
  const result = await request("/api/workspace/folders", {
    method: "POST", body: JSON.stringify(input),
  }) as { folder: unknown };
  return WorkspaceFolderSchema.parse(result.folder);
}

export async function updateWorkspaceFolder(id: string, input: UpdateWorkspaceFolderInput): Promise<WorkspaceFolder> {
  const result = await request(`/api/workspace/folders/${id}`, {
    method: "PATCH", body: JSON.stringify(input),
  }) as { folder: unknown };
  return WorkspaceFolderSchema.parse(result.folder);
}

export async function deleteWorkspaceFolder(id: string): Promise<void> {
  await request(`/api/workspace/folders/${id}`, { method: "DELETE" });
}

export async function listWorkspaceItemPlacements(): Promise<WorkspaceItemPlacement[]> {
  return WorkspaceItemPlacementListSchema.parse(await request("/api/workspace/placements")).placements;
}

export async function moveWorkspaceItem(input: MoveWorkspaceItemInput): Promise<WorkspaceItemPlacement | null> {
  const result = await request("/api/workspace/placements", {
    method: "PUT", body: JSON.stringify(input),
  }) as { placement: unknown };
  return result.placement === null ? null : WorkspaceItemPlacementListSchema.shape.placements.element.parse(result.placement);
}

export async function listWorkspaceItemLayouts(): Promise<WorkspaceItemLayout[]> {
  return WorkspaceItemLayoutListSchema.parse(await request("/api/workspace/layouts")).layouts;
}

export async function setWorkspaceItemLayout(input: SetWorkspaceItemLayoutInput): Promise<WorkspaceItemLayout> {
  const result = await request("/api/workspace/layouts", {
    method: "PUT", body: JSON.stringify(input),
  }) as { layout: unknown };
  return WorkspaceItemLayoutSchema.parse(result.layout);
}

export async function resetWorkspaceItemLayouts(): Promise<void> {
  await request("/api/workspace/layouts", { method: "DELETE" });
}

export async function listWorkspaceTrashedItems(): Promise<WorkspaceTrashedItem[]> {
  return WorkspaceTrashedItemListSchema.parse(await request("/api/workspace/trash")).items;
}

export async function trashWorkspaceItem(input: TrashWorkspaceItemInput): Promise<WorkspaceTrashedItem> {
  const result = await request("/api/workspace/trash", {
    method: "PUT", body: JSON.stringify(input),
  }) as { item: unknown };
  return WorkspaceTrashedItemSchema.parse(result.item);
}

export async function restoreWorkspaceItem(input: TrashWorkspaceItemInput): Promise<void> {
  await request("/api/workspace/trash/restore", {
    method: "POST", body: JSON.stringify(input),
  });
}

export async function listSchedules(): Promise<Schedule[]> {
  return ScheduleListSchema.parse(await request("/api/schedules")).schedules;
}

export async function createSchedule(input: CreateScheduleInput): Promise<Schedule> {
  const result = await request("/api/schedules", {
    method: "POST",
    body: JSON.stringify(input),
  }) as { schedule: unknown };
  return ScheduleListSchema.shape.schedules.element.parse(result.schedule);
}

export async function updateSchedule(id: string, input: UpdateScheduleInput): Promise<Schedule> {
  const result = await request(`/api/schedules/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  }) as { schedule: unknown };
  return ScheduleListSchema.shape.schedules.element.parse(result.schedule);
}

export async function createReminder(input: { title: string; body: string; at: string }): Promise<void> {
  await request("/api/schedules", { method: "POST", body: JSON.stringify({
    name: input.title, triggerKind: "at", trigger: { at: input.at },
    actionKind: "reminder", action: { title: input.title, body: input.body },
  }) });
}

export async function listMemories(): Promise<Memory[]> {
  return MemoryListSchema.parse(await request("/api/memories")).memories;
}

export async function searchMemories(query: string, project = "", tag = ""): Promise<MemorySearchHit[]> {
  const params = new URLSearchParams({ q: query });
  if (project) params.set("project", project);
  if (tag) params.set("tag", tag);
  return MemorySearchResultSchema.parse(await request(`/api/memories/search?${params}`)).hits;
}

export async function getMemoryBundle(id: string): Promise<{ memory: Memory; links: { outgoing: unknown[]; backlinks: unknown[] } }> {
  const [record, links] = await Promise.all([request(`/api/memories/${encodeURIComponent(id)}`), request(`/api/memories/${encodeURIComponent(id)}/links`)]);
  return { memory: MemoryRecordSchema.parse((record as { memory: unknown }).memory), links: MemoryLinksSchema.parse(links) };
}

export async function createMemory(input: { slug?: string; title: string; body: string; tags: string[]; aliases?: string[]; summary?: string | null; kind?: string; project?: string | null }): Promise<Memory> {
  const result = await request("/api/memories", { method: "POST", body: JSON.stringify(input) }) as { memory: unknown };
  return MemoryRecordSchema.parse(result.memory);
}

export async function updateMemory(id: string, input: { title?: string; body?: string; tags?: string[]; aliases?: string[]; summary?: string | null; kind?: string; project?: string | null; expectedRevision: number }): Promise<Memory> {
  const result = await request(`/api/memories/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }) as { memory: unknown };
  return MemoryRecordSchema.parse(result.memory);
}

export async function archiveMemory(id: string, expectedRevision: number): Promise<Memory> {
  const result = await request(`/api/memories/${encodeURIComponent(id)}/archive`, { method: "POST", body: JSON.stringify({ expectedRevision }) }) as { memory: unknown };
  return MemoryRecordSchema.parse(result.memory);
}

export async function startAgent(input: { title: string; prompt: string; cwd: string }): Promise<void> {
  await request("/api/runs/agent", { method: "POST", body: JSON.stringify(input) });
}

export async function proposeCommand(input: {
  title: string;
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
}): Promise<void> {
  await request("/api/runs/command", { method: "POST", body: JSON.stringify(input) });
}

export async function listAbilities(): Promise<AbilityManifest[]> {
  const result = await request("/api/abilities") as { abilities: unknown[] };
  return result.abilities.map((ability) => AbilityManifestSchema.parse(ability));
}

export async function installAbility(manifest: unknown): Promise<AbilityManifest> {
  const result = await request("/api/abilities", {
    method: "POST",
    body: JSON.stringify(manifest),
  }) as { ability: unknown };
  return AbilityManifestSchema.parse(result.ability);
}

export async function invokeAbility(id: string, input: Record<string, unknown>): Promise<void> {
  await request(`/api/abilities/${encodeURIComponent(id)}/invoke`, {
    method: "POST",
    body: JSON.stringify({ input }),
  });
}

export async function listBrowserJobs(): Promise<BrowserJob[]> {
  return BrowserJobListSchema.parse(await request("/api/browser/jobs")).jobs;
}

export async function createBrowserJob(input: BrowserJobRequest): Promise<void> {
  await request("/api/browser/jobs", { method: "POST", body: JSON.stringify(input) });
}

export async function readClipboardImage(): Promise<{ mimeType: string; dataUrl: string }> {
  const result = await request("/api/native/clipboard/image") as {
    image?: { mimeType?: unknown; dataUrl?: unknown };
  };
  if (typeof result.image?.mimeType !== "string" || typeof result.image.dataUrl !== "string") {
    throw new Error("The daemon returned an invalid clipboard image");
  }
  return { mimeType: result.image.mimeType, dataUrl: result.image.dataUrl };
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const result = (await request("/api/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  })) as { task: unknown };
  return TaskSchema.parse(result.task);
}

export async function updateTask(id: string, input: UpdateTaskInput): Promise<Task> {
  const result = (await request(`/api/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })) as { task: unknown };
  return TaskSchema.parse(result.task);
}
