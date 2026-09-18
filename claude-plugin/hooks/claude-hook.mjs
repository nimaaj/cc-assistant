import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function defaultDataDir() {
  return process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "cc-assistant")
    : join(homedir(), ".local", "share", "cc-assistant");
}

function dataDir() {
  if (process.env.CC_ASSISTANT_DATA_DIR) return resolve(process.env.CC_ASSISTANT_DATA_DIR);
  const projectDataDir = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), ".data");
  return existsSync(join(projectDataDir, "access-token")) ? projectDataDir : defaultDataDir();
}

try {
  const token = (await readFile(join(dataDir(), "access-token"), "utf8")).trim();
  const input = await readStdin();
  const endpoint = new URL("/api/hooks/claude", process.env.CC_ASSISTANT_DAEMON_URL ?? "http://127.0.0.1:4317");
  await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-CC-Assistant-Source": "claude-hook",
    },
    body: input,
    signal: AbortSignal.timeout(1_500),
  });
} catch {
  // Observation is best effort and must never interrupt Claude Code.
}
