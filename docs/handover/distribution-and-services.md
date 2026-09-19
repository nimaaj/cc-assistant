# Handover: distribution and cross-platform services

**Status:** Productization. Today cc-assistant is installed from a source checkout. macOS has a per-user LaunchAgent installer; Linux and Windows do not have managed service installers.

## Goal

Produce versioned, reversible installations that keep daemon state and client configuration consistent across upgrades without requiring a developer checkout.

## Current assumptions to remove

- package scripts resolve runtime artifacts relative to the monorepo;
- the repository-local `.data` directory is the common development default;
- the plugin bundle is built separately from the workspace build;
- global hooks can point to scripts inside a movable checkout;
- the macOS LaunchAgents point directly to the current Node executable and checkout;
- Linux users must provide their own supervisor;
- there is no release archive, checksum manifest, upgrade command, or rollback workflow.

## Recommended artifact layout

Create one relocatable application directory per version:

```text
cc-assistant-<version>/
  bin/cca
  daemon/index.js
  mcp/index.js
  web/
  claude-plugin/
  native/<platform>/
  package.json
  THIRD_PARTY_NOTICES
```

Keep mutable state outside this directory in the platform application-data location. Service definitions should point through a stable `current` symlink or launcher so upgrades do not edit several files independently.

## Build pipeline

1. use a clean checkout and the pinned Node/pnpm versions;
2. install with `--frozen-lockfile`;
3. run tests, typecheck, workspace build, plugin build, and plugin validation;
4. assemble only runtime dependencies and artifacts;
5. generate an artifact manifest with version, commit, platform, architecture, and hashes;
6. smoke-start the artifact with a temporary data directory;
7. verify dashboard assets and MCP tool discovery;
8. sign or attest release artifacts where supported;
9. publish checksums and release notes.

Do not package `.data`, tokens, local logs, test profiles, or signed-in browser state.

## Installer responsibilities

An installer should:

- choose a versioned application directory and stable data directory;
- verify artifact checksums before activation;
- create user-only data-directory permissions;
- generate the access token by starting the daemon, not by printing one into logs;
- install a per-user service, never a system-wide root daemon by default;
- install MCP/plugin configuration using absolute stable paths;
- preserve and back up existing host configuration;
- run an offline and online doctor;
- print exact rollback and removal instructions;
- avoid deleting data on uninstall unless the user separately confirms it.

## Linux user service

Add a systemd user unit when systemd is available:

```ini
[Unit]
Description=cc-assistant local daemon
After=default.target

[Service]
ExecStart=/absolute/stable/path/cc-assistant-daemon
Environment=CC_ASSISTANT_DATA_DIR=%h/.local/share/cc-assistant
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

The actual generator must quote paths safely, preserve configured allowed roots, and use `systemctl --user`. Provide a non-systemd fallback document rather than installing a root service.

A Linux notification-observation adapter is a separate product decision. Reminder delivery already uses `notify-send`; observing arbitrary desktop notifications is not implemented.

## macOS improvements

Retain the current per-user LaunchAgent model, but change generated plists to stable installed launchers rather than checkout paths. Upgrades must compile or replace the native watcher before atomically activating the new version.

The installer must preserve Accessibility guidance because permissions may be tied to a binary path/signature. Test whether upgrades retain permission; if they do not, show remediation before restarting repeatedly.

## Windows scope

Choose and document one supported first environment:

- WSL for the core daemon/MCP/CLI/web stack; or
- a native per-user process plus Windows notification/clipboard adapters.

Do not claim native Windows feature parity until service startup, filesystem permissions, clipboard images, visible notifications, path delimiters, process cancellation, and Claude host integration have automated and physical-host evidence.

## Upgrade transaction

1. download and verify the new artifact;
2. run database backup using SQLite's online backup API or stop the old daemon;
3. stage the new version beside the old version;
4. run offline checks;
5. stop the service;
6. atomically switch the stable launcher/path;
7. start and run health/schema/MCP checks;
8. retain the previous artifact for rollback;
9. remove old artifacts only after a retention period.

Database migrations need an explicit compatibility policy. Once a migration is not backward-compatible, binary rollback also requires restoring the pre-upgrade database backup.

## CLI and plugin packaging

The installed `cca` launcher must discover the same platform data directory as the daemon. The MCP launcher must do the same or receive an explicit absolute path. Add version output to the daemon, CLI, MCP, plugin manifest, and doctor so mismatches are diagnosable.

Avoid globally installing the entire source workspace through npm. Produce a deliberate artifact with only required files and licenses.

## Test matrix

- clean install on supported OS/architecture combinations;
- paths containing spaces and non-ASCII characters;
- user-only permissions on state and token;
- start at login and restart on failure;
- port conflict and stale process handling;
- upgrade with existing tasks, memories, schedules, and approvals;
- interrupted upgrade and rollback;
- plugin/MCP/daemon version mismatch diagnostics;
- uninstall preserves data by default;
- service logs do not contain access tokens;
- macOS Accessibility behavior after upgrade;
- Linux systemd user service enable/disable/remove;
- release archive contains no local state or credentials.

## Definition of done

- a user can install from a signed/checksummed release without a source checkout;
- the daemon, CLI, MCP, plugin, and service share one data-directory decision;
- upgrades are backup-aware and reversible;
- uninstallation is non-destructive by default;
- macOS and Linux per-user services have automated and physical-host checks;
- unsupported Windows/native features are stated precisely;
- version mismatch diagnostics are actionable;
- release documentation and security notes match the artifact.
