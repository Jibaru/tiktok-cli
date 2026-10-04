import type { Page, Route } from "playwright-core";
import { withBrowser } from "../browser/session.ts";
import { assertTikTokOk, awaitOrClassify, endpoint, readJson } from "../browser/studio.ts";
import { muted, ok } from "../cli/platform/style.ts";
import { result, type Command, type Context } from "../core/command.ts";
import { AppError, outcomeUnknown } from "../core/errors.ts";
import { audited, authorize, recordDryRun } from "../core/gate.ts";
import type { Plan } from "../core/intents.ts";
import { step } from "../core/output.ts";
import type { Video } from "../tiktok/video.ts";
import { loadVideos } from "./video.ts";

const EDIT_PATH = "/tiktok/post/edit/v1/";
const UPDATE_PRIVACY = ["followers", "friends", "only-me"] as const;
type UpdatePrivacy = (typeof UPDATE_PRIVACY)[number];

const ROW_PRIVACY_LABEL: Record<UpdatePrivacy, RegExp> = {
  followers: /^Seguidores$/,
  friends: /^Amigos$/,
  "only-me": /^Solo yo$/,
};

type EditBody = { aweme_id?: string; delete?: unknown; visibility?: { visibility?: number } };
type EditResponse = { edit_result?: { edit_biz_result?: { status_code?: number }[] } };

function requireVideoId(ctx: Context): string {
  const id = ctx.args[0];
  if (!id || !/^\d{10,25}$/.test(id)) throw new AppError("VALIDATION", `"${id ?? ""}" is not a TikTok video id.`, { hint: "tiktok video list" });
  return id;
}

async function findVideo(page: Page, id: string): Promise<Video> {
  const { videos } = await loadVideos(page, 200);
  const video = videos.find((candidate) => candidate.id === id);
  if (!video) throw new AppError("VALIDATION", `No video with id ${id} on this account.`, { hint: "tiktok video list" });
  return video;
}

async function markRow(page: Page, id: string): Promise<void> {
  const found = await page.evaluate((id) => {
    document.querySelectorAll("[data-tt-row]").forEach((element) => element.removeAttribute("data-tt-row"));
    const link = document.querySelector(`a[href*="${id}"]`);
    let row = link?.parentElement ?? null;
    while (row && row.querySelectorAll("button").length < 3) row = row.parentElement;
    row?.setAttribute("data-tt-row", "");
    return Boolean(row);
  }, id);
  if (!found) throw new AppError("UI_CHANGED", `Could not find the row of video ${id} in TikTok Studio.`);
}

async function guardEdit(page: Page, id: string, expectDelete: boolean): Promise<() => AppError | undefined> {
  let rejection: AppError | undefined;
  await page.route(`**${EDIT_PATH}**`, async (route: Route) => {
    const body = route.request().postDataJSON() as EditBody;
    if (body.aweme_id === id && Boolean(body.delete) === expectDelete) return route.continue();
    rejection = new AppError("UI_CHANGED", "Blocked the edit: TikTok was about to change a different video or action.", {
      cause: `Request targets ${body.aweme_id ?? "unknown"} (${body.delete ? "delete" : "update"}), expected ${id}.`,
      hint: "Nothing was changed.",
    });
    return route.abort();
  });
  return () => rejection;
}

async function submitEdit(page: Page, id: string, expectDelete: boolean, trigger: () => Promise<void>): Promise<void> {
  const rejected = await guardEdit(page, id, expectDelete);
  const edited = page.waitForResponse(endpoint(EDIT_PATH, "POST"), { timeout: 30_000 });
  edited.catch(() => undefined);
  await trigger();
  try {
    const body = assertTikTokOk(await readJson<EditResponse>(await awaitOrClassify(page, edited, "editing the video")), "the edit");
    const failed = body.edit_result?.edit_biz_result?.find((entry) => (entry.status_code ?? 0) !== 0);
    if (failed) throw new AppError("API_ERROR", "TikTok rejected part of the edit.", { tiktokCode: failed.status_code });
  } catch (error) {
    throw rejected() ?? outcomeUnknown(error, "tiktok video list");
  }
}

export const videoUpdate: Command = {
  path: ["video", "update"],
  summary: "Change who can watch one of your videos. Gated.",
  args: [{ name: "id", description: "Video id", required: true }],
  flags: [
    { name: "privacy", type: "string", description: "New audience", choices: UPDATE_PRIVACY },
    { name: "dry-run", type: "boolean", description: "Open the selector but do not change anything" },
  ],
  gated: true,
  output: "{ videoId, changed: { privacy } } | { dryRun: true, plan }",
  async run(ctx) {
    const id = requireVideoId(ctx);
    const privacy = ctx.flags.privacy as UpdatePrivacy | undefined;
    if (!privacy) throw new AppError("VALIDATION", "Nothing to update.", { hint: `tiktok video update ${id} --privacy friends` });
    const data = await withBrowser(ctx, {}, async ({ page }) => {
      step(ctx.mode, "Finding the video…");
      const video = await findVideo(page, id);
      const plan: Plan = {
        action: "video.update",
        summary: `Change who can watch this video to ${privacy}`,
        details: { video: video.description || id, from: video.visibility, to: privacy },
      };
      if (video.visibility === privacy) throw new AppError("VALIDATION", `Video ${id} is already visible to ${privacy}.`);
      const authorization = await authorize(ctx, plan);
      await markRow(page, id);
      await page.locator("[data-tt-row] button").filter({ hasText: /^(Seguidores|Amigos|Solo yo|Todos)$/ }).first().click();
      const option = page.locator("body *").filter({ hasText: ROW_PRIVACY_LABEL[privacy] }).last();
      await option.waitFor({ timeout: 10_000 });
      if (authorization === "dry-run") {
        recordDryRun(ctx, plan);
        return { dryRun: true as const, plan };
      }
      return audited(ctx, plan, async () => {
        await submitEdit(page, id, false, () => option.click());
        return { videoId: id, changed: { privacy } };
      });
    });
    return result({
      data,
      nextSteps: [`tiktok video get ${id}`],
      human: (value) => ("dryRun" in value ? "Dry run: nothing changed." : `${ok("✓")} Now visible to ${privacy}.`),
    });
  },
};

export const videoDelete: Command = {
  path: ["video", "delete"],
  summary: "Delete one of your videos (TikTok keeps it restorable for 30 days). Gated.",
  args: [{ name: "id", description: "Video id", required: true }],
  flags: [{ name: "dry-run", type: "boolean", description: "Open the menu but do not delete" }],
  gated: true,
  output: "{ videoId, deleted: true, restorableUntil } | { dryRun: true, plan }",
  async run(ctx) {
    const id = requireVideoId(ctx);
    const data = await withBrowser(ctx, {}, async ({ page }) => {
      step(ctx.mode, "Finding the video…");
      const video = await findVideo(page, id);
      const plan: Plan = {
        action: "video.delete",
        summary: "Delete this video (restorable for 30 days from Activity Center)",
        details: { video: video.description || id, posted: video.createdAt.slice(0, 10), views: String(video.views) },
      };
      const authorization = await authorize(ctx, plan);
      await markRow(page, id);
      await page.locator("[data-tt-row]").hover();
      await page.locator("[data-tt-row] button").last().click();
      const menuItem = page.getByText("Eliminar", { exact: true }).first();
      await menuItem.waitFor({ timeout: 10_000 });
      if (authorization === "dry-run") {
        recordDryRun(ctx, plan);
        return { dryRun: true as const, plan };
      }
      return audited(ctx, plan, async () => {
        await menuItem.click();
        await page.getByText("¿Eliminar la publicación?").waitFor({ timeout: 10_000 });
        await submitEdit(page, id, true, () => page.getByText("Eliminar", { exact: true }).last().click());
        const restorableUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        return { videoId: id, deleted: true as const, restorableUntil };
      });
    });
    return result({
      data,
      nextSteps: ["tiktok video list"],
      human: (value) => ("dryRun" in value ? "Dry run: nothing deleted." : `${ok("✓")} Deleted ${muted(`(restorable until ${value.restorableUntil.slice(0, 10)})`)}`),
    });
  },
};
