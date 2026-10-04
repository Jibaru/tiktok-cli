import type { Page, Response } from "playwright-core";
import { withBrowser } from "../browser/session.ts";
import { assertTikTokOk, awaitOrClassify, endpoint, openStudio, readJson } from "../browser/studio.ts";
import { bold, muted, ok } from "../cli/platform/style.ts";
import { result, type Command, type Context } from "../core/command.ts";
import { AppError, outcomeUnknown } from "../core/errors.ts";
import { audited, authorize, recordDryRun } from "../core/gate.ts";
import type { Plan } from "../core/intents.ts";
import { renderTable, step } from "../core/output.ts";
import {
  COMMENT_PUBLISH_PATH,
  COMMENTS_PATH,
  isUnansweredQuery,
  MAX_COMMENT_LENGTH,
  toComment,
  type Comment,
  type CommentsResponse,
  type ReplyResponse,
} from "../tiktok/comment.ts";

type LoadOptions = { unanswered: boolean; limit: number; videoId?: string };

const commentsRequest = (unanswered: boolean) => (response: Response) =>
  endpoint(COMMENTS_PATH, "POST")(response) && isUnansweredQuery(response.request().postData()) === unanswered;

async function loadComments(page: Page, options: LoadOptions): Promise<{ comments: Comment[]; hasMore: boolean }> {
  let { body } = await openStudio<CommentsResponse>(page, "/comment", commentsRequest(false), "loading comments");
  if (options.unanswered) {
    const filtered = page.waitForResponse(commentsRequest(true), { timeout: 30_000 });
    filtered.catch(() => undefined);
    await page.getByText("Todos los comentarios", { exact: true }).first().click();
    await page.getByText("Sin respuesta", { exact: true }).first().click();
    body = assertTikTokOk(await readJson<CommentsResponse>(await awaitOrClassify(page, filtered, "filtering unanswered comments")), "comments");
  }
  const byId = new Map<string, Comment>();
  const add = (response: CommentsResponse) =>
    response.comments?.map(toComment).filter((comment) => !options.videoId || comment.video.id === options.videoId).forEach((comment) => byId.set(comment.id, comment));
  add(body);
  let hasMore = body.hasMore ?? false;
  while (byId.size < options.limit && hasMore) {
    const next = page.waitForResponse(commentsRequest(options.unanswered), { timeout: 10_000 }).catch(() => undefined);
    await page.mouse.move(900, 600);
    await page.mouse.wheel(0, 20_000);
    const response = await next;
    if (!response) break;
    const nextPage = await readJson<CommentsResponse>(response);
    add(nextPage);
    hasMore = nextPage.hasMore ?? false;
  }
  const comments = [...byId.values()];
  return { comments: comments.slice(0, options.limit), hasMore: hasMore || comments.length > options.limit };
}

function renderComments(comments: Comment[], hasMore: boolean, emptyMessage: string): string {
  if (comments.length === 0) return muted(emptyMessage);
  const table = renderTable(comments, [
    { header: "WHEN", value: (comment) => comment.createdAt.slice(0, 16).replace("T", " ") },
    { header: "ID", value: (comment) => muted(comment.id) },
    { header: "FROM", value: (comment) => bold(`@${comment.author.username}`), maxWidth: 20 },
    { header: "COMMENT", value: (comment) => comment.text, maxWidth: 60 },
    { header: "LIKES", value: (comment) => String(comment.likes), align: "right" },
    { header: "VIDEO", value: (comment) => muted(comment.video.description || comment.video.id), maxWidth: 28 },
  ]);
  return `${table}\n\n${muted(`${comments.length} comment${comments.length === 1 ? "" : "s"}${hasMore ? " · more available, raise --limit" : ""}`)}`;
}

const limitFlag = { name: "limit", type: "number", description: "Maximum comments to return", default: 20 } as const;

function readLimit(ctx: Context): number {
  const limit = Number(ctx.flags.limit);
  if (!Number.isInteger(limit) || limit < 1) throw new AppError("VALIDATION", "--limit must be a positive integer.");
  return limit;
}

export const commentList: Command = {
  path: ["comment", "list"],
  summary: "List recent comments (last 31 days) on all your videos or on one video.",
  args: [{ name: "videoId", description: "Only comments on this video", required: false }],
  flags: [limitFlag],
  gated: false,
  output: "{ comments: Comment[], hasMore: boolean }",
  async run(ctx) {
    const limit = readLimit(ctx);
    const videoId = ctx.args[0];
    const data = await withBrowser(ctx, {}, async ({ page }) => {
      step(ctx.mode, "Loading comments…");
      return loadComments(page, { unanswered: false, limit, videoId });
    });
    return result({
      data,
      nextSteps: data.comments.slice(0, 1).map((comment) => `tiktok comment reply ${comment.id} "<text>"`),
      human: (value) => renderComments(value.comments, value.hasMore, "No comments in the last 31 days."),
    });
  },
};

export const commentInbox: Command = {
  path: ["comment", "inbox"],
  shorthand: "inbox",
  summary: "Comments you have not replied to yet (last 31 days).",
  args: [],
  flags: [limitFlag],
  gated: false,
  output: "{ comments: Comment[], hasMore: boolean }",
  async run(ctx) {
    const limit = readLimit(ctx);
    const data = await withBrowser(ctx, {}, async ({ page }) => {
      step(ctx.mode, "Loading unanswered comments…");
      return loadComments(page, { unanswered: true, limit });
    });
    return result({
      data,
      nextSteps: data.comments.slice(0, 1).map((comment) => `tiktok comment reply ${comment.id} "<text>"`),
      human: (value) => renderComments(value.comments, value.hasMore, "Inbox zero: every comment has a reply."),
    });
  },
};

function validateReply(commentId: string | undefined, text: string | undefined): { commentId: string; text: string } {
  if (!commentId || !/^\d{10,25}$/.test(commentId)) {
    throw new AppError("VALIDATION", `"${commentId ?? ""}" is not a comment id.`, { hint: "tiktok comment inbox" });
  }
  const trimmed = (text ?? "").trim();
  if (!trimmed) throw new AppError("VALIDATION", "Reply text is empty.");
  if ([...trimmed].length > MAX_COMMENT_LENGTH) {
    throw new AppError("VALIDATION", `Reply is ${[...trimmed].length} characters; TikTok allows ${MAX_COMMENT_LENGTH}.`);
  }
  return { commentId, text: trimmed };
}

async function markReplyButton(page: Page, comment: Comment): Promise<number> {
  return page.evaluate(
    ({ text, nickname }) => {
      document.querySelectorAll("[data-tt-reply-target]").forEach((element) => element.removeAttribute("data-tt-reply-target"));
      const leaves = [...document.querySelectorAll<HTMLElement>("body *")].filter(
        (element) => element.children.length === 0 && element.innerText?.trim() === text,
      );
      let matches = 0;
      for (const leaf of leaves) {
        let row: HTMLElement | null = leaf;
        for (let depth = 0; row && depth < 8; depth++, row = row.parentElement) {
          const reply = [...row.querySelectorAll<HTMLElement>("*")].find((element) => element.children.length === 0 && element.innerText?.trim() === "Responder");
          if (reply && row.innerText.includes(nickname)) {
            reply.setAttribute("data-tt-reply-target", String(matches++));
            break;
          }
        }
      }
      return matches;
    },
    { text: comment.text, nickname: comment.author.nickname },
  );
}

async function openReplyBox(page: Page, comment: Comment): Promise<void> {
  const matches = await markReplyButton(page, comment);
  if (matches !== 1) {
    throw new AppError("UI_CHANGED", matches === 0 ? "Could not find the comment row in TikTok Studio." : "Several comments look identical; refusing to guess.", {
      cause: `${matches} rows matched the text and author of comment ${comment.id}.`,
      hint: matches === 0 ? "Check the debug bundle screenshot." : "Reply from TikTok Studio for this one.",
    });
  }
  await page.locator('[data-tt-reply-target="0"]').click();
  await page.locator('textarea[placeholder="Responder al comentario"]').waitFor({ timeout: 10_000 });
}

export const commentReply: Command = {
  path: ["comment", "reply"],
  summary: "Reply to a comment from TikTok Studio. Gated: asks first; agents get an intent to approve.",
  args: [
    { name: "commentId", description: "Comment id (from `tiktok comment inbox`)", required: true },
    { name: "text", description: `Reply text, up to ${MAX_COMMENT_LENGTH} characters`, required: true },
  ],
  flags: [{ name: "dry-run", type: "boolean", description: "Open the reply box and fill it, but do not send" }],
  gated: true,
  output: "{ replyId, commentId, videoId } | { dryRun: true, plan }",
  async run(ctx) {
    const { commentId, text } = validateReply(ctx.args[0], ctx.args.slice(1).join(" "));
    const data = await withBrowser(ctx, {}, async ({ page }) => {
      step(ctx.mode, "Finding the comment…");
      const { comments } = await loadComments(page, { unanswered: false, limit: 500 });
      const comment = comments.find((candidate) => candidate.id === commentId);
      if (!comment) {
        throw new AppError("VALIDATION", `Comment ${commentId} is not among your comments of the last 31 days.`, { hint: "tiktok comment inbox" });
      }
      const plan: Plan = {
        action: "comment.reply",
        summary: `Reply publicly to @${comment.author.username}`,
        details: { comment: comment.text, video: comment.video.description || comment.video.id, reply: text },
      };
      const authorization = await authorize(ctx, plan);
      await openReplyBox(page, comment);
      await page.locator('textarea[placeholder="Responder al comentario"]').fill(text);
      if (authorization === "dry-run") {
        recordDryRun(ctx, plan);
        return { dryRun: true as const, plan };
      }
      return audited(ctx, plan, async () => {
        const published = page.waitForResponse(endpoint(COMMENT_PUBLISH_PATH, "POST"), { timeout: 30_000 });
        published.catch(() => undefined);
        step(ctx.mode, "Sending reply…");
        await page.locator('textarea[placeholder="Responder al comentario"]').press("Enter");
        const body = await readJson<ReplyResponse>(await awaitOrClassify(page, published, "sending the reply"))
          .then((response) => assertTikTokOk(response, "the reply"))
          .catch((error) => {
            throw outcomeUnknown(error, `tiktok comment list ${comment.video.id}`);
          });
        if (body.comment?.reply_id !== commentId || !body.comment.cid) {
          throw new AppError("API_ERROR", "TikTok accepted a reply that does not match the requested comment.", {
            cause: `Expected reply_id ${commentId}, got ${body.comment?.reply_id ?? "none"}.`,
            hint: "Check the comment in TikTok Studio before retrying.",
          });
        }
        return { replyId: body.comment.cid, commentId, videoId: comment.video.id };
      });
    });
    return result({
      data,
      nextSteps: ["tiktok comment inbox"],
      human: (value) => ("dryRun" in value ? `Dry run: reply box filled, nothing sent.` : `${ok("✓")} Reply sent ${muted(`(${value.replyId})`)}.`),
    });
  },
};
