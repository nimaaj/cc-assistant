import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  RuntimeControlSchema,
  RuntimeRecipeSchema,
  RuntimeStatusSchema,
  RuntimeTranscriptSchema,
  type ClaudeAgentSession,
  type RuntimeControlInput,
  type RuntimeRecipe,
  type RuntimeStatus,
  type RuntimeTranscript,
} from "@cc-assistant/shared";
import type { DaemonConfig } from "./config.js";
import { ExecutionInputError, ExecutionService } from "./execution-service.js";

// This relative path works from both src/ and dist/, keeping development and production on the
// same committed recipes and runtime control script.
const projectRoot = resolve(import.meta.dirname, "../../..");
const runtimeScript = resolve(projectRoot, "scripts/runtime-recipe.mjs");

interface CommandResult { stdout: string; stderr: string }
type ProcessRunner = (command: string, args: string[], timeoutMs?: number) => Promise<CommandResult>;

function runProcess(command: string, args: string[], timeoutMs = 10_000): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, { cwd: projectRoot, timeout: timeoutMs, maxBuffer: 4_000_000 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr).trim() || error.message));
      resolvePromise({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export class RuntimeService {
  readonly #config: DaemonConfig;
  readonly #runner: ProcessRunner;

  constructor(config: DaemonConfig, runner: ProcessRunner = runProcess) {
    this.#config = config;
    this.#runner = runner;
  }

  get configPath(): string { return join(this.#config.dataDir, "runtime-config.json"); }

  async recipe(): Promise<RuntimeRecipe> {
    try {
      return RuntimeRecipeSchema.parse(JSON.parse(await readFile(this.configPath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return RuntimeRecipeSchema.parse(JSON.parse(await readFile(resolve(projectRoot, "recipes/default.json"), "utf8")));
    }
  }

  async saveRecipe(value: unknown): Promise<RuntimeRecipe> {
    const recipe = RuntimeRecipeSchema.parse(value);
    const temporary = `${this.configPath}.${process.pid}.tmp`;
    await mkdir(dirname(this.configPath), { recursive: true, mode: 0o700 });
    await writeFile(temporary, `${JSON.stringify(recipe, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.configPath);
    return recipe;
  }

  async #tmux(args: string[], timeoutMs = 10_000): Promise<CommandResult> {
    return this.#runner("tmux", args, timeoutMs);
  }

  async #hasSession(name: string): Promise<boolean> {
    try { await this.#tmux(["has-session", "-t", name], 3_000); return true; }
    catch { return false; }
  }

  async status(controller: ClaudeAgentSession | null): Promise<RuntimeStatus> {
    const recipe = await this.recipe();
    let tmuxAvailable = true;
    try { await this.#runner("tmux", ["-V"], 3_000); }
    catch { tmuxAvailable = false; }
    const sessionExists = tmuxAvailable && await this.#hasSession(recipe.tmuxSession);
    let panes: RuntimeStatus["panes"] = [];
    if (sessionExists) {
      const result = await this.#tmux([
        "list-panes", "-s", "-t", recipe.tmuxSession, "-F",
        "#{window_name}\t#{pane_id}\t#{pane_pid}\t#{pane_current_command}\t#{pane_dead}",
      ]);
      panes = result.stdout.split("\n").filter(Boolean).map((line) => {
        const [windowName = "", paneId = "", pid = "0", command = "", dead = "0"] = line.split("\t");
        return { windowName, paneId, pid: Number.parseInt(pid, 10) || 0, command, dead: dead === "1" };
      });
    }
    const daemonManaged = panes.some((pane) => pane.windowName === recipe.daemonWindow && !pane.dead);
    const dispatcherManaged = panes.some((pane) => pane.windowName === recipe.dispatcherWindow && !pane.dead);
    return RuntimeStatusSchema.parse({
      recipe,
      tmuxAvailable,
      sessionExists,
      daemonManaged,
      dispatcherManaged,
      dispatcherConnected: dispatcherManaged && controller?.pid !== null && controller?.pid !== undefined,
      dispatcherSessionId: controller?.sessionId ?? controller?.id ?? null,
      panes,
      checkedAt: new Date().toISOString(),
    });
  }

  async capturePane(reference: string, session: ClaudeAgentSession): Promise<RuntimeTranscript> {
    const status = await this.status(null);
    let pane = session.name?.startsWith(status.recipe.dispatcherName)
      ? status.panes.find((candidate) => candidate.windowName === status.recipe.dispatcherWindow && !candidate.dead)
      : status.panes.find((candidate) => candidate.pid === session.pid && !candidate.dead);
    if (!pane && session.kind === "interactive") {
      const liveClaudePanes = status.panes.filter((candidate) => candidate.command.toLowerCase().includes("claude") && !candidate.dead);
      if (liveClaudePanes.length === 1) pane = liveClaudePanes[0];
    }
    if (!pane) throw new ExecutionInputError("No tmux pane could be matched safely to this interactive Claude session");
    const result = await this.#tmux(["capture-pane", "-p", "-S", "-1200", "-t", pane.paneId], 10_000);
    return RuntimeTranscriptSchema.parse({ reference, source: "tmux", available: true, content: result.stdout, error: null, capturedAt: new Date().toISOString() });
  }

  async propose(
    executionService: ExecutionService,
    rawInput: RuntimeControlInput,
    targetSession?: ClaudeAgentSession,
  ): Promise<ReturnType<ExecutionService["proposeCommand"]>> {
    const input = RuntimeControlSchema.parse(rawInput);
    const recipe = await this.recipe();
    const args = [runtimeScript];
    let title: string;
    if (input.action === "slash_command") {
      args.push("slash", input.command);
      title = `Run ${input.command.split(/\s/, 1)[0]} in the dispatcher`;
    } else if (input.action === "relaunch_dispatcher") {
      args.push("relaunch-dispatcher");
      title = "Relaunch the main dispatcher";
    } else if (input.action === "repair") {
      args.push("repair");
      title = "Repair the default assistant runtime";
    } else if (input.action === "open_terminal") {
      args.push("open-terminal");
      title = "Open a terminal attached to the dispatcher";
    } else {
      if (!targetSession?.id || targetSession.kind !== "background") {
        if (!targetSession?.pid) throw new ExecutionInputError("This Claude session cannot be attached to a terminal");
        const runtime = await this.status(null);
        const pane = runtime.panes.find((candidate) => candidate.pid === targetSession.pid && !candidate.dead);
        if (!pane) throw new ExecutionInputError("No tmux pane could be matched safely to this Claude session");
        args.push("open-pane-terminal", pane.paneId);
      } else {
        args.push("open-session-terminal", targetSession.id);
      }
      title = `Open a terminal attached to ${targetSession.name ?? targetSession.id ?? "Claude"}`;
    }
    return executionService.proposeCommand({
      title,
      executable: process.execPath,
      args,
      cwd: this.#config.allowedRoots.includes(projectRoot) ? projectRoot : (this.#config.allowedRoots[0] ?? projectRoot),
      timeoutMs: input.action.startsWith("open_") ? 30_000 : 120_000,
    });
  }
}
