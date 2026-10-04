import { describe, expect, test } from "bun:test";
import { AppError } from "../src/core/errors.ts";
import { findScheduleTime, monthIndex, parseSchedule } from "../src/tiktok/post.ts";

const now = new Date(2026, 9, 4, 13, 0);

describe("schedule validation", () => {
  test("parses local time into date, time and epoch", () => {
    const schedule = parseSchedule("2026-10-05 09:00", "friends", now)!;
    expect(schedule).toMatchObject({ date: "2026-10-05", time: "09:00" });
    expect(schedule.epoch).toBe(Math.floor(new Date(2026, 9, 5, 9, 0).getTime() / 1000));
  });

  test("rejects minutes outside 5-minute steps, with both neighbours as a hint", () => {
    try {
      parseSchedule("2026-10-05 09:07", "friends", now);
      throw new Error("should throw");
    } catch (error) {
      expect((error as AppError).details.hint).toBe("Use :05 or :10.");
    }
  });

  test("rejects only-me, the past, too soon and impossible dates", () => {
    expect(() => parseSchedule("2026-10-05 09:00", "only-me", now)).toThrow(AppError);
    expect(() => parseSchedule("2026-10-04 13:10", "friends", now)).toThrow(/15 minutes/);
    expect(() => parseSchedule("2026-02-30 10:00", "friends", now)).toThrow(/not a real date/);
    expect(() => parseSchedule("tomorrow", "friends", now)).toThrow(/Invalid --schedule/);
  });

  test("no schedule means publish now", () => {
    expect(parseSchedule(undefined, "only-me", now)).toBeUndefined();
  });
});

describe("post request inspection", () => {
  test("finds schedule_time anywhere in the post body", () => {
    expect(findScheduleTime({ single_post_req_list: [{ schedule_time: 1791999900 }] })).toBe(1791999900);
    expect(findScheduleTime({ a: { schedule_time: "1791999900" } })).toBe(1791999900);
    expect(findScheduleTime({})).toBeUndefined();
  });

  test("spanish month names map to indexes", () => {
    expect(monthIndex("Octubre")).toBe(9);
    expect(monthIndex("noviembre")).toBe(10);
  });
});
