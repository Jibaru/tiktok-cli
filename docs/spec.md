# tiktok-cli — spec v1

Decided in a grilling session on 2026-10-04. Background research: `recon/tiktok-landscape.md`.

## Scope

- Single user, own **personal** TikTok account. Multi-profile ready via `--profile` (v2).
- **Browser-only** adapter: Playwright persistent profile driving TikTok Studio and tiktok.com. No official API, no Business account.
- Reads intercept the JSON the page already receives; writes go through the UI.
- Operated by both an agent and a human: agent-first contract plus polished human output.

## Stack

- TypeScript run directly by Node 22 (type stripping), Bun as package manager and test runner. Bun runtime rejected: hangs with Playwright on Windows (see friction.md). Local install via `npm link`.
- Binary `tiktok`, alias `tt`. Noun-verb commands.
- Code in English, modular, self-documenting, minimal comments.
- One commit per feature, personal GitHub repo (Jibaru).

## Output

- Human mode: tables, semantic color, sparklines for analytics, banner on TTY only, diagnostics on stderr.
- `--json` for automation, and automatically when stdout is not a TTY. No ANSI in JSON. `NO_COLOR` respected.
- JSON envelope includes `nextSteps`. `tiktok schema` exposes commands and contract with a version.

## v1 features

| Area | Commands (tentative) |
|---|---|
| Auth | `auth login` (headed browser, manual login once), `auth status`, `auth logout` |
| Videos | `video list` (views, likes, comments), `video get <id>` (metrics, description, top comments) |
| Analytics | `analytics overview` with daily sparklines, per-video analytics |
| Comments | `comment list <videoId>`, `comment inbox` (unanswered), `comment reply <commentId> "text"` |
| Publish | `video post <file>` with description, privacy, `--schedule` (Studio native scheduling) |
| Diagnostics | `doctor` |

v2: For You / user feed (open in browser or mpv), interactive TUI, AI-suggested replies, cover selection, photo carousels, multiple profiles.

Out of scope: auto-replies without approval.

## Safety (writes: reply, post)

- `--dry-run` on every mutation, exercising the real path up to the final submit.
- Append-only audit log (day-bucketed JSONL), pending record written before submitting.
- When not on a TTY (agent), real submission requires human confirmation in a terminal; agent can only prepare.
- Human pacing and daily limits to avoid spam/shadowban triggers.

## Errors

Every error has a stable code, a cause, a hint, and a retryable flag; the same shape in `--json`.

| Code | Meaning | Exit |
|---|---|---|
| `VALIDATION` | Bad user input (file too long, text over limit) | 2 |
| `NOT_SUPPORTED` | Feature unavailable, with alternative | 2 |
| `AUTH_*` | Session missing/expired | 3 |
| `CAPTCHA_REQUIRED` | TikTok asked for a captcha | 4 |
| `RATE_LIMITED` | Throttled, includes when to retry | 4 |
| `UI_CHANGED` | Expected element/endpoint not found | 1 |
| `NETWORK` | Connectivity failure | 1 |
| `INTERNAL` | Bug | 1 |

On any browser failure, a debug bundle is saved: screenshot, HTML, recent network responses, Playwright `trace.zip`, path printed in the error.

## Process

1. `surface-recon` on TikTok Studio + tiktok.com with `agent-browser`, using a **secondary test account**; tests of writes on a private video.
2. `cli-build` phases from the recon report.
3. Verify each feature by running the linked binary, then commit.
