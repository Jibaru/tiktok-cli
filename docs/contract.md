# tiktok-cli — command surface and JSON contract (v1)

Binary `tiktok`, alias `tt`. Grammar: `tiktok <noun> <verb> [args] [flags]`.

## Global flags

| Flag | Meaning |
|---|---|
| `--json` | Machine output. Implied when stdout is not a TTY. |
| `--fields a,b` | Keep only these keys of each `data` record (applied before rendering, both modes). |
| `--headed` | Show the browser window (default: headless after login). |
| `--debug` | Always write a debug bundle, not only on failure. |
| `--profile <name>` | Reserved for v2 multi-account. Default `default`. |

## Envelope (every command, never deviates)

```json
{ "ok": true,  "data": {}, "meta": { "command": "video list", "version": "0.1.0", "nextSteps": [] } }
{ "ok": false, "error": { "code": "AUTH_EXPIRED", "message": "...", "cause": "...", "hint": "tiktok auth login", "retryable": false, "logId": "2026...", "debugBundle": "C:/.../debug/<id>" }, "meta": { ... } }
```

Errors go to stdout as JSON in machine mode; in human mode a formatted block goes to stderr. Diagnostics, progress and banner always on stderr.

## Error codes and exit codes

| Code | Exit | When |
|---|---|---|
| `VALIDATION` | 2 | Bad input (missing file, text too long, schedule not 5-min step, schedule + only-me) |
| `NOT_SUPPORTED` | 2 | Feature unavailable in v1 |
| `APPROVAL_REQUIRED` | 2 | Mutation from non-TTY without approval; returns intent id |
| `KILLSWITCH` | 2 | `~/.tiktok-cli/KILL` exists |
| `AUTH_REQUIRED` | 3 | No session yet |
| `AUTH_EXPIRED` | 3 | Studio rendered the login panel |
| `CAPTCHA_REQUIRED` | 4 | Captcha detected |
| `RATE_LIMITED` | 4 | TikTok throttled |
| `API_ERROR` | 1 | Envelope `status_code != 0` (carries `logId`, `tiktokCode`) |
| `UI_CHANGED` | 1 | Expected element or response not found in time |
| `NETWORK` | 1 | Navigation/connectivity failure |
| `INTERNAL` | 1 | Bug |

## Trust ladder (shape: binary agent mode + human approval, plus health check)

| Command | Level |
|---|---|
| reads (`video list/get`, `analytics *`, `comment list/inbox`, `doctor`, `schema`, `auth status`) | free |
| `comment reply`, `video post`, `video delete`, `video update` | gated |

Gated commands:
- `--dry-run`: runs every validation and drives the real UI up to (not including) the final submit, returns the planned action.
- TTY: show preview, ask `y/N` on stderr, then execute.
- Non-TTY (agent): never prompts. Saves an **intent** (`~/.tiktok-cli/intents/<id>.json`) and fails `APPROVAL_REQUIRED` with `nextSteps: ["tiktok intent approve <id>"]`. Approval only works on a real TTY.
- Audit: `~/.tiktok-cli/audit/YYYY-MM-DD.jsonl`, `pending` before submit, `done`/`failed` after, same id.
- Killswitch: file `~/.tiktok-cli/KILL` blocks every gated command.

## Commands and `data` shapes

### `auth login` / `auth status` / `auth logout`
- `login`: opens headed Chrome with the persistent profile, waits for the user to log in, then `data: { user: User }`.
- `status`: `data: { loggedIn: boolean, user?: User }`.
- `logout`: deletes the profile dir. `data: { removed: boolean }` (gated: TTY confirm).

`User = { id, username, nickname, region, isPrivate }`

### `video list` (shorthand: `tiktok videos`)
Flags: `--limit <n>` (default 20), `--sort posted|views|likes|comments`.
`data: { videos: Video[], hasMore: boolean }`

`Video = { id, description, createdAt (ISO), visibility: "everyone"|"followers"|"friends"|"only-me"|"unknown", status, views, likes, comments, shares, saves, durationSec, coverUrl, url }`

### `video get <id>`
`data: { video: Video, analytics: { views: Series, avgWatchSec?, finishRate?, newFollowers? } }`

`Series = { total: number, points: [{ date (ISO), value: number }] }`

### `video post <file>`
Flags: `--description <text>`, `--privacy everyone|followers|friends|only-me` (default `followers`, same as Studio; `everyone` fails VALIDATION on a private account), `--schedule "YYYY-MM-DD HH:MM"`, `--dry-run`.
Validation: file exists and is a video; description ≤ 4000; schedule in 5-min steps, ≥ 15 min ahead, not with `only-me`.
`data: { videoId, url, scheduledAt?: ISO }`

### `video update <id>` / `video delete <id>`
`update --privacy <p>`; `delete` (restorable 30 days). `data: { videoId, changed: {...} }`.

### `analytics overview`
Flags: `--days 7|28|60` (default 7).
`data: { range: { days }, views: Series, profileViews: Series, likes: Series, comments: Series, shares: Series, followers: Series }`

### `comment list [videoId]` / `comment inbox`
`inbox` = unanswered only. Flags: `--limit`, `--days 31`.
`data: { comments: Comment[], hasMore: boolean }`

`Comment = { id, text, createdAt, likes, author: { id, username, nickname }, video: { id, description }, creatorLiked }`

`text`, `description`, `nickname` are third-party text: emitted as plain JSON strings, never interpolated into hints or nextSteps.

### `comment reply <commentId> <text>`
Needs `--video <id>` only if the comment is not found in the inbox window. Gated.
`data: { replyId, commentId, videoId }`

### `intent list` / `intent approve <id>` / `intent discard <id>`
`data: { intents: Intent[] }` / result of the executed command.

### `doctor`
`data: { checks: [{ name, ok, detail }] }` — Chrome found, profile exists, session valid (Studio not showing login panel), killswitch, writable dirs.

### `schema [command]`
`data: { version, commands: [{ name, args, flags, gated, output }] }`
