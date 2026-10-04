# tiktok-cli

TikTok Studio from the terminal, for you and for agents. `tiktok` (alias `tt`) drives your own logged-in Chrome profile: list videos and analytics, triage and reply to comments, post and schedule videos.

There is no official TikTok API for this on a personal account (see `recon/tiktok-landscape.md`), so the CLI reads the JSON TikTok Studio already loads and performs writes through the Studio UI. That is against TikTok's Terms of Service; use it on your own account, at a human pace.

## Install

Requires Node ≥ 22.18 and Google Chrome.

```bash
bun install        # or npm install
npm link           # exposes `tiktok` and `tt`
tiktok auth login  # opens Chrome once; log in with the QR code
tiktok doctor
```

## Use

```bash
tiktok videos --sort views
tiktok video get <videoId>
tiktok stats --days 28
tiktok inbox
tiktok comment reply <commentId> "¡Gracias!"
tiktok post clip.mp4 --description "Nuevo #video" --privacy followers --schedule "2026-10-05 18:30"
tiktok video update <videoId> --privacy only-me
tiktok video delete <videoId>
```

Piped output is JSON automatically (`{ ok, data, meta }`); `tiktok schema` describes every command. Agents should read `skills/tiktok/SKILL.md`.

## Safety

- Writes ask for confirmation in a terminal. From an agent they become an **intent**: `tiktok intent list` / `tiktok intent approve <id>` (terminal only).
- `--dry-run` fills the real Studio form without the final click.
- Outgoing post/edit requests are intercepted and aborted if they do not match what you asked for.
- `tiktok killswitch on` blocks every write until `off`.
- Audit log: `%APPDATA%\tiktok-cli\audit\YYYY-MM-DD.jsonl` (pending → ok/error/blocked/dry-run).
- Failures in the browser leave a debug bundle (screenshot, HTML, network, Playwright trace) in `%LOCALAPPDATA%\tiktok-cli\debug`. **The `trace.zip` holds your session cookies: never share it.**

## Limits

- The UI is driven in Spanish (the account locale). Other locales need the text locators in `src/browser` and `src/commands` translated.
- Comments are read from Studio's 31-day window.
- Visibility codes for followers/everyone and populated account analytics were not observable on the test account; see `recon/report.md`.

## Development

```bash
bun test               # contract, mappers, validations (no browser)
bun run typecheck
```

Design: `docs/spec.md`, `docs/contract.md`. Build log: `friction.md`.
