import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../../..");
const script = resolve(projectRoot, "scripts/install-global-claude-hooks.mjs");

describe("Claude hook installer", () => {
  it("shows help without touching the user's settings", () => {
    const result = spawnSync(process.execPath, [script, "--help"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, HOME: "/path/that/must/not/be-touched" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--remove");
    expect(result.stdout).toContain("without changing files");
  });

  it("rejects unknown options before touching the user's settings", () => {
    const result = spawnSync(process.execPath, [script, "--wat"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, HOME: "/path/that/must/not-be-touched" },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Unknown option: --wat");
  });
});
