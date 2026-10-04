import { detectMode } from "../cli/platform/detect.ts";
import { bold, danger, muted, padStartVisible, padVisible, truncateVisible, visibleWidth, warn } from "../cli/platform/style.ts";
import type { CommandResult, Mode } from "./command.ts";
import { AppError } from "./errors.ts";
import { VERSION } from "./version.ts";

export function resolveMode(json: boolean): Mode {
  return detectMode({ json });
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export function printSuccess(command: string, mode: Mode, result: CommandResult, fields?: string[]): void {
  const data = fields ? pickFields(result.data, fields) : result.data;
  const nextSteps = result.nextSteps ?? [];
  if (mode === "json") {
    writeJson({ ok: true, data, meta: { command, version: VERSION, nextSteps } });
    return;
  }
  const rendered = result.human && !fields ? result.human(result.data) : JSON.stringify(data, null, 2);
  process.stdout.write(rendered.endsWith("\n") ? rendered : `${rendered}\n`);
  if (nextSteps.length > 0) {
    process.stderr.write(`\n${muted("Next:")}\n${nextSteps.map((step) => `  ${muted("$")} ${step}`).join("\n")}\n`);
  }
}

export function printError(command: string, mode: Mode, error: AppError): void {
  if (mode === "json") {
    writeJson({ ok: false, error: error.toJSON(), meta: { command, version: VERSION, nextSteps: error.details.hint?.startsWith("tiktok ") ? [error.details.hint] : [] } });
    return;
  }
  const { cause, hint, debugBundle, logId } = error.details;
  const lines = [`${danger("✖")} ${bold(error.code)}  ${error.message}`];
  if (cause) lines.push(`  ${muted("Cause:")}   ${cause}`);
  if (logId) lines.push(`  ${muted("Log id:")}  ${logId}`);
  if (hint) lines.push(`  ${muted("Fix:")}     ${warn(hint)}`);
  if (debugBundle) lines.push(`  ${muted("Debug:")}   ${debugBundle}`);
  process.stderr.write(`${lines.join("\n")}\n`);
}

export function step(mode: Mode, message: string): void {
  if (mode === "human" && process.stderr.isTTY) process.stderr.write(`${muted(`› ${message}`)}\n`);
}

export function pickFields(data: unknown, fields: string[]): unknown {
  const pick = (record: Record<string, unknown>) => {
    const unknownFields = fields.filter((field) => !(field in record));
    if (unknownFields.length === fields.length) {
      throw new AppError("VALIDATION", `Unknown field(s): ${unknownFields.join(", ")}.`, {
        hint: `Available: ${Object.keys(record).join(", ")}`,
      });
    }
    return Object.fromEntries(fields.filter((field) => field in record).map((field) => [field, record[field]]));
  };
  if (!isRecord(data)) return data;
  const collections = Object.entries(data).filter(([, value]) => Array.isArray(value) && value.every(isRecord));
  if (collections.length === 0) return pick(data);
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) =>
      Array.isArray(value) && value.every(isRecord) && value.length > 0 ? [key, value.map(pick)] : [key, value],
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type Column<T> = {
  header: string;
  value: (row: T) => string;
  align?: "left" | "right";
  maxWidth?: number;
};

export function renderTable<T>(rows: T[], columns: Column<T>[]): string {
  const cells = rows.map((row) => columns.map((column) => truncateVisible(column.value(row), column.maxWidth ?? 60)));
  const widths = columns.map((column, index) =>
    Math.max(visibleWidth(column.header), ...cells.map((row) => visibleWidth(row[index] ?? ""))),
  );
  const pad = (text: string, index: number) =>
    columns[index]?.align === "right" ? padStartVisible(text, widths[index] ?? 0) : padVisible(text, widths[index] ?? 0);
  const header = muted(columns.map((column, index) => pad(column.header, index)).join("  ").trimEnd());
  const body = cells.map((row) => row.map((cell, index) => pad(cell, index)).join("  ").trimEnd());
  return [header, ...body].join("\n");
}

export function compactNumber(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

const SPARK = "▁▂▃▄▅▆▇█";

export function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const max = Math.max(...values);
  if (max === 0) return SPARK[0]!.repeat(values.length);
  return values.map((value) => SPARK[Math.min(SPARK.length - 1, Math.floor((value / max) * (SPARK.length - 1)))]).join("");
}
