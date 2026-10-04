import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "../cli/foundation/atomic-write.ts";
import { AppError } from "./errors.ts";
import { ensureDir } from "./paths.ts";

export type Plan = {
  action: string;
  summary: string;
  details: Record<string, string>;
};

export type Intent = {
  id: string;
  command: string;
  argv: string[];
  plan: Plan;
  createdAt: string;
  expiresAt: string;
};

const TTL_MS = 24 * 60 * 60 * 1000;

export function saveIntent(dir: string, command: string, argv: string[], plan: Plan): Intent {
  const now = Date.now();
  const intent: Intent = {
    id: randomBytes(4).toString("hex"),
    command,
    argv: argv.filter((arg) => arg !== "--json"),
    plan,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
  };
  atomicWriteJson(join(ensureDir(dir), `${intent.id}.json`), intent);
  return intent;
}

export function listIntents(dir: string): Intent[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")) as Intent)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function loadIntent(dir: string, id: string): Intent {
  const file = join(dir, `${id}.json`);
  if (!existsSync(file)) {
    throw new AppError("VALIDATION", `No pending intent with id ${id}.`, { hint: "tiktok intent list" });
  }
  const intent = JSON.parse(readFileSync(file, "utf8")) as Intent;
  if (Date.parse(intent.expiresAt) < Date.now()) {
    removeIntent(dir, id);
    throw new AppError("VALIDATION", `Intent ${id} expired at ${intent.expiresAt}.`, {
      hint: "Re-run the original command to create a new one.",
    });
  }
  return intent;
}

export function removeIntent(dir: string, id: string): void {
  rmSync(join(dir, `${id}.json`), { force: true });
}
