import { existsSync, writeSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const remove = args.has("--remove");
const dryRun = args.has("--dry-run");
const help = args.has("--help") || args.has("-h");

if (help) {
  writeSync(1, `Usage: node scripts/install-macos-services.mjs [--dry-run | --remove]

Installs per-user launchd services for the cc-assistant daemon and macOS
Notification Center watcher. Run pnpm build or npm run build first. --dry-run prints the
generated plists without changing the machine.\n`);
  process.exit(0);
}

const projectRoot = resolve(import.meta.dirname, "..");
const dataDir = resolve(process.env.CC_ASSISTANT_DATA_DIR ?? join(projectRoot, ".data"));
const launchAgentsDir = join(homedir(), "Library", "LaunchAgents");
const daemonLabel = "com.cc-assistant.daemon";
const watcherLabel = "com.cc-assistant.notification-watcher";
const daemonPlistPath = join(launchAgentsDir, `${daemonLabel}.plist`);
const watcherPlistPath = join(launchAgentsDir, `${watcherLabel}.plist`);
const daemonEntry = join(projectRoot, "apps", "daemon", "dist", "index.js");
const watcherSource = join(projectRoot, "native", "macos", "notification-watcher.swift");
const watcherBinary = join(dataDir, "bin", "notification-watcher");
const daemonUrl = process.env.CC_ASSISTANT_DAEMON_URL ?? "http://127.0.0.1:4317";
const allowedRoots = process.env.CC_ASSISTANT_ALLOWED_ROOTS ?? projectRoot;
const userDomain = `gui/${process.getuid?.() ?? "unknown"}`;

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function plist({ label, programArguments, environment = {}, stdout, stderr, keepAlive = true }) {
  const argumentsXml = programArguments.map((value) => `      <string>${xml(value)}</string>`).join("\n");
  const environmentXml = Object.entries(environment)
    .map(([key, value]) => `      <key>${xml(key)}</key>\n      <string>${xml(value)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${argumentsXml}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(projectRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${environmentXml}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <${keepAlive ? "true" : "false"}/>
  <key>StandardOutPath</key>
  <string>${xml(stdout)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(stderr)}</string>
</dict>
</plist>
`;
}

const daemonPlist = plist({
  label: daemonLabel,
  programArguments: [process.execPath, daemonEntry],
  environment: {
    NODE_ENV: "production",
    CC_ASSISTANT_DATA_DIR: dataDir,
    CC_ASSISTANT_ALLOWED_ROOTS: allowedRoots,
  },
  stdout: join(dataDir, "daemon.log"),
  stderr: join(dataDir, "daemon.error.log"),
});

const watcherPlist = plist({
  label: watcherLabel,
  programArguments: [watcherBinary, "--daemon", daemonUrl, "--token-file", join(dataDir, "access-token")],
  environment: {},
  stdout: join(dataDir, "notification-watcher.log"),
  stderr: join(dataDir, "notification-watcher.error.log"),
});

function launchctl(command, plistPath, tolerateFailure = false) {
  const result = spawnSync("launchctl", [command, userDomain, plistPath], { encoding: "utf8" });
  if (!tolerateFailure && result.status !== 0) {
    throw new Error(result.stderr.trim() || `launchctl ${command} failed with exit ${result.status}`);
  }
}

if (dryRun) {
  writeSync(1, `# ${daemonPlistPath}\n${daemonPlist}\n# ${watcherPlistPath}\n${watcherPlist}`);
  process.exit(0);
}

if (process.platform !== "darwin") throw new Error("macOS LaunchAgents can only be installed on macOS; use --dry-run to inspect them");

if (remove) {
  launchctl("bootout", daemonPlistPath, true);
  launchctl("bootout", watcherPlistPath, true);
  await rm(daemonPlistPath, { force: true });
  await rm(watcherPlistPath, { force: true });
  await rm(watcherBinary, { force: true });
  console.log("Removed cc-assistant macOS user services");
  process.exit(0);
}

if (!existsSync(daemonEntry)) throw new Error(`Missing ${daemonEntry}; run pnpm build or npm run build first`);
await mkdir(dirname(watcherBinary), { recursive: true, mode: 0o700 });
await mkdir(launchAgentsDir, { recursive: true, mode: 0o700 });
const compile = spawnSync("xcrun", ["swiftc", "-O", watcherSource, "-o", watcherBinary], { encoding: "utf8" });
if (compile.status !== 0) throw new Error(compile.stderr.trim() || `Could not compile ${watcherSource}`);
await writeFile(daemonPlistPath, daemonPlist, { mode: 0o600 });
await writeFile(watcherPlistPath, watcherPlist, { mode: 0o600 });
launchctl("bootout", daemonPlistPath, true);
launchctl("bootout", watcherPlistPath, true);
launchctl("bootstrap", daemonPlistPath);
launchctl("bootstrap", watcherPlistPath);
console.log(`Installed ${daemonLabel} and ${watcherLabel}. Grant Accessibility access to ${watcherBinary}, then restart the watcher service.`);
