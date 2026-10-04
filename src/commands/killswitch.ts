import { getKillswitchState, turnKillswitchOff, turnKillswitchOn } from "../cli/safety/killswitch.ts";
import { danger, ok } from "../cli/platform/style.ts";
import type { Command } from "../core/command.ts";
import { ensureDir } from "../core/paths.ts";

export const killswitchOn: Command = {
  path: ["killswitch", "on"],
  summary: "Block every write command (reply, post, update, delete) until turned off.",
  args: [],
  flags: [{ name: "reason", type: "string", description: "Why writes are stopped" }],
  gated: false,
  output: "{ active: true, reason, activatedAt }",
  async run(ctx) {
    turnKillswitchOn(ensureDir(ctx.paths.home), String(ctx.flags.reason ?? "manual"));
    const state = getKillswitchState(ctx.paths.home);
    return { data: state, human: () => `${danger("■")} Killswitch ON. Writes are blocked.` };
  },
};

export const killswitchOff: Command = {
  path: ["killswitch", "off"],
  summary: "Allow write commands again.",
  args: [],
  flags: [],
  gated: false,
  output: "{ active: false }",
  async run(ctx) {
    turnKillswitchOff(ctx.paths.home);
    return { data: getKillswitchState(ctx.paths.home), human: () => `${ok("●")} Killswitch off.` };
  },
};
