import { existsSync } from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import type { Context } from "../core/command.ts";
import { AppError, toAppError } from "../core/errors.ts";
import { ensureDir } from "../core/paths.ts";
import { step } from "../core/output.ts";
import { writeDebugBundle } from "./debug-bundle.ts";
import { NetworkRecorder } from "./network-recorder.ts";

export type BrowserSession = {
  context: BrowserContext;
  page: Page;
  recorder: NetworkRecorder;
};

type OpenOptions = {
  headed?: boolean;
  requireProfile?: boolean;
};

export async function withBrowser<T>(
  ctx: Context,
  options: OpenOptions,
  work: (session: BrowserSession) => Promise<T>,
): Promise<T> {
  const session = await openBrowser(ctx, options);
  try {
    const result = await work(session);
    if (ctx.global.debug) await reportBundle(ctx, session);
    else await session.context.tracing.stop();
    return result;
  } catch (error) {
    const appError = toAppError(error);
    const bundle = await writeDebugBundle({ debugRoot: ctx.paths.debug, command: ctx.command, ...session, error: appError });
    throw appError.withDebugBundle(bundle);
  } finally {
    await session.context.close().catch(() => undefined);
  }
}

async function reportBundle(ctx: Context, session: BrowserSession): Promise<void> {
  const bundle = await writeDebugBundle({ debugRoot: ctx.paths.debug, command: ctx.command, ...session });
  step(ctx.mode, `Debug bundle: ${bundle}`);
}

async function openBrowser(ctx: Context, options: OpenOptions): Promise<BrowserSession> {
  const profileDir = ctx.paths.browserProfile;
  if (options.requireProfile !== false && !existsSync(profileDir)) {
    throw new AppError("AUTH_REQUIRED", "No TikTok session on this machine yet.", {
      hint: "tiktok auth login",
    });
  }
  ensureDir(profileDir);
  step(ctx.mode, "Opening Chrome…");
  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: "chrome",
      headless: !(options.headed ?? ctx.global.headed),
      viewport: { width: 1920, height: 1000 },
      args: ["--disable-blink-features=AutomationControlled"],
    });
  } catch (error) {
    throw classifyLaunchError(error);
  }
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = context.pages()[0] ?? (await context.newPage());
  const recorder = new NetworkRecorder();
  recorder.attach(page);
  return { context, page, recorder };
}

function classifyLaunchError(error: unknown): AppError {
  const message = error instanceof Error ? error.message : String(error);
  if (/Chromium distribution 'chrome' is not found|not found at/i.test(message)) {
    return new AppError("INTERNAL", "Google Chrome is not installed.", {
      cause: message.split("\n")[0],
      hint: "Install Google Chrome, then run `tiktok doctor`.",
    });
  }
  if (/ProcessSingleton|user data directory is already in use|lock/i.test(message)) {
    return new AppError("INTERNAL", "The TikTok browser profile is already open.", {
      cause: message.split("\n")[0],
      hint: "Close the other tiktok command or its Chrome window and retry.",
      retryable: true,
    });
  }
  return toAppError(error);
}
