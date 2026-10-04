import { existsSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { AppError } from "../core/errors.ts";

export const PRIVACY_OPTIONS = ["everyone", "followers", "friends", "only-me"] as const;
export type Privacy = (typeof PRIVACY_OPTIONS)[number];

export const PRIVACY_LABEL: Record<Privacy, RegExp> = {
  everyone: /^Todos/,
  followers: /^Seguidores/,
  friends: /^Amigos/,
  "only-me": /^Solo tú/,
};

export const POST_PATH = "/tiktok/web/project/post/v1/";
export const MAX_DESCRIPTION = 4000;
const MAX_BYTES = 30 * 1024 ** 3;
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv", ".mpeg", ".mpg", ".3gp"]);
const MIN_LEAD_MINUTES = 15;

export type Schedule = { date: string; time: string; epoch: number };

export type PostRequest = {
  file: string;
  description: string;
  privacy: Privacy;
  schedule?: Schedule;
};

export function validateFile(path: string | undefined): string {
  if (!path) throw new AppError("VALIDATION", "Missing video file.", { hint: "tiktok video post <file>" });
  const file = resolve(path);
  if (!existsSync(file) || !statSync(file).isFile()) throw new AppError("VALIDATION", `File not found: ${file}`);
  if (!VIDEO_EXTENSIONS.has(extname(file).toLowerCase())) {
    throw new AppError("VALIDATION", `${extname(file) || "This file"} is not a video format TikTok accepts.`, { hint: "Use an .mp4 (recommended) or .mov file." });
  }
  if (statSync(file).size > MAX_BYTES) throw new AppError("VALIDATION", "TikTok Studio accepts files up to 30 GB.");
  return file;
}

export function validateDescription(description: string): string {
  if ([...description].length > MAX_DESCRIPTION) {
    throw new AppError("VALIDATION", `Description is ${[...description].length} characters; TikTok allows ${MAX_DESCRIPTION}.`);
  }
  return description;
}

export function parseSchedule(raw: string | undefined, privacy: Privacy, now = new Date()): Schedule | undefined {
  if (raw === undefined) return undefined;
  if (privacy === "only-me") {
    throw new AppError("VALIDATION", "TikTok cannot schedule a video that only you can see.", { hint: "Use --privacy friends or followers, or drop --schedule." });
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(raw.trim());
  if (!match) throw new AppError("VALIDATION", `Invalid --schedule "${raw}".`, { hint: 'Use local time "YYYY-MM-DD HH:MM", e.g. "2026-10-05 18:30".' });
  const [, year, month, day, hour, minute] = match.map(Number) as number[];
  if (minute! % 5 !== 0) {
    throw new AppError("VALIDATION", "TikTok schedules in 5-minute steps.", { hint: `Use :${String(minute! - (minute! % 5)).padStart(2, "0")} or :${String((minute! - (minute! % 5) + 5) % 60).padStart(2, "0")}.` });
  }
  const local = new Date(year!, month! - 1, day!, hour!, minute!);
  if (local.getMonth() !== month! - 1 || local.getHours() !== hour!) throw new AppError("VALIDATION", `"${raw}" is not a real date and time.`);
  if (local.getTime() < now.getTime() + MIN_LEAD_MINUTES * 60_000) {
    throw new AppError("VALIDATION", `Schedule at least ${MIN_LEAD_MINUTES} minutes ahead.`);
  }
  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    time: `${match[4]}:${match[5]}`,
    epoch: Math.floor(local.getTime() / 1000),
  };
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function monthIndex(label: string): number {
  return MONTHS.indexOf(label.trim().toLowerCase());
}

export type PostBody = {
  single_post_req_list?: { single_post_feature_info?: { text?: string }; schedule_time?: number }[];
  feature_common_info_list?: { schedule_time?: number; privacy_setting_info?: { visibility_type?: number } }[];
  post_common_info?: { schedule_time?: number };
};

export function findScheduleTime(body: unknown): number | undefined {
  const text = JSON.stringify(body);
  const match = /"schedule_time"\s*:\s*"?(\d{9,})/.exec(text);
  return match ? Number(match[1]) : undefined;
}

export type PostResponse = {
  project_id?: string;
  single_post_resp_list?: { item_id?: string; status_code?: number; status_msg?: string }[];
};
