# Recon report — TikTok Studio (browser plane)

Date: 2026-10-04 · Account: secondary test account (private, Region PE) · Browser: real Chrome 154 via agent-browser 0.27.0, isolated persistent profile, headed.
Prior desk research: `recon/tiktok-landscape.md`. Raw captures (secret-bearing, gitignored): `recon/captures/`.

## Terrain profile

```yaml
access: owned
planes: [network, interactive]
primary-plane: network
acceptance: [enumeration, receipt-plus-poststate]
maximum-consequence: external   # each write was approved by the user individually
```

Official surface (Phase 1): none usable for a personal account. See landscape report.

## Key facts

1. **Every data endpoint that matters is signed** (`msToken`, `X-Bogus`, `X-Gnarly` in query). Replay outside the page was not attempted, deliberately: the client must let the page issue calls and read responses.
2. **HTTP status is meaningless for errors.** Business errors return HTTP 200 with an envelope `{status_code, status_msg, extra.logid, log_pb.impr_id}`; `status_code: 0` is success. Observed failure: `2209 "Este vídeo no existe"` when commenting an only-me video.
3. **Unauthenticated `/tiktokstudio` does not redirect**: it renders a login panel at the same URL (heading "Inicia sesión en TikTok").
4. **The UI is Spanish (account locale `es`).** Text-based locators are locale-bound.

## Evidence — reads

| Claim | Endpoint | Provenance | Receipt |
|---|---|---|---|
| Current user + CSRF token | `GET /tiktokstudio/api/web/user?needIsVerified&needProfileBio` (unsigned) → `userId`, `userExtra.isPrivate`, `tt-csrf-token`, `userBaseInfo.UserProfile.UserBase.{NickName,SecUid,Region,...}` | observed | `body-api_web_user_.json` |
| List own videos | `POST /tiktok/creator/manage/item_list/v1/` (signed). Body `{"cursor":0,"size":50,"query":{"sort_orders":[{"field_name":"post_time","order":2}],"conditions":[],"is_recent_posts":true}}`. Response `{item_list[], cursor, has_more, status_code}` | observed, empty and 1-item | `body-item_list*.json` |
| Video fields | `item_id, desc, create_time, post_time, schedule_time, play_count, like_count, comment_count, share_count, favorite_count, duration, visibility, status, in_review, is_pinned, cover_url[], play_addr[], permissions` (counts are **strings**) | observed | `body-item_list-1.json` |
| Comments inbox | `POST /tiktokstudio/api/web/commentsV2` (signed). Body `{"count":"20","query":{"searchConditions":[],"filterConditions":[],"sortOrders":[{"fieldName":"create_time","order":2}]},"dateRange":{"startDate":"<epoch>","endDate":"<epoch>"}}`. Response `{comments[], hasMore, cursor}` | observed with 1 comment | `body-commentsV2-data.json` |
| Unanswered filter | `filterConditions: [{"fieldName":"creator_replied","op":0,"field":"0"}]` | observed: 1 → 0 after reply | `body-commentsV2-unanswered.json` |
| Comment fields | `commentId, text, textExtra, hasCreatorLiked, user{uid,uniqueId,nickname,avatarThumb[]}, item{itemId,desc,playCount,commentCount,likeCount,duration,createTime,status,visibility,coverUrl[]}` | observed | same |
| Default inbox window | `dateRange` spans 31 days ending tomorrow | observed (1788498000→1791176400) | same |
| Account analytics | `GET /aweme/v2/data/insight/?type_requests=[...]&tz_offset=-18000` (**unsigned**). Overview types: `vv_history, pv_history, like_history, comment_history, share_history, follower_num_history, reached_audience_history` with `days`/`end_days`; plus `unique_viewer_num, follower_num, vv_traffic_source, user_search_terms` | observed (values null on empty account) | `session1.har` |
| Per-video analytics | Same endpoint with `{"insigh_type":"video_view_realtime","aweme_id":"<id>"}` etc. (`video_info, video_retention_rate_realtime, video_finish_rate_realtime, video_traffic_source_percent_realtime, ...`). Series shape `{interval, is_real_time, list:[{key:"<epoch>", value}], status, total}` | observed | `body-insight-*.json` |

Note the typo `insigh_type` is the real parameter name.

## Evidence — writes (all receipt + post-state)

| Claim | Mechanism | Receipt | Post-state |
|---|---|---|---|
| Publish video | UI: `/tiktokstudio/upload` → `input[type=file]` → description → privacy → "Publicar". Network: `POST /tiktok/web/project/post/v1/` (signed) | `single_post_resp_list[0].{item_id,status_code:0}`, `project_id` | Redirect to `/tiktokstudio/content`; item in `item_list` |
| Change privacy | UI: content row privacy button → option. Network: `POST /tiktok/post/edit/v1/` body `{"aweme_id","scene":1,"visibility":{"visibility":N}}` | `edit_result.edit_biz_result[].status_code:0` | `item_list` visibility changed |
| Comment (web video page) | UI: `[data-e2e=comment-input]` textbox → paste → "Publicar". Network: `POST /api/comment/publish/?aweme_id&text&text_extra` (signed, params in **query**) | `comment.cid`, `status_code:0` | Appears in Studio inbox |
| Delete video | UI: content row (viewport ≥1920 wide) → "⋯" → "Eliminar" → confirm "Eliminar". Network: `POST /tiktok/post/edit/v1/` body `{"aweme_id","scene":1,"delete":{"delete_type":1}}` | `edit_result.edit_biz_result[].status_code:0` | Gone from `item_list`; restorable 30 days |
| Reply (Studio) | UI: `/tiktokstudio/comment` → "Responder" → `textarea[placeholder="Responder al comentario"]` → Enter. Network: same `/api/comment/publish/` + `reply_id=<commentId>&reply_to_reply_id=0` | `status_code:0`, `status_msg:"Comentario enviado correctamente"`, new `cid` | Unanswered inbox 1 → 0 |

### Upload form specifics

- Description editor is **Draft.js**. Typing with key events **drops characters** (c/r/n), `execCommand('insertText')` **crashes the page** ("Hubo un problema"). **Clipboard paste works** and preserves hashtags (parsed into `text_extra`).
- Description defaults to the filename; must be cleared first.
- First-run modals after attaching a file: "¿Quieres activar las revisiones automáticas de contenido?" (Cancelar/Activar), then an "Entendido" tooltip. Dismiss before interacting.
- Privacy options on a **private account**: Seguidores / Amigos / Solo tú (no "Todos").
- **"Solo tú" disables scheduling** (both radios disabled).
- **Only-me videos cannot receive comments**, not even from the owner (2209).
- **Scheduling** (observed after the user accepted the consent by hand): selecting "Programación" shows two **readOnly** `TUXTextInputCore-input` fields, time (`HH:MM`, default ≈ now+15 min) and date (`YYYY-MM-DD`). Time picker = hour column + minute column in **5-minute steps**; date picker = month calendar with prev/next arrows, past days disabled. Submit button label changes from "Publicar" to "Programar". Discard asks "¿Descartar esta publicación?" → "Descartar".
- The consent is per account or per browser profile: **unverified**; check on the CLI profile first run.

### Visibility enums (they differ by endpoint)

| Label | item_list / commentsV2 (read) | post/edit (write) | post/v1 `visibility_type` |
|---|---|---|---|
| Solo tú | 2 | — | 1 |
| Amigos | 3 | 2 | — |
| Seguidores / Todos | not observed | not observed | not observed |

Implementer: map labels per endpoint; do not share one enum.

## Blockers

| Blocker | Status |
|---|---|
| Signed endpoints | Got past: page issues requests, client reads responses |
| Login / anti-bot | Got past: manual QR login once in a real Chrome headed profile; no captcha seen in this session |
| Schedule consent dialog ("¿Permitir que el vídeo se guarde para una publicación programada?") | Passed by the user by hand (human-only consent). Picker observed |

## Needs verification

- **Schedule request field**: picker is mapped, but no scheduled post was submitted; confirm `post/v1` carries `schedule_time` on first `video post --schedule`.
- **Visibility codes for Seguidores/Todos**: change test video to Seguidores and read `item_list` + `post/edit` body.
- **Pagination**: `item_list` cursor/has_more and `commentsV2` cursor with >1 page — needs an account with more content.
- **Session lifetime**: how long the persisted profile stays logged in. Re-check `tiktok doctor` after days.
- **`comment_count` lag**: item_list showed 0 with 2 comments present; measure delay.
- **For You / user feed** (v2): not mapped.
- **Rate limits**: no limit headers observed. Not measured.

## Verdict

**Build it, narrowly** — browser-only, as the spec decided.

- Solid: auth via persisted profile, `item_list`, `commentsV2` (+ unanswered filter), `data/insight`, reply via Studio textarea, publish via upload form with paste.
- Maintenance risk: every path is undocumented and can change on any deploy. Most fragile: the upload form (Draft.js editor, first-run modals, Spanish text locators). Reads are sturdier because they key on endpoint paths, not DOM.
- Design consequences for `cli-build`:
  - Reads: navigate to the Studio page, wait for and parse the endpoint response (`page.waitForResponse`), never fetch directly.
  - Errors: classify by envelope `status_code` (+ `logid` in the error), login-panel detection for `AUTH_EXPIRED`, missing element/response timeout for `UI_CHANGED`.
  - Writes: verify receipt (`status_code:0` + id) **and** post-state, as done here.
  - Validation: reject `--schedule` with only-me privacy; warn that only-me videos cannot be commented.
