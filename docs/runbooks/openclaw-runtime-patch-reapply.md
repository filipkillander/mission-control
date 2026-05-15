# OpenClaw Runtime Patch Reapply Runbook

This runbook keeps the local OpenClaw status/session performance repair durable after an OpenClaw reinstall or update rewrites the installed `dist/` files.

It does not change secrets, providers, model routing, LaunchAgents, gateways, databases, or user assets.

## Scope

- Target OpenClaw version: `2026.5.12`.
- Target install root: `/Users/Lumi/.openclaw/lib/node_modules/openclaw`.
- Patch bundle: `ops/openclaw-runtime-patches/2026.5.12/`.
- Reapply command: `node scripts/openclaw-runtime-patch.cjs`.

## Safety Model

The script refuses to write unless all of these are true:

- `openclaw --version` contains `2026.5.12`.
- Every patch asset checksum matches `manifest.json`.
- Each installed target file is either already patched or matches a known pre-patch checksum.
- A backup directory can be created under `/Users/Lumi/.openclaw/backups/`.

If any installed file has an unknown checksum, the script stops and leaves the runtime untouched.

## Check Only

```bash
node scripts/openclaw-runtime-patch.cjs --check
```

Expected healthy output when the runtime already contains the patch:

```text
openclaw-runtime-status-session-repair: check
OpenClaw: OpenClaw 2026.5.12 (...)
- dist/sessions-B5dzJVcm.js: already-patched
- dist/commands/status.summary.runtime.js: already-patched
- dist/status-text-DPhaA3Qf.js: already-patched
- dist/agent-runtime-label-BMN3Hrxm.js: already-patched
- dist/model-selection-cli-CT4Mltpu.js: already-patched
- dist/plugin-metadata-snapshot-DlaHO4z7.js: already-patched
```

## Reapply

Run this only after an OpenClaw update/reinstall has made `openclaw status` or `openclaw sessions` slow again and `--check` reports `needs-apply`.

```bash
node scripts/openclaw-runtime-patch.cjs --apply
```

The script creates a timestamped backup before copying patched files, then runs:

```bash
openclaw status --json --timeout 3000
openclaw sessions --json --limit 1
```

Use `--no-probe` only if OpenClaw is intentionally offline and the file reapply itself is the only required action.

## Rollback

Each apply run writes backups here:

```text
/Users/Lumi/.openclaw/backups/runtime-patch-reapply-YYYYMMDD-HHMMSS/
```

To roll back one target, copy the matching backup file back to its original path. The backup filenames replace `/` with `__`, for example:

```text
dist__sessions-B5dzJVcm.js
dist__commands__status.summary.runtime.js
```

## When Not To Use

Do not use this bundle if:

- OpenClaw version is no longer `2026.5.12`.
- The installed target file has an unknown checksum.
- The official OpenClaw package has fixed the status/session performance issue.
- The intended change involves model routing, auth, providers, gateway restart, or LaunchAgent plist changes.

In those cases, create a new versioned patch bundle or upstream the repair instead.
