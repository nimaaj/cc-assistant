import { constants, accessSync, existsSync, readFileSync, statSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const help = args.has("--help") || args.has("-h");
const json = args.has("--json");
const offline = args.has("--offline");
const allowed = new Set(["--help", "-h", "--json", "--offline"]);
const unknown = [...args].filter((argument) => !allowed.has(argument));

if (help) {
  writeSync(1, `Usage: pnpm assistant:doctor [--json] [--offline]

Runs read-only readiness checks for cc-assistant. The default mode checks the
local daemon and authenticated browser-worker status. --offline skips daemon
connections so packaging can be inspected before the service starts.\n`);
  process.exit(0);
}
if (unknown.length) {
  writeSync(2, `Unknown option: ${unknown[0]}\n`);
  process.exit(2);
}

const projectRoot = resolve(import.meta.dirname, "..");
const defaultDataDir = process.platform === "darwin"
  ? join(homedir(), "Library", "Application Support", "cc-assistant")
  : join(homedir(), ".local", "share", "cc-assistant");
const dataDir = resolve(process.env.CC_ASSISTANT_DATA_DIR ?? join(projectRoot, ".data"));
const tokenPath = join(dataDir, "access-token");
const daemonUrl = process.env.CC_ASSISTANT_DAEMON_URL ?? "http://127.0.0.1:4317";
const checks = [];

function add(id, status, summary, remediation) {
  checks.push({ id, status, summary, ...(remediation ? { remediation } : {}) });
}

function executable(name) {
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch { /* Continue searching PATH. */ }
  }
  return undefined;
}

function atLeast(version, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    const actual = version[index] ?? 0;
    const expected = minimum[index] ?? 0;
    if (actual !== expected) return actual > expected;
  }
  return true;
}

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
const supportedNode = nodeMajor >= 24 && nodeMajor < 27;
add("node", supportedNode ? "pass" : "fail", `Node ${process.versions.node}`,
  supportedNode ? undefined : "Install a Node.js release in the supported >=24 <27 range.");

const requiredArtifacts = [
  "apps/daemon/dist/index.js", "apps/mcp/dist/index.js", "apps/cli/dist/index.js",
  "apps/web/dist/index.html", "claude-plugin/server/index.mjs",
];
const missingArtifacts = requiredArtifacts.filter((path) => !existsSync(join(projectRoot, path)));
add("build", missingArtifacts.length === 0 ? "pass" : "fail",
  missingArtifacts.length === 0 ? "All runtime artifacts are built" : `Missing: ${missingArtifacts.join(", ")}`,
  missingArtifacts.length === 0 ? undefined : "Run pnpm build && pnpm plugin:build.");

const pluginManifest = existsSync(join(projectRoot, "claude-plugin", ".claude-plugin", "plugin.json"));
add("plugin", pluginManifest ? "pass" : "fail", "Claude Code plugin manifest",
  pluginManifest ? undefined : "Restore claude-plugin/.claude-plugin/plugin.json.");

const claudePath = executable("claude");
if (claudePath) {
  const version = spawnSync(claudePath, ["--version"], { encoding: "utf8", timeout: 5_000 });
  const label = version.stdout.trim() || `Claude CLI at ${claudePath}`;
  const match = label.match(/(\d+)\.(\d+)\.(\d+)/);
  const supported = version.status === 0 && match !== null && atLeast(match.slice(1).map(Number), [2, 1, 257]);
  add("claude", supported ? "pass" : "fail", version.status === 0 ? label : "Claude CLI did not start",
    supported ? undefined : "Install Claude Code 2.1.257 or newer and verify claude --version.");
} else {
  add("claude", "fail", "Claude CLI was not found on PATH", "Install Claude Code and ensure claude is on PATH.");
}

let token;
try {
  token = readFileSync(tokenPath, "utf8").trim();
  const mode = statSync(tokenPath).mode & 0o777;
  const safeMode = process.platform === "win32" || (mode & 0o077) === 0;
  add("token", token.length >= 32 && safeMode ? "pass" : "fail",
    token.length < 32 ? `Access token at ${tokenPath} is too short` : safeMode ? `Access token is private (${mode.toString(8)})` : `Access token permissions are too broad (${mode.toString(8)})`,
    token.length >= 32 && safeMode ? undefined : "Start the daemon to regenerate the token and restrict it to the current user.");
} catch {
  add("token", offline ? "warn" : "fail", `No access token at ${tokenPath}`,
    "Start the daemon once, or set CC_ASSISTANT_DATA_DIR to the service data directory.");
}

if (offline) {
  add("daemon", "skip", "Daemon checks skipped by --offline");
  add("dashboard", "skip", "Production dashboard check skipped by --offline");
  add("browser", "skip", "Browser-worker checks skipped by --offline");
} else {
  try {
    const health = await fetch(new URL("/api/health", daemonUrl), { signal: AbortSignal.timeout(3_000) });
    const payload = await health.json();
    add("daemon", health.ok && payload.ok === true ? "pass" : "fail",
      health.ok ? `Daemon ${payload.version ?? "unknown"} at ${daemonUrl}` : `Daemon returned HTTP ${health.status}`,
      health.ok ? undefined : "Start pnpm dev:daemon and verify CC_ASSISTANT_DAEMON_URL.");
  } catch {
    add("daemon", "fail", `Daemon is unavailable at ${daemonUrl}`, "Start pnpm dev:daemon and verify the loopback URL.");
  }

  try {
    const response = await fetch(new URL("/", daemonUrl), { signal: AbortSignal.timeout(3_000) });
    const body = await response.text();
    const ready = response.ok && response.headers.get("content-type")?.includes("text/html") === true && body.includes('id="root"');
    add("dashboard", ready ? "pass" : "fail",
      ready ? `Built dashboard is served at ${daemonUrl}` : "Daemon is not serving the built dashboard",
      ready ? undefined : "Run pnpm build and restart the daemon.");
  } catch {
    add("dashboard", "fail", "Could not load the production dashboard", "Run pnpm build and restart the daemon.");
  }

  if (token) {
    try {
      const response = await fetch(new URL("/api/browser/status", daemonUrl), {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3_000),
      });
      const status = await response.json();
      const ready = response.ok && status.enabled === true && ["ready", "running"].includes(status.state);
      add("browser", ready ? "pass" : "warn",
        response.ok ? `Claude-in-Chrome worker is ${status.enabled ? status.state : "disabled"}` : `Browser status returned HTTP ${response.status}`,
        ready ? undefined : "Enable the browser worker and keep signed-in Calendar and Slack tabs available to Claude in Chrome.");
    } catch {
      add("browser", "warn", "Could not read authenticated browser-worker status", "Verify the token data directory and running daemon.");
    }
  } else {
    add("browser", "skip", "Browser-worker status requires the local access token");
  }
}

if (process.platform === "darwin") {
  const missing = ["osascript", "xcrun", "launchctl"].filter((name) => !executable(name));
  add("native", missing.length === 0 ? "pass" : "fail",
    missing.length === 0 ? "macOS native tooling is available" : `Missing macOS tools: ${missing.join(", ")}`,
    missing.length === 0 ? undefined : "Install Xcode Command Line Tools and use a standard macOS environment.");
  const watcher = join(dataDir, "bin", "notification-watcher");
  add("macos-services", existsSync(watcher) ? "pass" : "warn",
    existsSync(watcher) ? `Notification watcher installed at ${watcher}` : "Notification watcher is not installed",
    existsSync(watcher) ? undefined : "Run pnpm macos:services:install, then grant Accessibility permission.");
} else if (process.platform === "linux") {
  const clipboard = executable("wl-paste") ?? executable("xclip");
  add("native", clipboard ? "pass" : "warn",
    clipboard ? `Linux clipboard adapter available via ${clipboard}` : "Neither wl-paste nor xclip is installed",
    clipboard ? undefined : "Install wl-clipboard (Wayland) or xclip (X11) for clipboard image reads.");
  add("notifications", executable("notify-send") ? "pass" : "warn", "Linux desktop notification helper",
    executable("notify-send") ? undefined : "Install libnotify for visible desktop reminders.");
} else {
  add("native", "warn", `Native helpers are not implemented for ${process.platform}`);
}

const report = {
  ok: checks.every((check) => check.status !== "fail"),
  platform: process.platform,
  projectRoot,
  dataDir,
  checks,
};

if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const icons = { pass: "✓", warn: "!", fail: "✗", skip: "-" };
  for (const check of checks) {
    process.stdout.write(`${icons[check.status] ?? "?"} ${check.id}: ${check.summary}\n`);
    if (check.remediation && check.status !== "pass") process.stdout.write(`  ${check.remediation}\n`);
  }
  process.stdout.write(report.ok ? "cc-assistant is ready.\n" : "cc-assistant needs attention.\n");
}
process.exitCode = report.ok ? 0 : 1;
