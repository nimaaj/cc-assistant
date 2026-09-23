#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const controllerSettings = resolve(projectRoot, ".claude/controller.settings.json");
export const sandboxSettings = resolve(projectRoot, ".claude/controller-sandbox.settings.json");
export const bootstrapPrompt = [
  "Enter cc-assistant controller mode.",
  "Use the controller operating guide loaded from the project instructions.",
  "Initialize from durable state using read-only cc-assistant tools, give a compact orientation, and then wait for my direction.",
  "Do not mutate state merely because this session started.",
].join(" ");

export function usage() {
  return `Start Claude Code as the cc-assistant controller.

Usage:
  node scripts/start-controller.mjs [--background] [--permission-mode <mode>]
                                    [--controller-name <name>] [--sandbox]
                                    [--no-bootstrap] [--dry-run] [-- <claude args>]

Options:
  --background    Start a named background Claude Code session. Claude prints a short ID;
                  use "claude attach <id>" for the full interactive terminal.
  --permission-mode <mode>
                  manual, auto, or bypassPermissions. Bypass removes Claude's permission
                  prompts and should be used only in a separately isolated environment.
  --controller-name <name>
                  Override the validated Claude display name used by runtime recipes.
  --sandbox       Use strict built-in Bash sandboxing. Sandbox startup failure is fatal,
                  and Claude cannot retry a blocked command outside the sandbox.
  --no-bootstrap  Start the session without sending the controller initialization prompt.
  --dry-run       Print the resolved executable, arguments, and working directory as JSON.
  --help          Show this help.

Unrecognized options are forwarded to Claude Code. A -- separator is optional when invoking the
script directly and conventional when invoking it through a package manager.

Examples:
  pnpm controller
  pnpm controller:bg --permission-mode auto
  pnpm controller:bg:bypass
  pnpm controller:sandbox
  pnpm controller:sandbox -- --model opus --effort high
  npm run controller
  npm run controller:bg -- --permission-mode auto
  npm run controller:sandbox -- --model opus --effort high
`;
}

async function writeStdout(value) {
  await new Promise((resolveWrite) => process.stdout.write(value, resolveWrite));
}

export function buildControllerLaunch(input, identity = { now: Date.now(), pid: process.pid }) {
  let sandbox = false;
  let background = false;
  let permissionMode = "auto";
  let controllerNameOverride;
  let noBootstrap = false;
  let dryRun = false;
  let help = false;
  let passthrough = [];

  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (value === "--") {
      passthrough = [...passthrough, ...input.slice(index + 1)];
      break;
    }
    if (value === "--sandbox") sandbox = true;
    else if (value === "--background" || value === "--bg") background = true;
    else if (value === "--permission-mode") {
      const candidate = input[index + 1];
      if (!["manual", "auto", "bypassPermissions"].includes(candidate)) {
        throw new Error("--permission-mode must be manual, auto, or bypassPermissions");
      }
      permissionMode = candidate;
      index += 1;
    }
    else if (value === "--controller-name") {
      const candidate = input[index + 1];
      if (!candidate || !/^[A-Za-z0-9_-]{1,120}$/.test(candidate)) {
        throw new Error("--controller-name must contain only letters, numbers, underscores, or hyphens");
      }
      controllerNameOverride = candidate;
      index += 1;
    }
    else if (value === "--no-bootstrap") noBootstrap = true;
    else if (value === "--dry-run") dryRun = true;
    else if (value === "--help" || value === "-h") help = true;
    else passthrough.push(value);
  }

  const args = [];
  const settings = sandbox ? sandboxSettings : controllerSettings;
  if (background) args.push("--bg");
  const baseName = controllerNameOverride ?? (sandbox ? "cc-assistant-controller-sandbox" : "cc-assistant-controller");
  const controllerName = background
    ? `${baseName}-${identity.now.toString(36)}-${identity.pid.toString(36)}`
    : baseName;
  args.push("--name", controllerName);
  args.push("--settings", settings);
  args.push("--permission-mode", permissionMode);
  args.push(...passthrough);
  if (!noBootstrap) args.push(bootstrapPrompt);

  return { command: "claude", args, cwd: projectRoot, settings, sandbox, background, permissionMode, controllerName, dryRun, help };
}

export async function main(input = process.argv.slice(2)) {
  const launch = buildControllerLaunch(input);
  if (launch.help) {
    await writeStdout(usage());
    return;
  }

  await access(launch.settings);
  if (launch.dryRun) {
    await writeStdout(`${JSON.stringify(launch, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    `Starting ${launch.background ? "background " : ""}cc-assistant controller in ${launch.permissionMode} mode${launch.sandbox ? " with strict Bash sandboxing" : ""}.\n` +
    (launch.background ? "Claude will print a short session ID. Attach with: claude attach <id>\n" : ""),
  );

  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: process.env,
    shell: false,
    stdio: "inherit",
  });

  child.on("error", (error) => {
    process.stderr.write(`Unable to start Claude Code: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.stderr.write(`Claude Code exited after signal ${signal}.\n`);
      process.exitCode = 1;
      return;
    }
    process.exitCode = code ?? 1;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
