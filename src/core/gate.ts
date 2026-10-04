import { createInterface } from "node:readline/promises";
import { beginAudit } from "../cli/foundation/audit-lifecycle.ts";
import { getKillswitchState } from "../cli/safety/killswitch.ts";
import { bold, muted, warn } from "../cli/platform/style.ts";
import type { Context } from "./command.ts";
import { AppError } from "./errors.ts";
import { saveIntent, type Plan } from "./intents.ts";

export type Authorization = "dry-run" | "approved";

const APPROVED_INTENT_FLAG = "__approvedIntent";

export function markApproved(flags: Record<string, unknown>, intentId: string): void {
  flags[APPROVED_INTENT_FLAG] = intentId;
}

export function isInteractive(ctx: Context): boolean {
  return ctx.mode === "human" && Boolean(process.stdin.isTTY) && Boolean(process.stderr.isTTY);
}

export function assertKillswitchOff(ctx: Context): void {
  const state = getKillswitchState(ctx.paths.home);
  if (!state.active) return;
  throw new AppError("KILLSWITCH", "Writes are blocked by the killswitch.", {
    cause: `Active since ${state.activatedAt ?? "unknown"}${state.reason ? `: ${state.reason}` : ""}.`,
    hint: "tiktok killswitch off",
  });
}

export async function authorize(ctx: Context, plan: Plan): Promise<Authorization> {
  try {
    assertKillswitchOff(ctx);
  } catch (error) {
    recordBlocked(ctx, plan, { reason: "killswitch" });
    throw error;
  }
  if (ctx.global.dryRun) return "dry-run";
  if (ctx.flags[APPROVED_INTENT_FLAG]) return "approved";
  if (isInteractive(ctx)) {
    if (await confirm(plan)) return "approved";
    throw new AppError("APPROVAL_DENIED", "Cancelled.", { cause: "You answered no." });
  }
  const intent = saveIntent(ctx.paths.intents, ctx.command, process.argv.slice(2), plan);
  recordBlocked(ctx, plan, { reason: "approval-required", intentId: intent.id });
  throw new AppError("APPROVAL_REQUIRED", `"${plan.action}" needs a human approval.`, {
    cause: "Write commands never run unattended.",
    hint: `tiktok intent approve ${intent.id}`,
    extra: { intentId: intent.id, plan },
  });
}

export function renderPlan(plan: Plan): string {
  const width = Math.max(...Object.keys(plan.details).map((key) => key.length), 0) + 2;
  const rows = Object.entries(plan.details).map(([key, value]) => `  ${muted(`${key}:`.padEnd(width))}${value}`);
  return [bold(plan.summary), ...rows].join("\n");
}

export async function confirm(plan: Plan): Promise<boolean> {
  process.stderr.write(`\n${renderPlan(plan)}\n\n`);
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(`${warn("?")} Proceed? [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export async function audited<T>(ctx: Context, plan: Plan, submit: () => Promise<T>): Promise<T> {
  const audit = beginAudit(ctx.paths.audit, { kind: plan.action, command: ctx.command, meta: plan.details });
  try {
    const result = await submit();
    audit.complete({ result: result as unknown as Record<string, unknown> });
    return result;
  } catch (error) {
    audit.fail({ error: error instanceof AppError ? error.toJSON() : String(error) });
    throw error;
  }
}

export function recordDryRun(ctx: Context, plan: Plan): void {
  beginAudit(ctx.paths.audit, { kind: plan.action, command: ctx.command, meta: plan.details }).dryRun();
}

function recordBlocked(ctx: Context, plan: Plan, meta: Record<string, unknown>): void {
  beginAudit(ctx.paths.audit, { kind: plan.action, command: ctx.command, meta: plan.details }).block(meta);
}
