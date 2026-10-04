---
cli: tiktok-cli
target: TikTok Studio web (tiktok.com/tiktokstudio) for the owner's personal account
origin: discovered
terrain: B (website with an internal, signed JSON API) driven through the UI for writes
built: 2026-10-04
status: internal
distribution: source
---

# tiktok-cli

## What it does

`tiktok` / `tt` lists the owner's videos and analytics, triages and replies to comments, and posts, schedules, re-privacies and deletes videos, by driving TikTok Studio in a persistent Chrome profile. Reads parse the JSON Studio already receives; writes click through the UI.

## Contract origin

Discovered. Desk research (`recon/tiktok-landscape.md`) ruled out official APIs for a personal account: posting publicly is audit-gated and comment APIs need a Business account. `surface-recon` (`recon/report.md`) mapped Studio with agent-browser on a secondary account. The classification held. Every useful endpoint is signed (`msToken`, `X-Bogus`, `X-Gnarly`), so no out-of-browser replay and no surfacer IR; the report says so.

Recon was right about the shapes and wrong by omission twice. It recorded `POST /api/comment/publish/` but not the `HEAD` Studio sends to the same path first. It treated rows as a DOM detail not worth mapping, and the build hit both gaps (see What broke).

## Distribution choice

Source only, for the owner. Planned Bun shebang + `bun link`; **switched to Node 22 type stripping** (`#!/usr/bin/env node` on `src/main.ts`, `npm link`) because Bun 1.2.0 on Windows hangs in Playwright `launchPersistentContext`. Writing only against Node APIs made this a one-line change. Bun stays as package manager and test runner.

## Blocks adopted

| Block | Verdict | Reason |
|---|---|---|
| detect, style, banner | adopted | TTY/NO_COLOR, visible-width tables, stderr-only banner |
| xdg-paths | adopted | Windows APPDATA/LOCALAPPDATA split, `TIKTOK_CLI_HOME` override for tests |
| atomic-write | adopted | intents |
| audit-lifecycle | adopted | pending → ok/error/blocked/dry-run, same id |
| killswitch | adopted | converted to a structured `KILLSWITCH` error at the call site |
| argv | hybrid | boolean flags swallowed the next positional (`--json video list`); added a boolean set |
| doctor | hybrid | runner reimplemented; its renderer pulls json-mode |
| json-mode, next-steps, error-map | rejected | conflict with the published envelope (`{ok,data,meta.nextSteps}`, structured error with cause/retryable/logId) |
| trust-ladder | rejected | its non-TTY path tells agents to pass `--yes`; spec forbids self-approval. Replaced by intents approved only from a TTY |
| global-flags, audit-log, session, api-key-wizard, prompt-secret, config, copy-clipboard, open-url, notify-os, telemetry, skill-installer-prompt | rejected | not applicable (browser-profile auth, no secrets, v1 scope) |

Install friction: `bunx --bun` does not resolve packages on this Windows/Bun; `npx shadcn` worked. Blocks landed in `cli/`, not `src/cli/`, and import `./x.js`, which Node type stripping cannot resolve; rewrote to `.ts`.

## Trust ladder

Binary agent mode plus human approval: reads are free. `comment reply`, `video post|update|delete` and `auth logout` either confirm on a TTY or, from an agent, save an intent and fail `APPROVAL_REQUIRED`; `tiktok intent approve <id>` works only on a TTY. Dry-run drives the real form up to the final click. Writes intercept their own outgoing request (`page.route`) and abort unless the payload matches the request (caption, `schedule_time`, `aweme_id`, delete flag). Consent dialogs (scheduled posts) are never clicked by the CLI: `CONSENT_REQUIRED`, or wait for the human with `--headed`.

## What broke

1. **False negative on the first real reply.** The response matcher had no method filter and caught Studio's empty `HEAD` probe; the CLI reported `UI_CHANGED` while the `POST` published the reply. Fix: match `POST`; any failure after the submit keystroke becomes `outcome: "unknown"` with a verify-first hint.
2. **Wrong-row near miss on the first real delete.** Row lookup climbed to "an ancestor with ≥3 buttons"; scheduled rows have fewer, so it reached the table and opened the other video's menu. The `aweme_id` guard aborted the request, nothing was deleted. Fix: TikTok's own `data-tt="components_PostTable_Absolute"` row ids, with a fallback that never crosses another video link.
3. Upload form: Draft.js drops typed characters and crashes on `execCommand('insertText')`; a synthetic `paste` event with `DataTransfer` works and does not touch the OS clipboard.
4. Schedule pickers: the calendar-header regex matched the caption counter `10/4000`; choosing the date after the time resets minutes; the time picker commits whatever is centred when it closes. Fixes: semantic class names, date then time, wait for each value, read back both fields before submitting.
5. Video analytics fires a light `video_info`-only insight request before the full one; matching on `video_info` returned empty analytics half the time.
6. Process: a red test was committed because `bun test | tail` hid the exit code; `sed`/`String.replace` mangled regex backslashes and `$\``. Use the Edit tool for code with regex.

## What I would do differently

- In recon, record **every method** seen on a write endpoint and map row/list identity, not only the request.
- Put the request guard on every write from the first commit. It turned the delete bug into a non-event.
- Probe the runtime (Bun + Playwright on the target OS) in Phase 1, before choosing the shebang.
- Keep account analytics honest about inferred layout (`[prev N][current N][2 pending]`); the populated value shape was never observed on the empty test account.

## Evidence

- Repo: github.com/Jibaru/tiktok-cli (private), 15 commits, one per feature or fix.
- Tests: 32 (`bun test`): envelope/exit codes/no-ANSI/intents/killswitch via the real binary, mappers, schedule validation.
- Live verification on the test account: login via copied recon profile, list/get/stats/inbox, dry-runs of every write, and human-approved real runs of reply (×2), scheduled post and delete.
- Audit: `%APPDATA%\tiktok-cli\audit\YYYY-MM-DD.jsonl`. Debug bundles: `%LOCALAPPDATA%\tiktok-cli\debug\`.
- Build log: `friction.md` in the repo.
