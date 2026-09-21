import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../../..");
// @ts-ignore The launcher is an executable JavaScript module with intentionally exported test seams.
const { buildControllerLaunch } = await import("../../../scripts/start-controller.mjs") as {
  buildControllerLaunch(input: string[], identity?: { now: number; pid: number }): {
    args: string[];
    cwd: string;
    settings: string;
    sandbox: boolean;
    background: boolean;
    permissionMode: string;
  };
};

describe("Claude controller launcher", () => {
  it("builds a strict sandboxed session without launching Claude", () => {
    const output = buildControllerLaunch(["--sandbox", "--dry-run", "--", "--model", "opus"]);
    expect(output.cwd).toBe(projectRoot);
    expect(output.sandbox).toBe(true);
    expect(output.args).toContain("--settings");
    expect(output.args).toContain(resolve(projectRoot, ".claude/controller-sandbox.settings.json"));
    expect(output.args).toContain("--model");
    expect(output.args.at(-1)).toContain("Enter cc-assistant controller mode");
  });

  it("forwards Claude flags without interpreting them as launcher options", () => {
    const output = buildControllerLaunch(["--dry-run", "--model", "opus"]);
    expect(output.sandbox).toBe(false);
    expect(output.settings).toBe(resolve(projectRoot, ".claude/controller.settings.json"));
    expect(output.args).toEqual(expect.arrayContaining([
      "--settings", resolve(projectRoot, ".claude/controller.settings.json"),
    ]));
    expect(output.args).toContain("--model");
    expect(output.args).toContain("opus");
    expect(output.permissionMode).toBe("manual");
  });

  it("starts an attachable background controller with an explicit permission mode", () => {
    const output = buildControllerLaunch(
      ["--background", "--permission-mode", "auto", "--dry-run"],
      { now: 123456789, pid: 4242 },
    );
    expect(output.background).toBe(true);
    expect(output.permissionMode).toBe("auto");
    expect(output.args).toEqual(expect.arrayContaining([
      "--bg", "--name", "cc-assistant-controller-21i3v9-39u", "--permission-mode", "auto",
    ]));
  });

  it("keeps sandbox fallback disabled and protects local assistant state", () => {
    const settings = JSON.parse(
      readFileSync(resolve(projectRoot, ".claude/controller-sandbox.settings.json"), "utf8"),
    ) as {
      enableAllProjectMcpServers: boolean;
      permissions: { blockReadsOutsideWorkingDirectories: boolean; deny: string[] };
      sandbox: {
        enabled: boolean;
        allowUnsandboxedCommands: boolean;
        failIfUnavailable: boolean;
        filesystem: { denyRead: string[] };
      };
    };
    expect(settings.enableAllProjectMcpServers).toBe(true);
    expect(settings.sandbox.enabled).toBe(true);
    expect(settings.sandbox.allowUnsandboxedCommands).toBe(false);
    expect(settings.sandbox.failIfUnavailable).toBe(true);
    expect(settings.sandbox.filesystem.denyRead).toContain(".data");
    expect(settings.sandbox.filesystem.denyRead).toContain("../.data");
    expect(settings.permissions.blockReadsOutsideWorkingDirectories).toBe(true);
    expect(settings.permissions.deny).toContain("Read(.data/**)");
  });

  it("explicitly trusts the repository MCP configuration for headless launches", () => {
    const settings = JSON.parse(
      readFileSync(resolve(projectRoot, ".claude/controller.settings.json"), "utf8"),
    ) as { enableAllProjectMcpServers: boolean };
    expect(settings.enableAllProjectMcpServers).toBe(true);
  });
});
