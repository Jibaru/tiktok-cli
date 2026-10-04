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
    expect(toSeries({ list: [{ key: "1791129600", value: 4 }], total: 4 })).toEqual({ total: 4, points: [{ date: "2026-10-04T05:00:00.000Z", value: 4 }] });
    expect(toSeries(null)).toEqual({ total: 0, points: [] });
  });
});
