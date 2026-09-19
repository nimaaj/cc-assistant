#!/usr/bin/env node
import { spawn } from "node:child_process";

const workspaceOrder = [
  "@cc-assistant/shared",
  "@cc-assistant/client",
  "@cc-assistant/daemon",
  "@cc-assistant/mcp",
  "@cc-assistant/cli",
  "@cc-assistant/web",
];

function packageManager() {
  const userAgent = process.env.npm_config_user_agent ?? "";
  const execPath = process.env.npm_execpath ?? "";
  if (userAgent.startsWith("pnpm/") || execPath.includes("pnpm")) return "pnpm";
  if (userAgent.startsWith("npm/") || execPath.includes("npm")) return "npm";
  throw new Error("Run this script through pnpm or npm so the workspace package manager is known");
}

const manager = packageManager();
const task = process.argv[2];

function commandFor(workspace, script) {
  return manager === "pnpm"
    ? { command: "pnpm", args: ["--filter", workspace, "run", script] }
    : { command: "npm", args: ["run", script, "--workspace", workspace] };
}

function start(workspace, script) {
  const command = commandFor(workspace, script);
  return spawn(command.command, command.args, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: "inherit",
  });
}

async function run(workspace, script) {
  const child = start(workspace, script);
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  if (result.code !== 0) {
    throw new Error(`${workspace} ${script} failed with ${result.code ?? result.signal ?? "unknown status"}`);
  }
}

async function runAll(script) {
  for (const workspace of workspaceOrder) await run(workspace, script);
}

async function runDevelopment(workspaces) {
  const children = workspaces.map((workspace) => start(workspace, "dev"));
  let stopping = false;
  const stop = (signal = "SIGTERM") => {
    if (stopping) return;
    stopping = true;
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    }
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  const first = await Promise.race(children.map((child, index) => new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ index, code, signal }));
  })));
  stop();
  await Promise.all(children.map((child) => child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : new Promise((resolve) => child.once("exit", resolve))));
  if (!stopping || (first.code !== 0 && first.signal !== "SIGINT" && first.signal !== "SIGTERM")) {
    throw new Error(`${workspaces[first.index]} dev exited with ${first.code ?? first.signal ?? "unknown status"}`);
  }
}

switch (task) {
  case "build":
    await runAll("build");
    break;
  case "test":
    await run("@cc-assistant/shared", "build");
    await run("@cc-assistant/client", "build");
    await runAll("test");
    break;
  case "typecheck":
    await run("@cc-assistant/shared", "build");
    await run("@cc-assistant/client", "build");
    await runAll("typecheck");
    break;
  case "dev":
    await runDevelopment(["@cc-assistant/daemon", "@cc-assistant/web"]);
    break;
  case "dev:daemon":
    await runDevelopment(["@cc-assistant/daemon"]);
    break;
  case "dev:web":
    await runDevelopment(["@cc-assistant/web"]);
    break;
  case "start":
    await run("@cc-assistant/daemon", "start");
    break;
  default:
    throw new Error(`Unknown workspace task: ${task ?? "(missing)"}`);
}
