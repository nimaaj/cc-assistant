#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const sandboxSettings = resolve(projectRoot, ".claude/controller-sandbox.settings.json");
export const bootstrapPrompt = [
  "Enter cc-assistant controller mode.",
  "Use the controller operating guide loaded from the project instructions.",
  "Initialize from durable state using read-only cc-assistant tools, give a compact orientation, and then wait for my direction.",
  "Do not mutate state merely because this session started.",
].join(" ");

export function usage() {
  return `Start an interactive Claude Code session as the cc-assistant controller.

Usage:
  node scripts/start-controller.mjs [--sandbox] [--no-bootstrap] [--dry-run] [-- <claude args>]

Options:
  --sandbox       Use strict built-in Bash sandboxing. Sandbox startup failure is fatal,
                  and Claude cannot retry a blocked command outside the sandbox.
  --no-bootstrap  Start the session without sending the controller initialization prompt.
  --dry-run       Print the resolved executable, arguments, and working directory as JSON.
  --help          Show this help.

Unrecognized options are forwarded to Claude Code. A -- separator is optional when invoking the
script directly and conventional when invoking it through pnpm.

Examples:
  pnpm controller
  pnpm controller:sandbox
  pnpm controller:sandbox -- --model opus --effort high
`;
}

async function writeStdout(value) {
  await new Promise((resolveWrite) => process.stdout.write(value, resolveWrite));
}

export function buildControllerLaunch(input) {
  let sandbox = false;
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
    else if (value === "--no-bootstrap") noBootstrap = true;
    else if (value === "--dry-run") dryRun = true;
    else if (value === "--help" || value === "-h") help = true;
    else passthrough.push(value);
  }

  const args = ["--name", sandbox ? "cc-assistant-controller-sandbox" : "cc-assistant-controller"];
  if (sandbox) args.push("--settings", sandboxSettings);
  args.push(...passthrough);
  if (!noBootstrap) args.push(bootstrapPrompt);

  return { command: "claude", args, cwd: projectRoot, sandbox, dryRun, help };
}

export async function main(input = process.argv.slice(2)) {
  const launch = buildControllerLaunch(input);
  if (launch.help) {
    await writeStdout(usage());
    return;
  }

  if (launch.sandbox) await access(sandboxSettings);
  if (launch.dryRun) {
    await writeStdout(`${JSON.stringify(launch, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    launch.sandbox
      ? "Starting cc-assistant controller with strict Claude Code Bash sandboxing.\n"
      : "Starting cc-assistant controller with normal Claude Code permissions.\n",
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
