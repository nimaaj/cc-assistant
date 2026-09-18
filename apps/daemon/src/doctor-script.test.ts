import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../../..");
const script = resolve(projectRoot, "scripts/doctor.mjs");

describe("release doctor", () => {
  it("documents its read-only and offline modes", () => {
    const result = spawnSync(process.execPath, [script, "--help"], { cwd: projectRoot, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("read-only readiness checks");
    expect(result.stdout).toContain("--offline");
  });

  it("rejects unknown options", () => {
    const result = spawnSync(process.execPath, [script, "--mutate"], { cwd: projectRoot, encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Unknown option: --mutate");
  });
});
