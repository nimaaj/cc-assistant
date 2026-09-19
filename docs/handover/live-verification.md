# Handover: live verification runbook

**Status:** Verification only. The implementation exists; these checks require external state or macOS hardware and are intentionally excluded from ordinary automated tests.

Record the date, operating system, app versions, account type, result IDs, and cleanup outcome for every run. Never use sensitive production content as test data.

## Baseline

From a clean working tree:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm plugin:build
pnpm plugin:validate
pnpm assistant:doctor --offline
```

Start the production-style daemon, then run:

```bash
pnpm start
pnpm assistant:doctor
pnpm cca status --json
CC_ASSISTANT_DATA_DIR=.data node scripts/mcp-smoke.mjs
```

Save command output with tokens and account content redacted.

## Google Calendar read

Preconditions:

- official Claude-in-Chrome integration installed and signed in;
- a visible signed-in Google Calendar tab;
- a calendar view containing at least one non-sensitive, recognizable test event;
- browser worker enabled and within its configured budget.

Run:

```bash
pnpm smoke:browser:e2e --reads
```

Pass criteria:

- Calendar job reaches `succeeded`;
- result identifies the visible date/view rather than claiming an unverified empty calendar;
- expected test event is represented accurately;
- no shell/file tools are exposed to the browser worker;
- Slack read also passes or is documented separately if unavailable.

## Google Calendar approved write

Use a disposable calendar and an unmistakable title. Choose a short event in the near future and verify the timezone explicitly.

```bash
pnpm smoke:browser:e2e \
  --calendar-event '{"title":"cc-assistant controlled test","start":"2026-09-18T19:00:00Z","end":"2026-09-18T19:15:00Z"}' \
  --slack-channel cc-assistant-test \
  --slack-message 'cc-assistant controlled test' \
  --confirm LIVE_WRITES_APPROVED
```

The guarded script tests both writes together. Adjust the timestamp to a future disposable slot and use only a safe test Slack channel.

Calendar pass criteria:

- an approval exists before execution and shows the exact title/start/end;
- result contains `data.created=true` only after visible confirmation;
- the event exists once, at the correct time and timezone;
- ambiguous calendar/account state fails rather than guessing;
- the tester deletes the event manually after evidence is recorded.

## Slack reads and approved send

Use a workspace where a test message is allowed and a channel whose exact name is unique.

Pass criteria:

- unread/channel reads select the exact workspace/channel;
- an empty result is distinguished from loading, login, or navigation failure;
- send approval displays the exact channel and text;
- result contains `data.sent=true` only after the message is visible;
- exactly one message is sent;
- the tester deletes the message when workspace policy permits.

Do not use a direct message, announcement channel, or similarly named production channel for the first test.

## macOS clipboard image

Preconditions:

- physical macOS host;
- a known PNG copied to the clipboard;
- a known TIFF-only clipboard image for the normalization path.

Run for each sample:

```bash
pnpm cca native clipboard-image --output /tmp/cc-assistant-clipboard.png
file /tmp/cc-assistant-clipboard.png
```

Pass criteria:

- PNG input is reproduced as a readable image;
- TIFF clipboard content is converted to PNG;
- no-image clipboard state returns a clear failure;
- output bytes are returned only to the requesting local client and are not stored in SQLite.

## macOS notification trigger

1. Build and install the user services.
2. Grant Accessibility access to `.data/bin/notification-watcher`.
3. Create a `system_notification` schedule with a narrow application/title/body filter and a safe reminder action.
4. Generate one matching and one non-matching notification.
5. inspect schedule, notification inbox, event log, and watcher logs.

Pass criteria:

- matching notification creates one reminder;
- non-matching notification creates none;
- the cooldown suppresses immediate duplicates;
- a daemon startup/network failure is retried while the banner remains visible;
- no retry loop occurs after successful acknowledgement;
- removing services stops observation cleanly.

## Evidence update

After a successful run:

1. update the relevant row in `docs/completion-audit.md` with date and scope;
2. state whether the account write was cleaned up;
3. record limitations without including private event/message content;
4. add an automated regression test for any defect found;
5. do not convert an account-specific pass into a claim of broad cross-platform compatibility.
