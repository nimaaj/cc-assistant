export type StateRequester = (path: string) => Promise<unknown>;

export async function readAllMemories(request: StateRequester): Promise<unknown[]> {
  const records: unknown[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await request(`/api/memories?includeArchived=true&limit=500&offset=${offset}`) as { memories: unknown[] };
    records.push(...page.memories);
    if (page.memories.length < 500) return records;
  }
}

export async function readAllEvents(request: StateRequester): Promise<Array<{ id?: unknown }>> {
  const records: Array<{ id?: unknown }> = [];
  let after = 0;
  for (;;) {
    const page = await request(`/api/events?after=${after}&limit=500`) as { events: Array<{ id?: unknown }> };
    records.push(...page.events);
    if (page.events.length < 500) return records;
    const lastId = page.events.at(-1)?.id;
    if (typeof lastId !== "number" || lastId <= after) throw new Error("Event pagination did not advance");
    after = lastId;
  }
}
