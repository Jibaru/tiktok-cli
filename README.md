# tiktok-cli

> Manage your TikTok account from the terminal — videos, analytics, comments and publishing — built for humans and AI agents alike.

`tiktok` (alias `tt`) drives **TikTok Studio** inside your own logged-in Chrome profile. It reads the data Studio already loads and performs actions through the Studio interface, so it works with a regular personal account and needs no API keys or developer approval.

```text
# illustrative output
$ tiktok videos --sort views
POSTED      ID                   VISIBILITY  VIEWS  LIKES  COMMENTS  SHARES  DESCRIPTION
2026-10-04  7692857479796952342  friends       1.2K    310        42      18  Behind the scenes #studio

$ tiktok inbox | jq '.data.comments[] | {id, text}'
```

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Agent skill](#agent-skill)
- [Usage](#usage)
- [Automation and JSON output](#automation-and-json-output)
- [Safety model](#safety-model)
- [Configuration and files](#configuration-and-files)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)
- [Development](#development)
- [Disclaimer](#disclaimer)

## Features

| Area | What you get |
|---|---|
| **Videos** | List with views, likes, comments, shares and visibility; per-video detail with hourly views, finish rate, watch time and traffic sources |
| **Analytics** | Account totals for 7, 28, 60 or 365 days, compared with the previous period, with trend sparklines |
| **Comments** | Recent comments, an *unanswered* inbox, and replies |
| **Publishing** | Upload, caption, audience and native scheduling; change a video's audience; delete |
| **Agents** | JSON output, runtime `schema`, structured errors and a companion agent skill |
| **Safety** | Confirmations, dry-runs, human approval for agent writes, request guards, audit log and a killswitch |

## Requirements

- **Node.js 22.18 or newer** (runs TypeScript directly; no build step)
- **Google Chrome** (the stable channel installed on the system)
- **Bun** or **npm** to install dependencies
- A TikTok account whose Studio interface is in **Spanish** (see [Limitations](#limitations))

Tested on Windows 11 with Node 22.22 and Chrome 154.

## Installation

### 1. Install the CLI

```bash
git clone https://github.com/Jibaru/tiktok-cli.git
cd tiktok-cli
bun install            # or: npm install
npm link               # puts `tiktok` and `tt` on your PATH
```

Check that it is on your PATH:

```bash
tiktok --version
tiktok doctor --offline
```

### 2. Log in once

```bash
tiktok auth login
```

A Chrome window opens on TikTok Studio. Log in there (the QR code from the TikTok app is the most reliable method). The session is stored in a dedicated local Chrome profile, separate from your everyday browser, and reused by every later command.

```bash
tiktok auth status     # ● Logged in as @you
tiktok doctor          # Chrome, storage, killswitch and session checks
```

### Updating

```bash
cd tiktok-cli
git pull
bun install
```

`npm link` points at the clone, so pulling is enough.

### Uninstalling

```bash
tiktok auth logout     # deletes the local browser profile
npm unlink -g tiktok-cli
```

## Agent skill

The repository ships an agent skill (`skills/tiktok/SKILL.md`) that teaches coding agents such as Claude Code, Cursor and others how to operate the CLI safely. It covers the commands, the JSON envelope, workflows like inbox triage and performance reports, what to do with each error, and the rule that writes always go through human approval.

### Install from GitHub

```bash
# all your projects (user level), Claude Code
npx skills add Jibaru/tiktok-cli --skill tiktok -g -a claude-code

# only the current project
npx skills add Jibaru/tiktok-cli --skill tiktok -a claude-code

# every supported agent
npx skills add Jibaru/tiktok-cli --skill tiktok -g -a '*'
```

The repository is private, so this needs git access to it (for example `gh auth login`).

### Install from your local clone

```bash
cd tiktok-cli
npx skills add ./skills/tiktok -g -a claude-code -y
```

The skill is copied, not linked. Run the same command again after pulling changes to refresh it.

Once installed, just ask your agent things like *"how are my TikToks doing this month?"* or *"draft replies for my unanswered comments"*. The agent prepares the actions and you approve them in your terminal.

## Usage

Commands follow `tiktok <noun> <verb> [args] [flags]`. Common ones have shorthands.

### Videos and analytics

```bash
tiktok videos --limit 20 --sort views        # video list; sort: posted|views|likes|comments
tiktok video get <videoId>                   # stats, hourly views, finish rate, sources
tiktok stats --days 28                       # analytics overview; days: 7|28|60|365
```

### Comments

```bash
tiktok inbox                                 # comments you have not replied to (last 31 days)
tiktok comment list [videoId] --limit 50     # all recent comments, optionally for one video
tiktok comment reply <commentId> "¡Gracias por verlo!"
```

### Publishing

```bash
tiktok post clip.mp4 --description "New video #behindthescenes" --privacy followers
tiktok post clip.mp4 --description "Out tomorrow" --privacy followers --schedule "2026-10-05 18:30"
tiktok video update <videoId> --privacy only-me
tiktok video delete <videoId>                # restorable for 30 days in TikTok
```

- `--privacy`: `everyone`, `followers`, `friends` or `only-me`. Private accounts cannot use `everyone`.
- `--schedule`: your local time, in 5-minute steps, at least 15 minutes ahead. A video set to `only-me` cannot be scheduled.

### Everything else

```bash
tiktok --help                    # all commands
tiktok <noun> <verb> --help      # one command
tiktok schema                    # machine-readable description of every command
```

| Global flag | Effect |
|---|---|
| `--json` | Force JSON output (automatic when piped) |
| `--fields a,b` | Keep only these keys in each record |
| `--dry-run` | On write commands: fill the real form, don't submit |
| `--headed` | Show the Chrome window while the command runs |
| `--debug` | Always save a debug bundle, even on success |

## Automation and JSON output

When stdout is not a terminal, every command prints exactly one JSON object, with no colors or banners:

```json
{ "ok": true, "data": { "videos": [ ... ], "hasMore": false },
  "meta": { "command": "video list", "version": "0.1.0", "nextSteps": ["tiktok video get 7692857479796952342"] } }
```

Errors share the same envelope and a meaningful exit code:

```json
{ "ok": false,
  "error": { "code": "AUTH_EXPIRED", "message": "The TikTok session is no longer valid.",
             "cause": "TikTok Studio rendered the login panel.", "hint": "tiktok auth login",
             "retryable": false, "debugBundle": "…/debug/2026-10-04T18-40-36Z_video-list" },
  "meta": { "command": "video list", "version": "0.1.0", "nextSteps": ["tiktok auth login"] } }
```

| Exit | Codes | Meaning |
|---|---|---|
| 0 | — | Success |
| 1 | `UI_CHANGED`, `API_ERROR`, `NETWORK`, `INTERNAL` | TikTok or system failure; see `debugBundle` and `logId` |
| 2 | `VALIDATION`, `NOT_SUPPORTED`, `APPROVAL_REQUIRED`, `APPROVAL_DENIED`, `KILLSWITCH`, `CONSENT_REQUIRED` | Input or approval issue; see `hint` |
| 3 | `AUTH_REQUIRED`, `AUTH_EXPIRED` | Log in again with `tiktok auth login` |
| 4 | `CAPTCHA_REQUIRED`, `RATE_LIMITED` | TikTok is pushing back; slow down |

The full contract lives in [`docs/contract.md`](docs/contract.md), and `tiktok schema` returns it at runtime.

## Safety model

Reads run freely. Every command that changes your account (`comment reply`, `video post`, `video update`, `video delete`, `auth logout`) is gated:

1. **In a terminal**, it shows a plan and asks `Proceed? [y/N]`.
2. **From a script or agent**, it never runs. It saves an *intent* and exits with `APPROVAL_REQUIRED`, and you approve it yourself:
   ```bash
   tiktok intent list
   tiktok intent approve <id>     # only works in an interactive terminal
   tiktok intent discard <id>
   ```
3. **`--dry-run`** drives the real TikTok Studio form up to, but not including, the final click.
4. **Request guards** intercept the outgoing request and cancel it if it does not match what you asked for: wrong caption, schedule or video.
5. **Unknown outcomes** are flagged. If something fails after a write was submitted, the error says so and tells you how to verify before retrying.
6. **Audit log.** Every write records a `pending` entry before it is sent and an `ok`, `error`, `blocked` or `dry-run` entry after.
7. **Killswitch.** `tiktok killswitch on` blocks all writes until `tiktok killswitch off`.
8. **Consent dialogs.** If TikTok asks you to accept something, such as allowing scheduled posts, the CLI never clicks it for you. Run the command with `--headed` and accept it yourself.

## Configuration and files

| Path (Windows) | Contents |
|---|---|
| `%LOCALAPPDATA%\tiktok-cli\profiles\default` | Dedicated Chrome profile holding your TikTok session |
| `%APPDATA%\tiktok-cli\audit\YYYY-MM-DD.jsonl` | Append-only audit log of every write |
| `%APPDATA%\tiktok-cli\KILLSWITCH` | Present while writes are blocked (`tiktok killswitch on`) |
| `%LOCALAPPDATA%\tiktok-cli\intents\` | Pending approvals (expire after 24 hours) |
| `%LOCALAPPDATA%\tiktok-cli\debug\` | Debug bundles: screenshot, HTML, network log, Playwright trace |

On macOS and Linux the same layout lives under `~/Library/Application Support/tiktok-cli` or the XDG directories.

| Environment variable | Effect |
|---|---|
| `TIKTOK_CLI_HOME` | Put all state under one directory (useful for tests) |
| `NO_COLOR` | Disable colors |
| `NO_JSON=1` | Force human output even when piped |

> **Debug bundles contain your session.** `trace.zip` includes cookies. Keep bundles local and never share them.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `AUTH_EXPIRED` / `AUTH_REQUIRED` | `tiktok auth login` |
| `The TikTok browser profile is already open` | Another `tiktok` command (or its Chrome window) is running; commands run one at a time |
| `Google Chrome is not installed` | Install Chrome stable, then `tiktok doctor` |
| `CAPTCHA_REQUIRED` | Run `tiktok auth login`, solve it in the window, retry later |
| `CONSENT_REQUIRED` on `--schedule` | Re-run the same command with `--headed` and click **Permitir** |
| `UI_CHANGED` | TikTok changed its interface. Open the `screenshot.png` in the reported debug bundle, and re-run with `--headed` to watch |
| Analytics show `–` and `dataReady: false` | TikTok has no data for that range yet. Account analytics lag about 3 days |

## Limitations

- **Spanish interface only.** Some actions locate TikTok Studio elements by their Spanish labels. Accounts in other languages need those labels translated in `src/browser` and `src/commands`.
- **Comment window.** Comments are read from Studio's last 31 days.
- **Personal-account focus.** Built and verified on a private personal account. The visibility codes for *followers* and *everyone*, and analytics for a busy account, were not observable during development and may need adjustment.
- **Undocumented surface.** TikTok can change Studio at any time. Expect occasional `UI_CHANGED` errors after TikTok updates.

## Development

```bash
bun install
bun test               # contract, mappers and validation tests (no browser)
bun run typecheck
node src/main.ts …     # run from source without linking
```

```text
src/
  main.ts, runner.ts     entry point, argument parsing, dispatch
  core/                  envelope, errors, write gate, intents, paths
  browser/               Chrome session, Studio helpers, upload form, debug bundles
  tiktok/                response types and mappers
  commands/              one module per command group
  cli/                   adopted cligentic blocks (style, detect, audit, killswitch…)
skills/tiktok/           agent skill
docs/                    spec and JSON contract
recon/                   research and TikTok Studio surface report
```

Design notes: [`docs/spec.md`](docs/spec.md) · [`docs/contract.md`](docs/contract.md) · [`recon/report.md`](recon/report.md) · build log in [`friction.md`](friction.md).

## Disclaimer

This project is not affiliated with, endorsed by or connected to TikTok or ByteDance. It automates your own browser session, which TikTok's Terms of Service do not permit. Use it only on accounts you own, at a human pace and at your own risk; automated activity can lead to captchas, rate limits or account restrictions.
