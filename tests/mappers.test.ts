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
    expect(overview.metrics.likes.total).toBeNull();
  });

  test("status 2 days are missing values, not zeros", () => {
    const overview = toOverview({ vv_history: Array(16).fill({ status: 2 }) }, null, 7);
    expect(overview.dataReady).toBe(false);
    expect(overview.metrics.views.points.every((point) => point.value === null)).toBe(true);
    expect(overview.metrics.views).toMatchObject({ total: null, previousTotal: null, change: null });
  });
});

import { isUnansweredQuery, toComment } from "../src/tiktok/comment.ts";

describe("comment mapping", () => {
  test("commentsV2 rows become Comment", () => {
    const comment = toComment({
      commentId: "7692860095478580001",
      text: "hola test 1",
      createTime: 1791133584,
      likeCount: 0,
      replyCount: 1,
      hasCreatorLiked: false,
      user: { uid: "1", uniqueId: "fan", nickname: "Fan" },
      item: { itemId: "9", desc: "video" },
    });
    expect(comment).toMatchObject({ id: "7692860095478580001", replies: 1, author: { username: "fan" }, video: { id: "9" } });
    expect(comment.createdAt).toBe("2026-10-04T17:06:24.000Z");
  });

  test("unanswered requests are recognised by the creator_replied filter", () => {
    expect(isUnansweredQuery('{"filterConditions":[{"fieldName":"creator_replied","op":0,"field":"0"}]}')).toBe(true);
    expect(isUnansweredQuery('{"filterConditions":[]}')).toBe(false);
  });
});

describe("scheduled videos", () => {
  test("a schedule_time in the future becomes scheduledAt; a past one is a normal post", () => {
    const now = Date.parse("2026-10-04T19:20:00Z");
    expect(toVideo({ item_id: "1", create_time: "1791141360", schedule_time: "1791219600" }, "me", now).scheduledAt).toBe("2026-10-05T17:00:00.000Z");
    expect(toVideo({ item_id: "1", create_time: "1791132963", schedule_time: "1791132963" }, "me", now).scheduledAt).toBeNull();
  });
});
