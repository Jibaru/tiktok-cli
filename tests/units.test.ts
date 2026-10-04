import { describe, expect, test } from "bun:test";
import { parseArgv } from "../src/cli/foundation/argv.ts";
import { assertTikTokOk } from "../src/browser/studio.ts";
import { AppError } from "../src/core/errors.ts";
import { pickFields, sparkline } from "../src/core/output.ts";

describe("argv", () => {
  test("boolean flags never swallow the next positional", () => {
    expect(parseArgv(["--json", "video", "list"], new Set(["json"]))._).toEqual(["video", "list"]);
  });
});

describe("tiktok envelope", () => {
  test("status_code 0 passes", () => {
    expect(assertTikTokOk({ status_code: 0 }, "x")).toEqual({ status_code: 0 });
  });

  test("HTTP 200 with a business error becomes API_ERROR with log id", () => {
    try {
      assertTikTokOk({ status_code: 2209, status_msg: "Este vídeo no existe", extra: { logid: "L1" } }, "commenting");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).toJSON()).toMatchObject({ code: "API_ERROR", tiktokCode: 2209, logId: "L1" });
      expect((error as AppError).exitCode).toBe(1);
    }
  });
});

describe("output helpers", () => {
  test("pickFields keeps requested keys of collections", () => {
    expect(pickFields({ items: [{ a: 1, b: 2 }], hasMore: false }, ["a"])).toEqual({ items: [{ a: 1 }], hasMore: false });
  });

  test("pickFields rejects fields that exist nowhere", () => {
    expect(() => pickFields({ a: 1 }, ["zzz"])).toThrow(AppError);
  });

  test("sparkline scales to the max", () => {
    expect(sparkline([0, 5, 10])).toBe("▁▄█");
    expect(sparkline([0, 0])).toBe("▁▁");
  });
});
