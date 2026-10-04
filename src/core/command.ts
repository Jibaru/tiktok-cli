import type { Paths } from "./paths.ts";

export type Mode = "human" | "json";

export type FlagSpec = {
  name: string;
  type: "boolean" | "string" | "number";
  description: string;
  choices?: readonly string[];
  default?: string | number | boolean;
};

export type ArgSpec = {
  name: string;
  description: string;
  required: boolean;
};

export type GlobalOptions = {
  json: boolean;
  headed: boolean;
  debug: boolean;
  dryRun: boolean;
  fields?: string[];
  profile: string;
};

export type Context = {
  command: string;
  args: string[];
  flags: Record<string, unknown>;
  global: GlobalOptions;
  mode: Mode;
  paths: Paths;
};

export type CommandResult<T = unknown> = {
  data: T;
  nextSteps?: string[];
  human?: (data: T) => string;
};

export type Command = {
  path: readonly [string, string];
  shorthand?: string;
  summary: string;
  args: readonly ArgSpec[];
  flags: readonly FlagSpec[];
  gated: boolean;
  output: string;
  run: (ctx: Context) => Promise<CommandResult<any>>;
};

export function commandName(command: Command): string {
  return command.path.join(" ");
}

export function result<T>(value: CommandResult<T>): CommandResult<T> {
  return value;
}
