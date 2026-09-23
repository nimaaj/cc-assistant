import { describe, expect, it } from "vitest";
import { RuntimeControlSchema } from "@cc-assistant/shared";
// @ts-expect-error The executable is intentionally plain ESM and is exercised directly here.
import { loadRecipe, validateRecipe, validateSlashCommand } from "../../../scripts/runtime-recipe.mjs";

describe("runtime recipes", () => {
  it("loads the committed default tmux recipe", async () => {
    const recipe = await loadRecipe("default", { CC_ASSISTANT_DATA_DIR: "/tmp/cc-assistant-no-runtime-override" });
    expect(recipe.dispatcherPermissionMode).toBe("auto");
    expect(recipe.dispatcherTeammateMode).toBe("tmux");
    expect(recipe.tmuxSession).toBe("cc-assistant");
  });

  it("rejects unsafe tmux identifiers and arbitrary slash commands", () => {
    expect(() => validateRecipe({ version: 1, id: "default", name: "x", description: "", tmuxSession: "x; rm", daemonWindow: "daemon", dispatcherWindow: "dispatcher", dispatcherName: "controller", dispatcherPermissionMode: "auto", dispatcherSandbox: false, dispatcherTeammateMode: "tmux", dispatcherModel: null, dispatcherEffort: "high", dispatcherRemoteControl: false, autoRepair: true, terminalLauncher: "auto" })).toThrow("tmuxSession");
    expect(validateSlashCommand("/compact keep recent decisions")).toBe("/compact keep recent decisions");
    expect(() => validateSlashCommand("/exit")).toThrow("Unsupported");
    expect(() => validateSlashCommand("/compact\nwhoami")).toThrow("one line");
    expect(() => RuntimeControlSchema.parse({ action: "slash_command", command: "/exit" })).toThrow();
  });
});
