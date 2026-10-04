import { bold, muted, ok } from "../cli/platform/style.ts";
import { type Command, result } from "../core/command.ts";
import { AppError } from "../core/errors.ts";
import { confirm, isInteractive } from "../core/gate.ts";
import { listIntents, loadIntent, removeIntent } from "../core/intents.ts";
import { renderTable } from "../core/output.ts";

export const intentList: Command = {
  path: ["intent", "list"],
  summary: "List write actions prepared by an agent and waiting for your approval.",
  args: [],
  flags: [],
  gated: false,
  output: "{ intents: Intent[] }",
  async run(ctx) {
    const intents = listIntents(ctx.paths.intents);
    return result({
      data: { intents },
      nextSteps: intents.map((intent) => `tiktok intent approve ${intent.id}`),
      human: (data) =>
        data.intents.length === 0
          ? muted("No pending intents.")
          : renderTable(data.intents, [
              { header: "ID", value: (intent) => bold(intent.id) },
              { header: "ACTION", value: (intent) => intent.plan.summary, maxWidth: 50 },
              { header: "COMMAND", value: (intent) => `tiktok ${intent.argv.map((arg) => (/s/.test(arg) ? JSON.stringify(arg) : arg)).join(" ")}`, maxWidth: 70 },
              { header: "EXPIRES", value: (intent) => intent.expiresAt.slice(0, 16).replace("T", " ") },
            ]),
    });
  },
};

export const intentApprove: Command = {
  path: ["intent", "approve"],
  summary: "Review and run a pending intent. Needs a real terminal: agents cannot approve.",
  args: [{ name: "id", description: "Intent id from `tiktok intent list`", required: true }],
  flags: [],
  gated: false,
  output: "Output of the approved command",
  async run(ctx) {
    if (!isInteractive(ctx)) {
      throw new AppError("APPROVAL_REQUIRED", "Intents can only be approved from an interactive terminal.", {
        cause: "stdin/stderr are not a TTY or --json was passed.",
        hint: `Ask the human to run: tiktok intent approve ${ctx.args[0]}`,
      });
    }
    const intent = loadIntent(ctx.paths.intents, ctx.args[0]!);
    if (!(await confirm(intent.plan))) {
      throw new AppError("APPROVAL_DENIED", "Cancelled.", { cause: "You answered no." });
    }
    removeIntent(ctx.paths.intents, intent.id);
    const { runApproved } = await import("../runner.ts");
    const result = await runApproved(intent.argv, intent.id);
    return { ...result, nextSteps: result.nextSteps ?? [] };
  },
};

export const intentDiscard: Command = {
  path: ["intent", "discard"],
  summary: "Drop a pending intent without running it.",
  args: [{ name: "id", description: "Intent id", required: true }],
  flags: [],
  gated: false,
  output: "{ discarded: string }",
  async run(ctx) {
    const intent = loadIntent(ctx.paths.intents, ctx.args[0]!);
    removeIntent(ctx.paths.intents, intent.id);
    return { data: { discarded: intent.id }, human: () => `${ok("✓")} Discarded ${intent.id}.` };
  },
};
