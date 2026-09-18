import { describe, expect, it } from "vitest";
import { readAllEvents, readAllMemories } from "./state-export.js";

describe("state export pagination", () => {
  it("reads every memory page", async () => {
    const records = Array.from({ length: 1_005 }, (_, id) => ({ id }));
    const paths: string[] = [];
    const result = await readAllMemories(async (path) => {
      paths.push(path);
      const offset = Number(new URL(path, "http://local").searchParams.get("offset"));
      return { memories: records.slice(offset, offset + 500) };
    });
    expect(result).toEqual(records);
    expect(paths).toEqual([
      "/api/memories?includeArchived=true&limit=500&offset=0",
      "/api/memories?includeArchived=true&limit=500&offset=500",
      "/api/memories?includeArchived=true&limit=500&offset=1000",
    ]);
  });

  it("reads every event page using the last durable id", async () => {
    const records = Array.from({ length: 1_000 }, (_, index) => ({ id: index + 10 }));
    const paths: string[] = [];
    const result = await readAllEvents(async (path) => {
      paths.push(path);
      const after = Number(new URL(path, "http://local").searchParams.get("after"));
      return { events: records.filter((record) => record.id > after).slice(0, 500) };
    });
    expect(result).toEqual(records);
    expect(paths).toEqual([
      "/api/events?after=0&limit=500",
      "/api/events?after=509&limit=500",
      "/api/events?after=1009&limit=500",
    ]);
  });

  it("fails closed if event pagination cannot advance", async () => {
    await expect(readAllEvents(async () => ({ events: Array.from({ length: 500 }, () => ({ id: 0 })) })))
      .rejects.toThrow("Event pagination did not advance");
  });
});
