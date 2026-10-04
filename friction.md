# Friction log — tiktok-cli build

- [phase0] Contract origin: **discovered**. Source: `recon/report.md` (TikTok Studio browser plane). Nothing defined locally except the audit/intent ledger.
- [phase1] Audience: only the owner, from source. Target: Bun shebang + `bun link`, Node APIs only (fs, path, child_process); Playwright is the one runtime dependency.
- [phase3] `bunx --bun <pkg>` fails on Windows with Bun 1.2.0 ('Script not found'); used `npx` for skills/shadcn instead.

## cligentic block decisions (phase 3)

| Block | Decision | Reason |
|---|---|---|
| detect | adopt | TTY/CI/NO_COLOR detection, dep of style/banner |
| style | adopt | NO_COLOR-aware colors + visible-width padding for tables |
| banner | adopt | TTY-only stderr wordmark |
| xdg-paths | adopt | Windows %APPDATA%/%LOCALAPPDATA% split, TIKTOK_CLI_HOME override |
| atomic-write | adopt | intents and config files |
| audit-lifecycle | adopt | exact two-phase pending→ok/error/blocked/dry-run design from spec |
| killswitch | adopt | file-based out-of-band stop; its plain Error is converted to our KILLSWITCH AppError at the call site |
| argv | hybrid | `--json video list` would swallow `video` as the flag value; patched to take a set of boolean flags |
| doctor | hybrid | runDoctor pattern reimplemented (3 lines); its renderDoctor pulls json-mode (rejected) |
| json-mode | reject | emits arrays as NDJSON and `{ok:false,error:string}`; conflicts with published envelope `{ok,data,meta}` / structured error |
| next-steps | reject | writes NDJSON hints to stderr; contract puts `nextSteps` in `meta` |
| error-map | reject | AppError lacks cause/retryable/logId/exit code required by contract; own errors module |
| trust-ladder | reject | non-TTY path tells agents to pass `--yes`; spec forbids agent self-approval (intent + TTY approve instead). Pattern of TTY checks reused |
| global-flags | reject | generic env names (CLI_JSON); flag set defined in contract |
| audit-log | reject | superseded by audit-lifecycle |
| session, api-key-wizard, prompt-secret | reject | auth is a browser profile, no tokens or secrets |
| config | reject (v1) | multi-profile deferred to v2 |
| copy-clipboard | reject | clipboard paste happens inside the browser page |
| open-url, notify-os, telemetry, skill-installer-prompt | reject | not in v1 scope / no telemetry wanted |
- [phase1] **Runtime switched Bun → Node 22 (native type stripping).** Bun 1.2.0 on Windows hangs on Playwright `launchPersistentContext` (probe killed at 90s); identical script on Node 22.22 works. Bun kept as package manager + unit test runner. Bin: `#!/usr/bin/env node` on `src/main.ts`, installed with `npm link`.
- [phase3] Node type stripping needs real `.ts` extensions in relative imports; cligentic blocks import `./x.js`. Rewrote block imports to `.ts`.
- [phase5] Debug bundle network.json redacts csrf/session tokens; trace.zip cannot be redacted (holds cookies) — documented as local-only, never share.
- [feature:video] Video analytics page fires two insight requests with video_info: a light one first (video_info only) and the full one. Match on video_view_realtime, not video_info.
- [feature:video] Realtime insight series (interval 1) are HOURLY: first bucket 16:00Z for a video posted 16:56Z. Inferred from bucket alignment; label says 'hourly points'. Committed one red test by piping bun test into tail (exit code lost) — use `bun test && ...` without pipes before committing.
- [feature:analytics] Account history = array of length 2N+2 ([prev N][current N][2 not final]); entries {status:0,value} when ready, {status:2} when not. Populated shape inferred from follower_num {status:0,value}; NOT observed on a populated account. Range selector is locale-bound text ('Los últimos N días').
- [feature:comments] Reply row is located by exact comment text + author nickname (marker attribute), refusing on 0 or >1 matches; reply echo (reply_id == commentId) is checked before reporting success. 150-char limit is the commonly documented TikTok limit, not observed in recon.
- [process] sed in Git Bash drops backslashes in regex replacements twice now; use the Edit tool for code containing regex.
- [feature:comments] **False negative in the first real approved reply.** Studio sends a HEAD to /api/comment/publish/ before the POST; the response matcher had no method filter, caught the empty HEAD, reported UI_CHANGED and closed the browser — but the POST had gone out and the reply was published (replyCount 1→2). Fixes: match POST only; any failure after the submit keystroke is reported with outcome "unknown" and a verify-before-retry hint. Recon note said "comment publish" without recording the HEAD probe: record every method seen on a write endpoint.
