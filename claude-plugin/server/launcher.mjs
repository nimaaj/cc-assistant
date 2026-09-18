import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

function defaultDataDir() {
  return process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "cc-assistant")
    : join(homedir(), ".local", "share", "cc-assistant");
}

if (!process.env.CC_ASSISTANT_DATA_DIR) {
  const projectDataDir = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), ".data");
  process.env.CC_ASSISTANT_DATA_DIR = existsSync(join(projectDataDir, "access-token"))
    ? projectDataDir
    : defaultDataDir();
}

await import("./index.mjs");
