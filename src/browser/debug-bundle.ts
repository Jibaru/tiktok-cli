import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { ensureDir } from "../core/paths.ts";
import type { NetworkRecorder } from "./network-recorder.ts";

export type BundleInput = {
  debugRoot: string;
  command: string;
  page?: Page;
  context: BrowserContext;
  recorder: NetworkRecorder;
  error?: unknown;
};

export async function writeDebugBundle(input: BundleInput): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = ensureDir(join(input.debugRoot, `${stamp}_${input.command.replace(/\s+/g, "-")}`));

  await attempt(() => input.context.tracing.stop({ path: join(dir, "trace.zip") }));
  if (input.page && !input.page.isClosed()) {
    await attempt(() => input.page!.screenshot({ path: join(dir, "screenshot.png"), fullPage: true }));
    await attempt(async () => writeFileSync(join(dir, "page.html"), await input.page!.content()));
    writeFileSync(join(dir, "url.txt"), input.page.url());
  }
  writeFileSync(join(dir, "network.json"), JSON.stringify(input.recorder.snapshot(), null, 2));
  if (input.error) writeFileSync(join(dir, "error.json"), JSON.stringify(describe(input.error), null, 2));
  return dir;
}

async function attempt(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch {
    // A partial bundle beats no bundle.
  }
}

function describe(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack, ...(error as object) };
  return { error: String(error) };
}
