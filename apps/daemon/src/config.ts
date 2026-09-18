import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

export interface DaemonConfig {
  host: string;
  port: number;
  dataDir: string;
  databasePath: string;
  accessToken: string;
  accessTokenPath: string;
  allowedRoots: string[];
  managedAgent?: {
    useClaudeLogin: boolean;
  };
  browser?: {
    enabled: boolean;
    useClaudeLogin: boolean;
    model: string;
    effort: "low" | "medium" | "high";
    maxTurns: number;
    maxBudgetUsd: number;
  };
}

function booleanEnvironment(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  throw new Error(`Expected a boolean environment value, received: ${value}`);
}

function boundedNumber(name: string, value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function defaultDataDir(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "cc-assistant");
  }

  return join(homedir(), ".local", "share", "cc-assistant");
}

function loadOrCreateToken(tokenPath: string): string {
  try {
    const existing = readFileSync(tokenPath, "utf8").trim();
    if (existing.length >= 32) return existing;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }

  const token = randomBytes(32).toString("base64url");
  mkdirSync(dirname(tokenPath), { recursive: true, mode: 0o700 });
  writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  return token;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): DaemonConfig {
  const dataDir = resolve(env.CC_ASSISTANT_DATA_DIR ?? defaultDataDir());
  const accessTokenPath = join(dataDir, "access-token");
  const port = Number.parseInt(env.CC_ASSISTANT_PORT ?? "4317", 10);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("CC_ASSISTANT_PORT must be a valid TCP port");
  }

  mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  const allowedRoots = (env.CC_ASSISTANT_ALLOWED_ROOTS ?? env.INIT_CWD ?? process.cwd())
    .split(delimiter)
    .filter(Boolean)
    .map((root) => resolve(root));

  return {
    host: env.CC_ASSISTANT_HOST ?? "127.0.0.1",
    port,
    dataDir,
    databasePath: join(dataDir, "assistant.sqlite"),
    accessToken: env.CC_ASSISTANT_TOKEN ?? loadOrCreateToken(accessTokenPath),
    accessTokenPath,
    allowedRoots,
    managedAgent: {
      useClaudeLogin: booleanEnvironment(env.CC_ASSISTANT_AGENT_USE_CLAUDE_LOGIN, true),
    },
    browser: {
      enabled: booleanEnvironment(env.CC_ASSISTANT_BROWSER_ENABLED, true),
      useClaudeLogin: booleanEnvironment(env.CC_ASSISTANT_BROWSER_USE_CLAUDE_LOGIN, true),
      model: env.CC_ASSISTANT_BROWSER_MODEL ?? "sonnet",
      effort: env.CC_ASSISTANT_BROWSER_EFFORT === "medium" || env.CC_ASSISTANT_BROWSER_EFFORT === "high"
        ? env.CC_ASSISTANT_BROWSER_EFFORT
        : "low",
      maxTurns: Math.trunc(boundedNumber("CC_ASSISTANT_BROWSER_MAX_TURNS", env.CC_ASSISTANT_BROWSER_MAX_TURNS, 12, 1, 50)),
      maxBudgetUsd: boundedNumber("CC_ASSISTANT_BROWSER_MAX_BUDGET_USD", env.CC_ASSISTANT_BROWSER_MAX_BUDGET_USD, 0.5, 0.01, 10),
    },
  };
}
