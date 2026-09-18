import { writeSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { DaemonClient } from "../packages/client/dist/index.js";

const CONFIRMATION = "LIVE_WRITES_APPROVED";
const usage = `Run controlled-account Claude-in-Chrome end-to-end checks.

Read-only:
  node scripts/browser-live-e2e.mjs --reads

Live writes (creates one event and sends one Slack message):
  node scripts/browser-live-e2e.mjs \\
    --calendar-event '{"title":"cc-assistant test","start":"2026-09-18T15:00:00Z","end":"2026-09-18T15:15:00Z"}' \\
    --slack-channel cc-assistant-test \\
    --slack-message 'cc-assistant controlled test' \\
    --confirm ${CONFIRMATION}

Options:
  --reads                 Run signed-in Calendar and Slack read checks only.
  --calendar-event JSON   Exact disposable Calendar event to create.
  --slack-channel NAME    Exact controlled Slack channel.
  --slack-message TEXT    Exact message to send once.
  --confirm PHRASE        Must equal ${CONFIRMATION} for live writes.
  --timeout-ms NUMBER     Per-job timeout; default 180000.
  --help                  Show this text without contacting the daemon.

The write mode resolves the two persisted approvals automatically. Use it only
with a disposable calendar event and a Slack channel where a test post is safe.`;

const parsed = parseArgs({
  args: process.argv.slice(2),
  options: {
    reads: { type: "boolean" },
    "calendar-event": { type: "string" },
    "slack-channel": { type: "string" },
    "slack-message": { type: "string" },
    confirm: { type: "string" },
    "timeout-ms": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
  strict: true,
});

if (parsed.values.help) {
  writeSync(1, `${usage}\n`);
  process.exit(0);
}

const writeValues = [parsed.values["calendar-event"], parsed.values["slack-channel"], parsed.values["slack-message"]];
const wantsWrites = writeValues.some((value) => value !== undefined);
if (!parsed.values.reads && !wantsWrites) throw new Error("Choose --reads or supply the complete controlled write inputs. Use --help for examples.");
if (wantsWrites && writeValues.some((value) => value === undefined)) {
  throw new Error("Live write mode requires --calendar-event, --slack-channel, and --slack-message together.");
}
if (wantsWrites && parsed.values.confirm !== CONFIRMATION) {
  throw new Error(`Live writes require --confirm ${CONFIRMATION}`);
}

const timeoutMs = Number(parsed.values["timeout-ms"] ?? "180000");
if (!Number.isInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 900_000) {
  throw new Error("--timeout-ms must be an integer between 10000 and 900000");
}

const projectRoot = resolve(import.meta.dirname, "..");
const client = new DaemonClient({ source: "cli", dataDir: process.env.CC_ASSISTANT_DATA_DIR ?? resolve(projectRoot, ".data") });

async function waitFor(path, select, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = select(await client.request(path));
    if (["succeeded", "failed", "cancelled"].includes(value.status)) {
      if (value.status !== "succeeded") throw new Error(`${label} ${value.status}: ${value.error ?? "no diagnostic"}`);
      return value;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  throw new Error(`${label} did not finish within ${timeoutMs}ms`);
}

async function readCheck(adapter, action) {
  const response = await client.request("/api/browser/jobs", {
    method: "POST", body: JSON.stringify({ adapter, action, input: {} }),
  });
  const job = await waitFor(`/api/browser/jobs/${response.job.id}`, (value) => value.job, `${adapter}:${action}`);
  return { adapter, action, jobId: job.id, status: job.status };
}

async function approvedWrite(adapter, action, input, expectedFlag) {
  const proposal = await client.request("/api/browser/jobs", {
    method: "POST", body: JSON.stringify({ adapter, action, input }),
  });
  await client.request(`/api/approvals/${proposal.approval.id}/resolve`, {
    method: "POST", body: JSON.stringify({ decision: "approved", note: "Controlled live E2E invocation" }),
  });
  const run = await waitFor(`/api/runs/${proposal.run.id}`, (value) => value.run, `${adapter}:${action}`);
  const result = JSON.parse(run.result);
  if (result?.data?.[expectedFlag] !== true) throw new Error(`${adapter}:${action} did not verify ${expectedFlag}=true`);
  return { adapter, action, runId: run.id, status: run.status, verified: expectedFlag };
}

const results = [];
if (parsed.values.reads) {
  results.push(await readCheck("google_calendar", "list_visible_events"));
  results.push(await readCheck("slack", "list_unreads"));
}
if (wantsWrites) {
  const event = JSON.parse(parsed.values["calendar-event"]);
  results.push(await approvedWrite("google_calendar", "create_event", event, "created"));
  results.push(await approvedWrite("slack", "send_message", {
    channelName: parsed.values["slack-channel"], text: parsed.values["slack-message"],
  }, "sent"));
}

writeSync(1, `${JSON.stringify({ ok: true, results }, null, 2)}\n`);
