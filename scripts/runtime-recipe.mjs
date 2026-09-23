#!/usr/bin/env node
import { execFile, execFileSync, spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function defaultDataDir(env = process.env) {
  if (env.CC_ASSISTANT_DATA_DIR) return resolve(env.CC_ASSISTANT_DATA_DIR);
  return resolve(projectRoot, ".data");
}

function requireString(value, label, pattern) {
  if (typeof value !== "string" || !value.trim() || (pattern && !pattern.test(value))) {
    throw new Error(`Invalid recipe field ${label}`);
  }
  return value;
}

export function validateRecipe(value) {
  if (!value || typeof value !== "object" || value.version !== 1) throw new Error("Recipe version must be 1");
  const permissionModes = new Set(["manual", "auto", "bypassPermissions"]);
  const teammateModes = new Set(["tmux", "in-process", "auto"]);
  const efforts = new Set(["low", "medium", "high", "xhigh", "max"]);
  const launchers = new Set(["auto", "xdg-terminal-exec", "gnome-terminal", "konsole", "xterm"]);
  const token = /^[A-Za-z0-9_.-]+$/;
  const id = /^[a-z0-9][a-z0-9-]*$/;
  const recipe = {
    version: 1,
    id: requireString(value.id, "id", id),
    name: requireString(value.name, "name"),
    description: typeof value.description === "string" ? value.description : "",
    tmuxSession: requireString(value.tmuxSession, "tmuxSession", token),
    daemonWindow: requireString(value.daemonWindow, "daemonWindow", token),
    dispatcherWindow: requireString(value.dispatcherWindow, "dispatcherWindow", token),
    dispatcherName: requireString(value.dispatcherName, "dispatcherName", /^[A-Za-z0-9_-]+$/),
    dispatcherPermissionMode: value.dispatcherPermissionMode,
    dispatcherSandbox: value.dispatcherSandbox === true,
    dispatcherTeammateMode: value.dispatcherTeammateMode,
    dispatcherModel: value.dispatcherModel === null ? null : requireString(value.dispatcherModel, "dispatcherModel"),
    dispatcherEffort: value.dispatcherEffort,
    dispatcherRemoteControl: value.dispatcherRemoteControl === true,
    autoRepair: value.autoRepair !== false,
    terminalLauncher: value.terminalLauncher,
    daemon: {
      host: typeof value.daemon?.host === "string" && value.daemon.host.trim() ? value.daemon.host : "127.0.0.1",
      port: Number.isInteger(value.daemon?.port) ? value.daemon.port : 4317,
      allowedRoots: Array.isArray(value.daemon?.allowedRoots) ? value.daemon.allowedRoots.map((root) => requireString(root, "daemon.allowedRoots")) : [],
      managedAgentUseClaudeLogin: value.daemon?.managedAgentUseClaudeLogin !== false,
      browserEnabled: value.daemon?.browserEnabled !== false,
      browserUseClaudeLogin: value.daemon?.browserUseClaudeLogin !== false,
      browserModel: typeof value.daemon?.browserModel === "string" && value.daemon.browserModel.trim() ? value.daemon.browserModel : "sonnet",
      browserEffort: value.daemon?.browserEffort ?? "low",
      browserMaxTurns: Number.isInteger(value.daemon?.browserMaxTurns) ? value.daemon.browserMaxTurns : 12,
      browserMaxBudgetUsd: typeof value.daemon?.browserMaxBudgetUsd === "number" ? value.daemon.browserMaxBudgetUsd : 1,
    },
  };
  if (!permissionModes.has(recipe.dispatcherPermissionMode)) throw new Error("Invalid dispatcherPermissionMode");
  if (!teammateModes.has(recipe.dispatcherTeammateMode)) throw new Error("Invalid dispatcherTeammateMode");
  if (!efforts.has(recipe.dispatcherEffort)) throw new Error("Invalid dispatcherEffort");
  if (!launchers.has(recipe.terminalLauncher)) throw new Error("Invalid terminalLauncher");
  if (recipe.daemon.port < 1 || recipe.daemon.port > 65_535) throw new Error("Invalid daemon.port");
  if (!new Set(["low", "medium", "high"]).has(recipe.daemon.browserEffort)) throw new Error("Invalid daemon.browserEffort");
  if (recipe.daemon.browserMaxTurns < 1 || recipe.daemon.browserMaxTurns > 50) throw new Error("Invalid daemon.browserMaxTurns");
  if (!(recipe.daemon.browserMaxBudgetUsd > 0 && recipe.daemon.browserMaxBudgetUsd <= 10)) throw new Error("Invalid daemon.browserMaxBudgetUsd");
  return recipe;
}

export async function loadRecipe(id = "default", env = process.env) {
  const overridePath = join(defaultDataDir(env), "runtime-config.json");
  try {
    const override = validateRecipe(JSON.parse(await readFile(overridePath, "utf8")));
    if (id === "active" || override.id === id) return override;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const recipePath = resolve(projectRoot, "recipes", `${id === "active" ? "default" : id}.json`);
  return validateRecipe(JSON.parse(await readFile(recipePath, "utf8")));
}

export async function saveRecipe(recipe, env = process.env) {
  const validated = validateRecipe(recipe);
  const target = join(defaultDataDir(env), "runtime-config.json");
  const temporary = `${target}.${process.pid}.tmp`;
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
  return validated;
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, { cwd: projectRoot, timeout: options.timeoutMs ?? 15_000, maxBuffer: 4_000_000 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr).trim() || error.message));
      resolvePromise({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

async function commandExists(command) {
  try { await run("which", [command], { timeoutMs: 3_000 }); return true; }
  catch { return false; }
}

async function daemonHealthy(recipe, env = process.env) {
  const host = env.CC_ASSISTANT_HOST ?? recipe.daemon.host;
  const port = env.CC_ASSISTANT_PORT ?? String(recipe.daemon.port);
  try {
    const response = await fetch(`http://${host}:${port}/api/health`, { signal: AbortSignal.timeout(1_200) });
    return response.ok;
  } catch { return false; }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function controllerCommand(recipe) {
  const args = [process.execPath, resolve(projectRoot, "scripts/start-controller.mjs"), "--permission-mode", recipe.dispatcherPermissionMode, "--controller-name", recipe.dispatcherName];
  if (recipe.dispatcherSandbox) args.push("--sandbox");
  args.push("--", "--effort", recipe.dispatcherEffort, "--teammate-mode", recipe.dispatcherTeammateMode);
  if (recipe.dispatcherModel) args.push("--model", recipe.dispatcherModel);
  if (recipe.dispatcherRemoteControl) args.push("--remote-control", recipe.dispatcherName);
  const launch = args.map(shellQuote).join(" ");
  if (!recipe.autoRepair) return `exec ${launch}`;
  return `while true; do ${launch}; printf '%s\\n' 'Dispatcher exited; restarting in 2 seconds.'; sleep 2; done`;
}

function daemonCommand(recipe) {
  const daemon = recipe.daemon;
  const allowedRoots = daemon.allowedRoots.length > 0 ? daemon.allowedRoots.join(delimiter) : projectRoot;
  const launch = [
    "env",
    `CC_ASSISTANT_DATA_DIR=${defaultDataDir()}`,
    `CC_ASSISTANT_HOST=${process.env.CC_ASSISTANT_HOST ?? daemon.host}`,
    `CC_ASSISTANT_PORT=${process.env.CC_ASSISTANT_PORT ?? String(daemon.port)}`,
    `CC_ASSISTANT_ALLOWED_ROOTS=${process.env.CC_ASSISTANT_ALLOWED_ROOTS ?? allowedRoots}`,
    `CC_ASSISTANT_AGENT_USE_CLAUDE_LOGIN=${process.env.CC_ASSISTANT_AGENT_USE_CLAUDE_LOGIN ?? String(daemon.managedAgentUseClaudeLogin)}`,
    `CC_ASSISTANT_BROWSER_ENABLED=${process.env.CC_ASSISTANT_BROWSER_ENABLED ?? String(daemon.browserEnabled)}`,
    `CC_ASSISTANT_BROWSER_USE_CLAUDE_LOGIN=${process.env.CC_ASSISTANT_BROWSER_USE_CLAUDE_LOGIN ?? String(daemon.browserUseClaudeLogin)}`,
    `CC_ASSISTANT_BROWSER_MODEL=${process.env.CC_ASSISTANT_BROWSER_MODEL ?? daemon.browserModel}`,
    `CC_ASSISTANT_BROWSER_EFFORT=${process.env.CC_ASSISTANT_BROWSER_EFFORT ?? daemon.browserEffort}`,
    `CC_ASSISTANT_BROWSER_MAX_TURNS=${process.env.CC_ASSISTANT_BROWSER_MAX_TURNS ?? String(daemon.browserMaxTurns)}`,
    `CC_ASSISTANT_BROWSER_MAX_BUDGET_USD=${process.env.CC_ASSISTANT_BROWSER_MAX_BUDGET_USD ?? String(daemon.browserMaxBudgetUsd)}`,
    process.execPath,
    resolve(projectRoot, "apps/daemon/dist/index.js"),
  ].map(shellQuote).join(" ");
  if (!recipe.autoRepair) return `exec ${launch}`;
  return `while true; do ${launch}; printf '%s\\n' 'Daemon exited; restarting in 2 seconds.'; sleep 2; done`;
}

async function hasTmuxSession(name) {
  try { await run("tmux", ["has-session", "-t", name]); return true; }
  catch { return false; }
}

async function windowNames(name) {
  try {
    const result = await run("tmux", ["list-windows", "-t", name, "-F", "#{window_name}"]);
    return result.stdout.split("\n").map((item) => item.trim()).filter(Boolean);
  } catch { return []; }
}

async function createWindow(recipe, windowName, command) {
  await run("tmux", ["new-window", "-d", "-t", recipe.tmuxSession, "-n", windowName, "-c", projectRoot, command]);
}

export async function ensureRuntime(recipe, { relaunchDispatcher = false } = {}) {
  if (!(await commandExists("tmux"))) throw new Error("tmux is required by this recipe but was not found in PATH");
  try { await access(resolve(projectRoot, "apps/daemon/dist/index.js"), constants.R_OK); }
  catch { throw new Error("The daemon build is missing. Run pnpm build (or npm run build) first."); }

  let createdSession = false;
  if (!(await hasTmuxSession(recipe.tmuxSession))) {
    await run("tmux", ["new-session", "-d", "-s", recipe.tmuxSession, "-n", "bootstrap", "-c", projectRoot]);
    createdSession = true;
  }
  let windows = await windowNames(recipe.tmuxSession);
  const healthy = await daemonHealthy(recipe);
  if (!windows.includes(recipe.daemonWindow) && !healthy) {
    await createWindow(recipe, recipe.daemonWindow, daemonCommand(recipe));
    windows = await windowNames(recipe.tmuxSession);
  }
  if (relaunchDispatcher && windows.includes(recipe.dispatcherWindow)) {
    await run("tmux", ["kill-window", "-t", `${recipe.tmuxSession}:${recipe.dispatcherWindow}`]);
    windows = await windowNames(recipe.tmuxSession);
  }
  if (!windows.includes(recipe.dispatcherWindow)) {
    await createWindow(recipe, recipe.dispatcherWindow, controllerCommand(recipe));
  }
  if (createdSession) {
    const refreshed = await windowNames(recipe.tmuxSession);
    if (refreshed.includes("bootstrap") && refreshed.length > 1) {
      await run("tmux", ["kill-window", "-t", `${recipe.tmuxSession}:bootstrap`]);
    }
  }
  return { recipe: recipe.id, session: recipe.tmuxSession, reusedDaemon: healthy };
}

const allowedSlashCommands = new Set([
  "agents", "compact", "context", "doctor", "mcp", "permissions", "tasks", "status", "config", "memory", "reload-plugins", "rewind",
]);

export function validateSlashCommand(command) {
  if (typeof command !== "string" || /[\r\n]/.test(command)) throw new Error("Slash command must be one line");
  const match = command.trim().match(/^\/([A-Za-z][A-Za-z0-9-]*)(?:\s.*)?$/);
  if (!match || !allowedSlashCommands.has(match[1].toLowerCase())) {
    throw new Error(`Unsupported dispatcher slash command. Allowed: ${[...allowedSlashCommands].sort().map((item) => `/${item}`).join(", ")}`);
  }
  return command.trim();
}

async function sendSlash(recipe, command) {
  const validated = validateSlashCommand(command);
  const target = `${recipe.tmuxSession}:${recipe.dispatcherWindow}`;
  await run("tmux", ["send-keys", "-t", target, "-l", validated]);
  await run("tmux", ["send-keys", "-t", target, "Enter"]);
}

async function resolveLauncher(preference) {
  const candidates = preference === "auto"
    ? ["xdg-terminal-exec", "gnome-terminal", "konsole", "xterm"]
    : [preference];
  for (const candidate of candidates) if (await commandExists(candidate)) return candidate;
  throw new Error("No supported graphical terminal launcher was found");
}

async function openTerminal(recipe, backgroundId, paneId) {
  const launcher = await resolveLauncher(recipe.terminalLauncher);
  const terminalCommand = backgroundId
    ? ["claude", "attach", backgroundId]
    : paneId
      ? ["tmux", "attach-session", "-t", recipe.tmuxSession, ";", "select-pane", "-t", paneId]
      : ["tmux", "attach-session", "-t", recipe.tmuxSession, ";", "select-window", "-t", recipe.dispatcherWindow];
  const args = launcher === "gnome-terminal" ? ["--", ...terminalCommand]
    : launcher === "konsole" || launcher === "xterm" ? ["-e", ...terminalCommand]
      : terminalCommand;
  const child = spawn(launcher, args, { cwd: projectRoot, detached: true, shell: false, stdio: "ignore" });
  child.unref();
}

async function status(recipe) {
  const exists = await hasTmuxSession(recipe.tmuxSession);
  const windows = exists ? await windowNames(recipe.tmuxSession) : [];
  return { recipe: recipe.id, tmuxSession: recipe.tmuxSession, sessionExists: exists, windows, daemonHealthy: await daemonHealthy(recipe) };
}

export async function main(input = process.argv.slice(2)) {
  const [action = "start", first, ...rest] = input;
  const recipe = await loadRecipe(action === "start" && first && !first.startsWith("-") ? first : "active");
  if (action === "start" || action === "repair") {
    const result = await ensureRuntime(recipe);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\nDashboard: http://${process.env.CC_ASSISTANT_HOST ?? recipe.daemon.host}:${process.env.CC_ASSISTANT_PORT ?? String(recipe.daemon.port)}/\nAttach: tmux attach-session -t ${recipe.tmuxSession}\n`);
    return;
  }
  if (action === "relaunch-dispatcher") {
    process.stdout.write(`${JSON.stringify(await ensureRuntime(recipe, { relaunchDispatcher: true }), null, 2)}\n`);
    return;
  }
  if (action === "slash") { await sendSlash(recipe, [first, ...rest].join(" ")); return; }
  if (action === "open-terminal") { await openTerminal(recipe); return; }
  if (action === "open-session-terminal") { await openTerminal(recipe, requireString(first, "background session ID", /^[A-Za-z0-9_-]+$/)); return; }
  if (action === "open-pane-terminal") { await openTerminal(recipe, undefined, requireString(first, "tmux pane ID", /^%[0-9]+$/)); return; }
  if (action === "status") { process.stdout.write(`${JSON.stringify(await status(recipe), null, 2)}\n`); return; }
  if (action === "list") {
    const entries = await readdir(resolve(projectRoot, "recipes"));
    const recipes = [];
    for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
      recipes.push(await loadRecipe(entry.slice(0, -5), { ...process.env, CC_ASSISTANT_DATA_DIR: resolve(projectRoot, ".recipe-list-no-override") }));
    }
    process.stdout.write(`${recipes.map((candidate) => `${candidate.id}\t${candidate.name}`).join("\n")}\n`);
    return;
  }
  throw new Error(`Unknown runtime recipe action: ${action}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
