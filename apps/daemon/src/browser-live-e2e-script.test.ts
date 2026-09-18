import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../../..");
const script = resolve(projectRoot, "scripts/browser-live-e2e.mjs");

describe("controlled browser E2E script", () => {
  it("documents the exact live-write guard without contacting the daemon", () => {
    const result = spawnSync(process.execPath, [script, "--help"], { cwd: projectRoot, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("LIVE_WRITES_APPROVED");
    expect(result.stdout).toContain("creates one event and sends one Slack message");
  });

  it("rejects live-write inputs unless the exact confirmation phrase is present", () => {
    const result = spawnSync(process.execPath, [script,
      "--calendar-event", "{}", "--slack-channel", "test", "--slack-message", "test",
    ], { cwd: projectRoot, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Live writes require --confirm LIVE_WRITES_APPROVED");
    expect(result.stderr).not.toContain("daemon is unavailable");
  });
});
