import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "tiktok-cli-test-"));

function run(...args: string[]) {
  const proc = Bun.spawnSync(["node", "src/main.ts", ...args], {
    env: { ...process.env, TIKTOK_CLI_HOME: home, NO_COLOR: "1" },
  });
  const stdout = proc.stdout.toString();
  return { stdout, stderr: proc.stderr.toString(), exitCode: proc.exitCode, json: stdout ? JSON.parse(stdout) : undefined };
}

describe("envelope", () => {
  test("piped output is JSON with ok/data/meta", () => {
    const { json, exitCode } = run("schema");
    expect(exitCode).toBe(0);
    expect(json.ok).toBe(true);
    expect(json.meta).toMatchObject({ command: "schema show", version: expect.any(String), nextSteps: [] });
    expect(json.data.schemaVersion).toBe(1);
  });

  test("errors carry code, hint, retryable and a meaningful exit code", () => {
    const { json, exitCode } = run("nope", "nope");
    expect(exitCode).toBe(2);
    expect(json).toMatchObject({ ok: false, error: { code: "VALIDATION", hint: "tiktok --help", retryable: false } });
  });

  test("--help in machine mode returns the schema instead of text", () => {
    const { json } = run("--help");
    expect(json.data.commands.length).toBeGreaterThan(0);
  });

  test("no ANSI escapes in machine output", () => {
    const { stdout } = run("doctor", "--offline");
    expect(stdout).not.toContain("\u001b[");
  });

  test("--fields filters records", () => {
    const { json } = run("schema", "--fields", "name");
    expect(Object.keys(json.data.commands[0])).toEqual(["name"]);
  });
});

describe("write gate", () => {
  test("agents get APPROVAL_REQUIRED with an intent, never a prompt", () => {
    const { json, exitCode } = run("auth", "logout");
    expect(exitCode).toBe(2);
    expect(json.error.code).toBe("APPROVAL_REQUIRED");
    expect(json.meta.nextSteps[0]).toBe(`tiktok intent approve ${json.error.intentId}`);
    expect(Date.parse(json.error.expiresAt)).toBeGreaterThan(Date.now());
    const listed = run("intent", "list").json;
    expect(listed.data.intents.map((intent: { id: string }) => intent.id)).toContain(json.error.intentId);
  });

  test("agents cannot approve intents", () => {
    const { json } = run("intent", "list");
    const approve = run("intent", "approve", json.data.intents[0].id);
    expect(approve.json.error.code).toBe("APPROVAL_REQUIRED");
  });

  test("killswitch blocks writes, even dry runs", () => {
    run("killswitch", "on");
    expect(run("auth", "logout", "--dry-run").json.error.code).toBe("KILLSWITCH");
    run("killswitch", "off");
    expect(run("auth", "logout", "--dry-run").json.data.dryRun).toBe(true);
  });
});

describe("reply validation (no browser)", () => {
  test("rejects a non-numeric comment id before opening Chrome", () => {
    expect(run("comment", "reply", "abc", "hola").json.error.code).toBe("VALIDATION");
  });

  test("rejects replies over 150 characters", () => {
    const { json } = run("comment", "reply", "7692860095478580001", "x".repeat(151));
    expect(json.error.code).toBe("VALIDATION");
    expect(json.error.message).toContain("150");
  });
});
