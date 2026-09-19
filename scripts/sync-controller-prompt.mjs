#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const promptPath = resolve(projectRoot, "prompts/controller.md");
const skillPath = resolve(projectRoot, "claude-plugin/skills/controller/SKILL.md");
const prompt = (await readFile(promptPath, "utf8")).trimEnd();
const skill = `---
name: controller
description: Activate cc-assistant controller mode to coordinate durable tasks, managed agents, approvals, reminders, memory, observed Claude Code sessions, Calendar, Slack, abilities, and assistant state.
disable-model-invocation: true
---

${prompt}
`;

await mkdir(dirname(skillPath), { recursive: true });
await writeFile(skillPath, skill, "utf8");
