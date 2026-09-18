import { writeSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const args = new Set(process.argv.slice(2));
const help = args.has("--help") || args.has("-h");
const remove = args.has("--remove");
const unknown = [...args].filter((argument) => !["--help", "-h", "--remove"].includes(argument));

if (help) {
  writeSync(1, `Install cc-assistant session-monitoring hooks in ~/.claude/settings.json.

Usage:
  node scripts/install-global-claude-hooks.mjs
  node scripts/install-global-claude-hooks.mjs --remove

Options:
  --remove  Remove only cc-assistant hooks.
  --help    Show this message without changing files.\n`);
  process.exit(0);
}

if (unknown.length) {
  writeSync(2, `Unknown option: ${unknown[0]}\n`);
  process.exit(2);
}
const projectRoot = resolve(import.meta.dirname, "..");
const settingsPath = join(homedir(), ".claude", "settings.json");
const hookScript = join(projectRoot, "scripts", "claude-hook.mjs");
const dataDir = join(projectRoot, ".data");
const marker = "cc-assistant/scripts/claude-hook.mjs";
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const command = `CC_ASSISTANT_DATA_DIR=${shellQuote(dataDir)} node ${shellQuote(hookScript)}`;
const eventNames = [
  "SessionStart", "UserPromptSubmit", "PermissionRequest", "Notification",
  "SubagentStart", "SubagentStop", "Stop", "StopFailure", "SessionEnd",
];

let settings = {};
try { settings = JSON.parse(await readFile(settingsPath, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
settings.hooks ??= {};

for (const eventName of eventNames) {
  const entries = Array.isArray(settings.hooks[eventName]) ? settings.hooks[eventName] : [];
  const filtered = entries.filter((entry) => !JSON.stringify(entry).includes(marker));
  if (!remove) filtered.push({ hooks: [{ type: "command", command, timeout: 3 }] });
  if (filtered.length) settings.hooks[eventName] = filtered;
  else delete settings.hooks[eventName];
}

await mkdir(dirname(settingsPath), { recursive: true, mode: 0o700 });
try { await copyFile(settingsPath, `${settingsPath}.cc-assistant-backup`); } catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const temporary = `${settingsPath}.cc-assistant-tmp`;
await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
await rename(temporary, settingsPath);
console.log(`${remove ? "Removed" : "Installed"} cc-assistant hooks in ${settingsPath}`);
