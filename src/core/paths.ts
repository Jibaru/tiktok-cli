import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getAppPaths } from "../cli/foundation/xdg-paths.ts";

export const APP_NAME = "tiktok-cli";

export type Paths = ReturnType<typeof resolvePaths>;

export function resolvePaths(profile = "default") {
  const app = getAppPaths(APP_NAME);
  return {
    home: app.home,
    audit: app.audit,
    intents: join(app.state, "intents"),
    debug: join(app.state, "debug"),
    browserProfile: join(app.state, "profiles", profile),
  };
}

export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}
