import { describe, expect, test } from "bun:test";
import { toSeries } from "../src/tiktok/insight.ts";
import { readVisibility, toVideo } from "../src/tiktok/video.ts";

describe("video mapping", () => {
  test("string counters from item_list become numbers", () => {
    const video = toVideo(
      { item_id: "1", desc: "hi", create_time: "1791132963", visibility: 3, status: 143, play_count: "12", like_count: "3", comment_count: "0", share_count: "1", favorite_count: "2", duration: 6000, cover_url: ["c"] },
      "me",
    );
    expect(video).toMatchObject({ views: 12, likes: 3, shares: 1, saves: 2, durationSec: 6, visibility: "friends", url: "https://www.tiktok.com/@me/video/1" });
    expect(video.createdAt).toBe("2026-10-04T16:56:03.000Z");
  });

  test("only observed visibility codes are named", () => {
    expect(readVisibility(2)).toBe("only-me");
    expect(readVisibility(3)).toBe("friends");
    expect(readVisibility(1)).toBe("unknown");
  });
});

describe("insight series", () => {
  test("epoch keys become ISO dates", () => {
    expect(toSeries({ list: [{ key: "1791129600", value: 4 }], total: 4 })).toEqual({ total: 4, points: [{ date: "2026-10-04T16:00:00.000Z", value: 4 }] });
    expect(toSeries(null)).toEqual({ total: 0, points: [] });
  });
});

import { toOverview } from "../src/commands/analytics.ts";

describe("analytics overview layout", () => {
  test("[previous N][current N][2 pending] splits into totals and change", () => {
    const day = (value: number) => ({ status: 0, value });
    const vv = [...Array(7).fill(day(1)), ...Array(7).fill(day(2)), { status: 2 }, { status: 2 }];
    const overview = toOverview({ vv_history: vv }, 5, 7);
    expect(overview.metrics.views).toMatchObject({ total: 14, previousTotal: 7, change: 1 });
    expect(overview.metrics.views.points).toHaveLength(7);
    expect(overview.dataReady).toBe(true);
    expect(overview.metrics.likes.total).toBe(0);
  });

  test("status 2 days are missing values, not zeros", () => {
    const overview = toOverview({ vv_history: Array(16).fill({ status: 2 }) }, null, 7);
    expect(overview.dataReady).toBe(false);
    expect(overview.metrics.views.points.every((point) => point.value === null)).toBe(true);
  });
});
