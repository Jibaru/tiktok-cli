import { existsSync, rmSync } from "node:fs";
import { withBrowser } from "../browser/session.ts";
import { readCurrentUser, waitForLogin, type StudioUser } from "../browser/studio.ts";
import { bold, muted, ok, warn } from "../cli/platform/style.ts";
import { type Command, result } from "../core/command.ts";
import { audited, authorize, recordDryRun } from "../core/gate.ts";
import { step } from "../core/output.ts";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function describeUser(user: StudioUser): string {
  const privacy = user.isPrivate ? muted("private account") : muted("public account");
  return `${ok("●")} Logged in as ${bold(`@${user.username}`)} ${muted(`(${user.nickname}, ${user.region})`)} · ${privacy}`;
}

export const authLogin: Command = {
  path: ["auth", "login"],
  summary: "Open Chrome and log in to TikTok once; the session is kept in a local profile.",
  args: [],
  flags: [],
  gated: false,
  output: "{ user: User }",
  async run(ctx) {
    const user = await withBrowser(ctx, { headed: true, requireProfile: false }, async ({ page }) => {
      const existing = await readCurrentUser(page);
      if (existing) return existing;
      step(ctx.mode, "Log in in the Chrome window (QR is the most reliable). Waiting up to 5 minutes…");
      return waitForLogin(page, LOGIN_TIMEOUT_MS);
    });
    return result({
      data: { user },
      nextSteps: ["tiktok video list", "tiktok comment inbox"],
      human: (data) => describeUser(data.user),
    });
  },
};

export const authStatus: Command = {
  path: ["auth", "status"],
  summary: "Check whether the saved TikTok session is still valid.",
  args: [],
  flags: [],
  gated: false,
  output: "{ loggedIn: boolean, user?: User }",
  async run(ctx) {
    if (!existsSync(ctx.paths.browserProfile)) {
      return result({
        data: { loggedIn: false },
        nextSteps: ["tiktok auth login"],
        human: () => `${warn("●")} Not logged in.`,
      });
    }
    const user = await withBrowser(ctx, {}, async ({ page }) => readCurrentUser(page));
    return result({
      data: user ? { loggedIn: true, user } : { loggedIn: false },
      nextSteps: user ? [] : ["tiktok auth login"],
      human: () => (user ? describeUser(user) : `${warn("●")} Session expired.`),
    });
  },
};

export const authLogout: Command = {
  path: ["auth", "logout"],
  summary: "Delete the local browser profile (cookies and session).",
  args: [],
  flags: [{ name: "dry-run", type: "boolean", description: "Show what would be removed" }],
  gated: true,
  output: "{ removed: boolean, profile: string }",
  async run(ctx) {
    const profile = ctx.paths.browserProfile;
    const plan = { action: "auth.logout", summary: "Delete the local TikTok session", details: { profile } };
    const authorization = await authorize(ctx, plan);
    if (authorization === "dry-run") {
      recordDryRun(ctx, plan);
      return { data: { removed: false, dryRun: true, profile }, human: () => `Would delete ${profile}` };
    }
    const removed = await audited(ctx, plan, async () => {
      const existed = existsSync(profile);
      rmSync(profile, { recursive: true, force: true });
      return existed;
    });
    return result({
      data: { removed, profile },
      nextSteps: ["tiktok auth login"],
      human: () => (removed ? `${ok("✓")} Session deleted.` : "No session to delete."),
    });
  },
};
