import { basename } from "node:path";
import type { Page, Route } from "playwright-core";
import { withBrowser } from "../browser/session.ts";
import { assertTikTokOk, awaitOrClassify, endpoint, readCurrentUser, readJson } from "../browser/studio.ts";
import { attachVideo, choosePrivacy, chooseSchedule, dismissKnownModals, fillDescription } from "../browser/upload-form.ts";
import { muted, ok } from "../cli/platform/style.ts";
import { result, type Command, type Context } from "../core/command.ts";
import { AppError, outcomeUnknown } from "../core/errors.ts";
import { audited, authorize, isInteractive, recordDryRun } from "../core/gate.ts";
import type { Plan } from "../core/intents.ts";
import { step } from "../core/output.ts";
import { videoUrl } from "../tiktok/video.ts";
import {
  findScheduleTime,
  parseSchedule,
  POST_PATH,
  PRIVACY_OPTIONS,
  validateDescription,
  validateFile,
  type PostRequest,
  type PostResponse,
  type Privacy,
} from "../tiktok/post.ts";

const STUDIO_UPLOAD = "https://www.tiktok.com/tiktokstudio/upload";

function readRequest(ctx: Context): PostRequest {
  const privacy = ctx.flags.privacy as Privacy;
  return {
    file: validateFile(ctx.args[0]),
    description: validateDescription(String(ctx.flags.description ?? "")),
    privacy,
    schedule: parseSchedule(ctx.flags.schedule as string | undefined, privacy),
  };
}

function toPlan(request: PostRequest): Plan {
  const when = request.schedule ? `${request.schedule.date} ${request.schedule.time} (local time)` : "now";
  return {
    action: "video.post",
    summary: request.schedule ? `Schedule a video for ${request.privacy}` : `Publish a video to ${request.privacy}`,
    details: { file: basename(request.file), description: request.description || "(none)", privacy: request.privacy, when },
  };
}

async function guardPostRequest(page: Page, request: PostRequest): Promise<{ rejected: () => AppError | undefined }> {
  let rejection: AppError | undefined;
  await page.route(`**${POST_PATH}**`, async (route: Route) => {
    const body = route.request().postDataJSON() as unknown;
    const text = JSON.stringify(body);
    const scheduled = findScheduleTime(body);
    const descriptionOk = !request.description || text.includes(JSON.stringify(request.description).slice(1, -1));
    const scheduleOk = !request.schedule || scheduled === request.schedule.epoch;
    if (descriptionOk && scheduleOk) return route.continue();
    rejection = new AppError("UI_CHANGED", "Blocked the post: the form TikTok was about to send does not match the request.", {
      cause: !descriptionOk ? "Description differs from --description." : `schedule_time ${scheduled} ≠ ${request.schedule!.epoch}.`,
      hint: "Nothing was published. Re-run with --headed --dry-run to inspect the form.",
    });
    return route.abort();
  });
  return { rejected: () => rejection };
}

async function fillForm(ctx: Context, page: Page, request: PostRequest): Promise<void> {
  step(ctx.mode, "Uploading video…");
  await attachVideo(page, request.file, (message) => step(ctx.mode, message));
  await dismissKnownModals(page);
  step(ctx.mode, "Filling the form…");
  await fillDescription(page, request.description);
  await choosePrivacy(page, request.privacy);
  if (request.schedule) {
    await chooseSchedule(page, request.schedule, ctx.global.headed && isInteractive(ctx), () =>
      step(ctx.mode, 'TikTok asks to allow scheduled posts: click "Permitir" in the Chrome window.'),
    );
  }
}

async function submit(ctx: Context, page: Page, request: PostRequest) {
  const guard = await guardPostRequest(page, request);
  const posted = page.waitForResponse(endpoint(POST_PATH, "POST"), { timeout: 120_000 });
  posted.catch(() => undefined);
  step(ctx.mode, request.schedule ? "Scheduling…" : "Publishing…");
  await page.getByRole("button", { name: request.schedule ? "Programar" : "Publicar", exact: true }).click();
  try {
    const body = assertTikTokOk(await readJson<PostResponse>(await awaitOrClassify(page, posted, "publishing")), "the post");
    const single = body.single_post_resp_list?.[0];
    if (!single?.item_id || (single.status_code ?? 0) !== 0) {
      throw new AppError("API_ERROR", "TikTok did not confirm the post.", { cause: single?.status_msg || "No item id in the response.", tiktokCode: single?.status_code });
    }
    return single.item_id;
  } catch (error) {
    const blocked = guard.rejected();
    if (blocked) throw blocked;
    throw outcomeUnknown(error, "tiktok video list");
  }
}

export const videoPost: Command = {
  path: ["video", "post"],
  shorthand: "post",
  summary: "Upload and publish (or schedule) a video from TikTok Studio. Gated.",
  args: [{ name: "file", description: "Video file (.mp4 recommended)", required: true }],
  flags: [
    { name: "description", type: "string", description: "Caption with #hashtags, up to 4000 characters", default: "" },
    { name: "privacy", type: "string", description: "Who can watch", choices: PRIVACY_OPTIONS, default: "followers" },
    { name: "schedule", type: "string", description: 'Local time "YYYY-MM-DD HH:MM", 5-minute steps, 15+ minutes ahead' },
    { name: "dry-run", type: "boolean", description: "Upload and fill the form, but do not publish" },
  ],
  gated: true,
  output: "{ videoId, url, scheduledAt? } | { dryRun: true, plan }",
  async run(ctx) {
    const request = readRequest(ctx);
    const plan = toPlan(request);
    const authorization = await authorize(ctx, plan);
    const data = await withBrowser(ctx, {}, async ({ page }) => {
      const user = await readCurrentUser(page);
      if (!user) throw new AppError("AUTH_EXPIRED", "The TikTok session is no longer valid.", { hint: "tiktok auth login" });
      await page.goto(STUDIO_UPLOAD, { waitUntil: "domcontentloaded" });
      await fillForm(ctx, page, request);
      if (authorization === "dry-run") {
        recordDryRun(ctx, plan);
        return { dryRun: true as const, plan };
      }
      return audited(ctx, plan, async () => {
        const videoId = await submit(ctx, page, request);
        return {
          videoId,
          url: videoUrl(user.username, videoId),
          ...(request.schedule ? { scheduledAt: new Date(request.schedule.epoch * 1000).toISOString() } : {}),
        };
      });
    });
    return result({
      data,
      nextSteps: "dryRun" in data ? [] : [`tiktok video get ${data.videoId}`],
      human: (value) =>
        "dryRun" in value
          ? "Dry run: video uploaded to the form and fields filled; nothing was published."
          : `${ok("✓")} ${value.scheduledAt ? `Scheduled for ${value.scheduledAt}` : "Published"} ${muted(value.url)}`,
    });
  },
};
