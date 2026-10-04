import type { Page, Response } from "playwright-core";
import { withBrowser } from "../browser/session.ts";
import { awaitOrClassify, openStudio, readJson, assertTikTokOk } from "../browser/studio.ts";
import { bold, danger, info, muted, ok } from "../cli/platform/style.ts";
import { result, type Command } from "../core/command.ts";
import { compactNumber, renderTable, sparkline, step } from "../core/output.ts";
import { INSIGHT_PATH } from "../tiktok/insight.ts";

const RANGES = ["7", "28", "60", "365"] as const;

const METRICS = {
  views: "vv_history",
  profileViews: "pv_history",
  likes: "like_history",
  comments: "comment_history",
  shares: "share_history",
  followers: "follower_num_history",
  reached: "reached_audience_history",
} as const;

type MetricName = keyof typeof METRICS;
type RawDay = { status?: number; value?: number } | number | null;
type HistoryResponse = Record<string, RawDay[] | undefined>;

export type DailyPoint = { date: string; value: number | null };
export type Metric = { total: number; previousTotal: number; change: number | null; points: DailyPoint[] };

export type Overview = {
  range: { days: number; from: string; to: string };
  dataReady: boolean;
  followers: number | null;
  metrics: Record<MetricName, Metric>;
};

function historyRequestDays(response: Response): number | undefined {
  const url = new URL(response.url());
  if (url.pathname !== INSIGHT_PATH) return undefined;
  const raw = url.searchParams.get("type_requests") ?? "";
  if (!raw.includes("vv_history")) return undefined;
  const first = (JSON.parse(raw) as { days?: number }[])[0];
  return first?.days;
}

function isFollowerCount(response: Response): boolean {
  const url = new URL(response.url());
  return url.pathname === INSIGHT_PATH && /"follower_num"/.test(url.searchParams.get("type_requests") ?? "");
}

const requestedDays = (range: number) => range * 2 + 2;

async function loadHistory(page: Page, range: number): Promise<{ history: HistoryResponse; followers: number | null }> {
  const followerResponse = page.waitForResponse(isFollowerCount, { timeout: 30_000 }).catch(() => undefined);
  const { body } = await openStudio<HistoryResponse>(page, "/analytics", (response) => historyRequestDays(response) === requestedDays(7), "loading analytics");
  let history = body;
  if (range !== 7) {
    const next = page.waitForResponse((response) => historyRequestDays(response) === requestedDays(range), { timeout: 30_000 });
    next.catch(() => undefined);
    await page.getByText("Los últimos 7 días").first().click();
    await page.getByText(`Los últimos ${range} días`).first().click();
    history = assertTikTokOk(await readJson<HistoryResponse>(await awaitOrClassify(page, next, `switching to ${range} days`)), "analytics");
  }
  const followerBody = await followerResponse;
  const followers = followerBody ? valueOf((await followerBody.json().catch(() => ({}))).follower_num) : null;
  return { history, followers };
}

function valueOf(day: RawDay | undefined): number | null {
  if (typeof day === "number") return day;
  if (day && day.status === 0 && typeof day.value === "number") return day.value;
  return null;
}

// Layout inferred from the Studio chart: [previous N][current N][2 days not final yet], newest last, ending yesterday.
function toMetric(days: RawDay[] | undefined, range: number, dates: string[]): Metric {
  const values = (days ?? []).map(valueOf);
  const previous = values.slice(0, range);
  const current = values.slice(range, range * 2);
  const sum = (list: (number | null)[]) => list.reduce<number>((total, value) => total + (value ?? 0), 0);
  const total = sum(current);
  const previousTotal = sum(previous);
  return {
    total,
    previousTotal,
    change: previousTotal > 0 ? (total - previousTotal) / previousTotal : null,
    points: current.map((value, index) => ({ date: dates[index] ?? "", value })),
  };
}

function periodDates(range: number): string[] {
  const lastDay = new Date();
  lastDay.setUTCHours(0, 0, 0, 0);
  lastDay.setUTCDate(lastDay.getUTCDate() - 3);
  return Array.from({ length: range }, (_, index) => {
    const date = new Date(lastDay);
    date.setUTCDate(lastDay.getUTCDate() - (range - 1 - index));
    return date.toISOString().slice(0, 10);
  });
}

export function toOverview(history: HistoryResponse, followers: number | null, range: number): Overview {
  const dates = periodDates(range);
  const metrics = Object.fromEntries(
    Object.entries(METRICS).map(([name, key]) => [name, toMetric(history[key], range, dates)]),
  ) as Record<MetricName, Metric>;
  const dataReady = Object.values(metrics).some((metric) => metric.points.some((point) => point.value !== null));
  return { range: { days: range, from: dates[0]!, to: dates.at(-1)! }, dataReady, followers, metrics };
}

const LABELS: Record<MetricName, string> = {
  views: "Video views",
  profileViews: "Profile views",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  followers: "Followers",
  reached: "Reached audience",
};

function formatChange(change: number | null): string {
  if (change === null) return muted("–");
  const text = `${change >= 0 ? "+" : ""}${(change * 100).toFixed(0)}%`;
  return change >= 0 ? ok(text) : danger(text);
}

function renderOverview(overview: Overview): string {
  const rows = Object.entries(overview.metrics) as [MetricName, Metric][];
  const table = renderTable(rows, [
    { header: "METRIC", value: ([name]) => LABELS[name] },
    { header: "TOTAL", value: ([, metric]) => bold(compactNumber(metric.total)), align: "right" },
    { header: "VS PREV", value: ([, metric]) => formatChange(metric.change), align: "right" },
    { header: "TREND", value: ([, metric]) => info(sparkline(metric.points.map((point) => point.value ?? 0))) },
  ]);
  const header = `${bold(`Last ${overview.range.days} days`)} ${muted(`${overview.range.from} → ${overview.range.to}`)}${
    overview.followers === null ? "" : muted(` · ${compactNumber(overview.followers)} followers`)
  }`;
  const note = overview.dataReady ? "" : `\n\n${muted("TikTok has no analytics for this range yet (new or inactive account).")}`;
  return `${header}\n\n${table}${note}`;
}

export const analyticsOverview: Command = {
  path: ["analytics", "overview"],
  shorthand: "stats",
  summary: "Account totals and daily trends: views, profile views, likes, comments, shares, followers.",
  args: [],
  flags: [{ name: "days", type: "string", description: "Range in days", choices: RANGES, default: "7" }],
  gated: false,
  output: "{ range, dataReady, followers, metrics: { views|profileViews|likes|comments|shares|followers|reached: { total, previousTotal, change, points[] } } }",
  async run(ctx) {
    const range = Number(ctx.flags.days);
    const overview = await withBrowser(ctx, {}, async ({ page }) => {
      step(ctx.mode, `Loading analytics for the last ${range} days…`);
      const { history, followers } = await loadHistory(page, range);
      return toOverview(history, followers, range);
    });
    return result({
      data: overview,
      nextSteps: ["tiktok video list --sort views"],
      human: renderOverview,
    });
  },
};
