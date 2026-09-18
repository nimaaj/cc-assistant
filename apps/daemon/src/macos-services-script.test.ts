import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../../..");
const script = resolve(projectRoot, "scripts/install-macos-services.mjs");
const watcher = resolve(projectRoot, "native/macos/notification-watcher.swift");

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

  it("retries visible notifications until the daemon acknowledges delivery", () => {
    const source = readFileSync(watcher, "utf8");
    expect(source).toContain("(200..<300).contains(http.statusCode)");
    expect(source).toContain("it will be retried while visible");
    expect(source).toContain("seen = delivered.intersection(current)");
  });
});
