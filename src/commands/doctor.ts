import { accessSync, constants, existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { withBrowser } from "../browser/session.ts";
import { readCurrentUser } from "../browser/studio.ts";
import { getKillswitchState } from "../cli/safety/killswitch.ts";
import { danger, ok } from "../cli/platform/style.ts";
import { type Command, type Context, result } from "../core/command.ts";
import { ensureDir } from "../core/paths.ts";

type Check = { name: string; ok: boolean; detail: string };

async function runChecks(checks: Array<() => Promise<Check>>): Promise<Check[]> {
  const results: Check[] = [];
  for (const check of checks) results.push(await check().catch((error) => ({ name: "check", ok: false, detail: String(error) })));
  return results;
}

const chromeInstalled = async (): Promise<Check> => {
  try {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    const version = browser.version();
    await browser.close();
    return { name: "chrome", ok: true, detail: `Google Chrome ${version}` };
  } catch (error) {
    return { name: "chrome", ok: false, detail: "Google Chrome not found. Install it from google.com/chrome." };
  }
};

const writableDirs = (ctx: Context) => async (): Promise<Check> => {
  for (const dir of [ctx.paths.home, ctx.paths.audit, ctx.paths.intents, ctx.paths.debug]) {
    try {
      accessSync(ensureDir(dir), constants.W_OK);
    } catch {
      return { name: "storage", ok: false, detail: `${dir} is not writable.` };
    }
  }
  return { name: "storage", ok: true, detail: ctx.paths.home };
};

const killswitch = (ctx: Context) => async (): Promise<Check> => {
  const state = getKillswitchState(ctx.paths.home);
  return state.active
    ? { name: "killswitch", ok: false, detail: `ON since ${state.activatedAt}: writes blocked (tiktok killswitch off).` }
    : { name: "killswitch", ok: true, detail: "off" };
};

const session = (ctx: Context) => async (): Promise<Check> => {
  if (!existsSync(ctx.paths.browserProfile)) {
    return { name: "session", ok: false, detail: "No profile yet. Run `tiktok auth login`." };
  }
  const user = await withBrowser(ctx, {}, async ({ page }) => readCurrentUser(page));
  return user
    ? { name: "session", ok: true, detail: `@${user.username}` }
    : { name: "session", ok: false, detail: "Expired. Run `tiktok auth login`." };
};

export const doctor: Command = {
  path: ["doctor", "run"],
  shorthand: "doctor",
  summary: "Check Chrome, storage, killswitch and the TikTok session.",
  args: [],
  flags: [{ name: "offline", type: "boolean", description: "Skip the live session check" }],
  gated: false,
  output: "{ ok: boolean, checks: [{ name, ok, detail }] }",
  async run(ctx) {
    const checks = [chromeInstalled, writableDirs(ctx), killswitch(ctx)];
    if (!ctx.flags.offline) checks.push(session(ctx));
    const results = await runChecks(checks);
    const healthy = results.every((check) => check.ok);
    return result({
      data: { ok: healthy, checks: results },
      nextSteps: results.filter((check) => !check.ok && check.name === "session").map(() => "tiktok auth login"),
      human: (data) =>
        [
          ...data.checks.map((check) => `${check.ok ? ok("✓") : danger("✖")} ${check.name.padEnd(11)}${check.detail}`),
          "",
          `${data.checks.filter((check) => check.ok).length}/${data.checks.length} checks passed`,
        ].join("\n"),
    });
  },
};
