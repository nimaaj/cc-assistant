import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../../..");
const script = resolve(projectRoot, "scripts/install-macos-services.mjs");

describe("macOS service installer", () => {
  it("renders both per-user LaunchAgents without mutating the host", () => {
    const result = spawnSync(process.execPath, [script, "--dry-run"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, CC_ASSISTANT_DATA_DIR: resolve(projectRoot, ".data") },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("<string>com.cc-assistant.daemon</string>");
    expect(result.stdout).toContain("<string>com.cc-assistant.notification-watcher</string>");
    expect(result.stdout).not.toContain("notification-watcher.swift");
    expect(result.stdout).toContain(".data/bin/notification-watcher");
    expect(result.stdout.match(/<key>RunAtLoad<\/key>/g)).toHaveLength(2);
  });

  it("documents installation without attempting it", () => {
    const result = spawnSync(process.execPath, [script, "--help"], { cwd: projectRoot, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--dry-run");
    expect(result.stdout).toContain("--remove");
  });
});
