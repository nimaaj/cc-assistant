import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const dataDir = mkdtempSync(join(tmpdir(), "cc-assistant-config-"));
  directories.push(dataDir);
  return {
    CC_ASSISTANT_DATA_DIR: dataDir,
    CC_ASSISTANT_TOKEN: "test-token-with-at-least-thirty-two-characters",
    CC_ASSISTANT_ALLOWED_ROOTS: tmpdir(),
    ...overrides,
  };
}

describe("daemon configuration", () => {
  it("keeps browser work bounded with a practical default budget", () => {
    const config = loadConfig(environment());
    expect(config.browser).toMatchObject({
      enabled: true,
      model: "sonnet",
      effort: "low",
      maxTurns: 12,
      maxBudgetUsd: 1,
    });
  });

  it("accepts an explicit lower browser budget", () => {
    const config = loadConfig(environment({ CC_ASSISTANT_BROWSER_MAX_BUDGET_USD: "0.25" }));
    expect(config.browser?.maxBudgetUsd).toBe(0.25);
  });
});
