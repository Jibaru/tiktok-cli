import { parseArgv, type ParsedArgs } from "./cli/foundation/argv.ts";
import { printBanner } from "./cli/foundation/banner.ts";
import { bold, muted } from "./cli/platform/style.ts";
import { commands } from "./commands/index.ts";
import { commandName, type Command, type CommandResult, type Context, type FlagSpec, type GlobalOptions } from "./core/command.ts";
import { AppError, toAppError } from "./core/errors.ts";
import { markApproved } from "./core/gate.ts";
import { printError, printSuccess, resolveMode } from "./core/output.ts";
import { resolvePaths } from "./core/paths.ts";
import { VERSION } from "./core/version.ts";

const GLOBAL_FLAGS: FlagSpec[] = [
  { name: "json", type: "boolean", description: "Machine output (default when stdout is not a TTY)" },
  { name: "fields", type: "string", description: "Comma-separated keys to keep in data records" },
  { name: "headed", type: "boolean", description: "Show the Chrome window" },
  { name: "debug", type: "boolean", description: "Always write a debug bundle" },
  { name: "profile", type: "string", description: "Browser profile name", default: "default" },
  { name: "help", type: "boolean", description: "Show help" },
  { name: "version", type: "boolean", description: "Show version" },
];

const camel = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

const BOOLEAN_FLAGS = new Set(
  [...GLOBAL_FLAGS, ...commands.flatMap((command) => command.flags)]
    .filter((flag) => flag.type === "boolean")
    .map((flag) => camel(flag.name)),
);

type Resolved = { command: Command; args: string[] };

function resolve(positionals: string[]): Resolved | undefined {
  const [first, second, ...rest] = positionals;
  const exact = commands.find((command) => command.path[0] === first && command.path[1] === second);
  if (exact) return { command: exact, args: rest };
  if (!first) return undefined;
  const short = commands.find((command) => command.shorthand !== undefined && command.shorthand === first);
  if (short) return { command: short, args: positionals.slice(1) };
  return undefined;
}

function globalOptions(parsed: ParsedArgs): GlobalOptions {
  return {
    json: parsed.json === true,
    headed: parsed.headed === true,
    debug: parsed.debug === true,
    dryRun: parsed.dryRun === true,
    fields: typeof parsed.fields === "string" ? parsed.fields.split(",").map((field) => field.trim()).filter(Boolean) : undefined,
    profile: typeof parsed.profile === "string" ? parsed.profile : "default",
  };
}

function validate(command: Command, args: string[], parsed: ParsedArgs): Record<string, unknown> {
  const missing = command.args.filter((arg, index) => arg.required && !args[index]);
  if (missing.length > 0) {
    throw new AppError("VALIDATION", `Missing argument: <${missing.map((arg) => arg.name).join("> <")}>.`, {
      hint: usage(command),
    });
  }
  const known = new Map([...GLOBAL_FLAGS, ...command.flags].map((flag) => [camel(flag.name), flag]));
  const flags: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(parsed)) {
    if (key === "_") continue;
    const spec = known.get(key);
    if (!spec) throw new AppError("VALIDATION", `Unknown flag --${key}.`, { hint: `tiktok ${commandName(command)} --help` });
    flags[key] = coerce(spec, raw);
  }
  for (const spec of command.flags) {
    if (spec.default !== undefined && flags[camel(spec.name)] === undefined) flags[camel(spec.name)] = spec.default;
  }
  return flags;
}

function coerce(spec: FlagSpec, raw: unknown): unknown {
  if (spec.type === "boolean") return raw === true || raw === "true";
  if (raw === true) throw new AppError("VALIDATION", `--${spec.name} needs a value.`);
  const value = String(raw);
  if (spec.choices && !spec.choices.includes(value)) {
    throw new AppError("VALIDATION", `Invalid --${spec.name} "${value}".`, { hint: `Use one of: ${spec.choices.join(", ")}` });
  }
  if (spec.type === "number") {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new AppError("VALIDATION", `--${spec.name} must be a number.`);
    return number;
  }
  return value;
}

function usage(command: Command): string {
  const args = command.args.map((arg) => (arg.required ? `<${arg.name}>` : `[${arg.name}]`)).join(" ");
  return `tiktok ${commandName(command)}${args ? ` ${args}` : ""}`;
}

function helpText(only?: Command): string {
  if (only) {
    const flags = only.flags.map((flag) => `  --${flag.name.padEnd(14)}${muted(flag.description)}`);
    return [bold(usage(only)), only.summary, ...(flags.length ? ["", "Flags:", ...flags] : [])].join("\n");
  }
  const width = Math.max(...commands.map((command) => usage(command).length)) + 2;
  const lines = commands.map((command) => `  ${usage(command).padEnd(width)}${muted(command.summary)}`);
  const globals = GLOBAL_FLAGS.map((flag) => `  --${flag.name.padEnd(width - 2)}${muted(flag.description)}`);
  return ["Usage: tiktok <noun> <verb> [args] [flags]   (alias: tt)", "", "Commands:", ...lines, "", "Global flags:", ...globals].join("\n");
}

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, BOOLEAN_FLAGS);
  const global = globalOptions(parsed);
  const mode = resolveMode(global.json);
  const resolved = resolve(parsed._);
  const name = resolved ? commandName(resolved.command) : parsed._.join(" ");

  if (parsed.version === true) {
    process.stdout.write(mode === "json" ? `${JSON.stringify({ ok: true, data: { version: VERSION } })}\n` : `${VERSION}\n`);
    return 0;
  }
  if (parsed._.length === 0 || parsed.help === true) {
    if (mode === "json") {
      const wanted = resolved ? commandName(resolved.command).split(" ") : [];
      return main(["schema", ...wanted, "--json"]);
    }
    if (process.stderr.isTTY) {
      printBanner({ name: "tiktok", tagline: "TikTok Studio from your terminal", version: VERSION, gradient: ["#25F4EE", "#FE2C55"] });
    }
    process.stdout.write(`${helpText(resolved?.command)}\n`);
    return 0;
  }

  try {
    if (!resolved) {
      throw new AppError("VALIDATION", `Unknown command "${parsed._.join(" ")}".`, { hint: "tiktok --help" });
    }
    const result = await execute(resolved, parsed, global, mode);
    printSuccess(name, mode, result, global.fields);
    return 0;
  } catch (error) {
    const appError = toAppError(error);
    printError(name, mode, appError);
    return appError.exitCode;
  }
}

async function execute(resolved: Resolved, parsed: ParsedArgs, global: GlobalOptions, mode: Context["mode"], approvedIntent?: string): Promise<CommandResult> {
  const flags = validate(resolved.command, resolved.args, parsed);
  if (approvedIntent) markApproved(flags, approvedIntent);
  const ctx: Context = {
    command: commandName(resolved.command),
    args: resolved.args,
    flags,
    global,
    mode,
    paths: resolvePaths(global.profile),
  };
  return resolved.command.run(ctx);
}

export async function runApproved(argv: string[], intentId: string): Promise<CommandResult> {
  const parsed = parseArgv(argv, BOOLEAN_FLAGS);
  const resolved = resolve(parsed._);
  if (!resolved) throw new AppError("VALIDATION", `Intent command "${argv.join(" ")}" no longer exists.`);
  const global = globalOptions(parsed);
  return execute(resolved, parsed, global, "human", intentId);
}
