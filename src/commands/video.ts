import type { Page } from "playwright-core";
import { withBrowser } from "../browser/session.ts";
import { endpoint, openStudio, readJson, type StudioUser } from "../browser/studio.ts";
import { bold, info, muted } from "../cli/platform/style.ts";
import { result, type Command } from "../core/command.ts";
import { AppError } from "../core/errors.ts";
import { compactNumber, renderTable, sparkline, step } from "../core/output.ts";
import { INSIGHT_PATH, requestedInsightTypes, scalar, shares, toSeries, type RawHistory, type RawScalar, type Series } from "../tiktok/insight.ts";
import { toVideo, videoUrl, type ItemListResponse, type Video } from "../tiktok/video.ts";

const ITEM_LIST_PATH = "/tiktok/creator/manage/item_list/v1/";
const SORTS = ["posted", "views", "likes", "comments"] as const;
type Sort = (typeof SORTS)[number];

const SORT_KEY: Record<Exclude<Sort, "posted">, keyof Video> = { views: "views", likes: "likes", comments: "comments" };

export async function loadVideos(page: Page, limit: number): Promise<{ user: StudioUser; videos: Video[]; hasMore: boolean }> {
  const { user, body } = await openStudio<ItemListResponse>(page, "/content", endpoint(ITEM_LIST_PATH, "POST"), "loading your videos");
  const byId = new Map<string, Video>();
  const add = (response: ItemListResponse) => response.item_list?.forEach((item) => byId.set(item.item_id, toVideo(item, user.username)));
  add(body);
  let hasMore = body.has_more ?? false;
  while (byId.size < limit && hasMore) {
    const next = page.waitForResponse(endpoint(ITEM_LIST_PATH, "POST"), { timeout: 10_000 }).catch(() => undefined);
    await page.mouse.wheel(0, 20_000);
    const response = await next;
    if (!response) break;
    const nextPage = await readJson<ItemListResponse>(response);
    add(nextPage);
    hasMore = nextPage.has_more ?? false;
  }
  const videos = [...byId.values()];
  return { user, videos: videos.slice(0, limit), hasMore: hasMore || videos.length > limit };
}

function sortVideos(videos: Video[], sort: Sort): Video[] {
  if (sort === "posted") return [...videos].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const key = SORT_KEY[sort];
  return [...videos].sort((a, b) => Number(b[key]) - Number(a[key]));
}

const VISIBILITY_LABEL: Record<Video["visibility"], string> = {
  everyone: "public",
  followers: "followers",
  friends: "friends",
  "only-me": "only me",
  unknown: "?",
};

function renderVideos(videos: Video[], hasMore: boolean): string {
  if (videos.length === 0) return muted("No videos yet. Post one with `tiktok video post <file>`.");
  const table = renderTable(videos, [
    { header: "POSTED", value: (video) => video.createdAt.slice(0, 10) },
    { header: "ID", value: (video) => muted(video.id) },
    { header: "VISIBILITY", value: (video) => VISIBILITY_LABEL[video.visibility] },
    { header: "VIEWS", value: (video) => bold(compactNumber(video.views)), align: "right" },
    { header: "LIKES", value: (video) => compactNumber(video.likes), align: "right" },
    { header: "COMMENTS", value: (video) => compactNumber(video.comments), align: "right" },
    { header: "SHARES", value: (video) => compactNumber(video.shares), align: "right" },
    { header: "DESCRIPTION", value: (video) => video.description || muted("(no description)"), maxWidth: 48 },
  ]);
  const footer = muted(`${videos.length} video${videos.length === 1 ? "" : "s"}${hasMore ? " · more available, raise --limit" : ""}`);
  return `${table}\n\n${footer}`;
}

export const videoList: Command = {
  path: ["video", "list"],
  shorthand: "videos",
  summary: "List your videos with views, likes, comments and shares.",
  args: [],
  flags: [
    { name: "limit", type: "number", description: "Maximum videos to return", default: 20 },
    { name: "sort", type: "string", description: "Order of the list", choices: SORTS, default: "posted" },
  ],
  gated: false,
  output: "{ videos: Video[], hasMore: boolean }",
  async run(ctx) {
    const limit = Number(ctx.flags.limit);
    if (!Number.isInteger(limit) || limit < 1) throw new AppError("VALIDATION", "--limit must be a positive integer.");
    const { videos, hasMore } = await withBrowser(ctx, {}, async ({ page }) => {
      step(ctx.mode, "Loading your videos…");
      return loadVideos(page, limit);
    });
    const sorted = sortVideos(videos, ctx.flags.sort as Sort);
    return result({
      data: { videos: sorted, hasMore },
      nextSteps: sorted.slice(0, 1).map((video) => `tiktok video get ${video.id}`),
      human: (data) => renderVideos(data.videos, data.hasMore),
    });
  },
};

type VideoInsight = {
  video_info?: {
    aweme_id?: string;
    desc?: string;
    create_time?: number;
    statistics?: { play_count?: number; digg_count?: number; comment_count?: number; share_count?: number; collect_count?: number };
    video?: { duration?: number };
  } | null;
  realtime_video_view_history?: RawHistory;
  video_finish_rate_realtime?: RawScalar;
  video_per_duration_realtime?: RawScalar;
  realtime_new_followers?: RawScalar;
  video_traffic_source_percent_realtime?: RawScalar;
};

export type VideoAnalytics = {
  views: Series;
  avgWatchSec: number | null;
  finishRate: number | null;
  newFollowers: number | null;
  trafficSources: { source: string; share: number }[];
};

function isVideoInsight(id: string) {
  return (url: string) => new URL(url).pathname === INSIGHT_PATH && url.includes(id) && requestedInsightTypes(url).includes("video_view_realtime");
}

async function loadVideoAnalytics(page: Page, id: string): Promise<{ user: StudioUser; insight: VideoInsight }> {
  const matches = isVideoInsight(id);
  const { user, body } = await openStudio<VideoInsight>(page, `/analytics/${id}`, (response) => matches(response.url()), "loading video analytics");
  if (!body.video_info?.aweme_id) {
    throw new AppError("VALIDATION", `No video with id ${id} on this account.`, { hint: "tiktok video list" });
  }
  return { user, insight: body };
}

function toAnalytics(insight: VideoInsight): VideoAnalytics {
  return {
    views: toSeries(insight.realtime_video_view_history),
    avgWatchSec: scalar(insight.video_per_duration_realtime),
    finishRate: scalar(insight.video_finish_rate_realtime),
    newFollowers: scalar(insight.realtime_new_followers),
    trafficSources: shares(insight.video_traffic_source_percent_realtime),
  };
}

function fromInsight(insight: VideoInsight, username: string, listed?: Video): Video {
  const info = insight.video_info!;
  const stats = info.statistics ?? {};
  return {
    id: info.aweme_id!,
    description: info.desc ?? "",
    createdAt: new Date((info.create_time ?? 0) * 1000).toISOString(),
    visibility: listed?.visibility ?? "unknown",
    status: listed?.status ?? 0,
    views: stats.play_count ?? 0,
    likes: stats.digg_count ?? 0,
    comments: stats.comment_count ?? 0,
    shares: stats.share_count ?? 0,
    saves: stats.collect_count ?? 0,
    durationSec: info.video?.duration ? info.video.duration / 1000 : null,
    coverUrl: listed?.coverUrl ?? null,
    url: videoUrl(username, info.aweme_id!),
  };
}

function percent(value: number | null): string {
  return value === null ? muted("–") : `${(value * 100).toFixed(1)}%`;
}

function renderVideo({ video, analytics }: { video: Video; analytics: VideoAnalytics }): string {
  const stat = (label: string, value: number) => `${bold(compactNumber(value))} ${muted(label)}`;
  const sources = analytics.trafficSources
    .filter((source) => source.share > 0)
    .map((source) => `${source.source} ${percent(source.share)}`)
    .join(muted(" · "));
  return [
    bold(video.description || "(no description)"),
    muted(`${video.id} · ${video.createdAt.slice(0, 16).replace("T", " ")} · ${VISIBILITY_LABEL[video.visibility]}`),
    "",
    [stat("views", video.views), stat("likes", video.likes), stat("comments", video.comments), stat("shares", video.shares), stat("saves", video.saves)].join("   "),
    "",
    `${muted("Views     ")} ${info(sparkline(analytics.views.points.map((point) => point.value)))}  ${muted(`${analytics.views.points.length} hourly points`)}`,
    `${muted("Finished  ")} ${percent(analytics.finishRate)}`,
    `${muted("Avg watch ")} ${analytics.avgWatchSec === null ? muted("–") : `${analytics.avgWatchSec.toFixed(1)}s`}`,
    `${muted("Followers ")} ${analytics.newFollowers ?? muted("–")} new`,
    ...(sources ? [`${muted("Sources   ")} ${sources}`] : []),
    "",
    muted(video.url),
  ].join("\n");
}

export const videoGet: Command = {
  path: ["video", "get"],
  summary: "Show one video with its stats, views over time, finish rate and traffic sources.",
  args: [{ name: "id", description: "Video id (from `tiktok video list`)", required: true }],
  flags: [],
  gated: false,
  output: "{ video: Video, analytics: VideoAnalytics }",
  async run(ctx) {
    const id = ctx.args[0]!;
    if (!/^\d{10,25}$/.test(id)) throw new AppError("VALIDATION", `"${id}" is not a TikTok video id.`, { hint: "tiktok video list" });
    const data = await withBrowser(ctx, {}, async ({ page }) => {
      step(ctx.mode, "Loading video…");
      const listed = (await loadVideos(page, 50)).videos.find((video) => video.id === id);
      step(ctx.mode, "Loading analytics…");
      const { user, insight } = await loadVideoAnalytics(page, id);
      return { video: fromInsight(insight, user.username, listed), analytics: toAnalytics(insight) };
    });
    return result({
      data,
      human: renderVideo,
    });
  },
};

