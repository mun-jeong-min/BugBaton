import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const cli = path.resolve("bin/chroma.js");

async function run(args, options = {}) {
  try {
    const result = await execFileAsync(process.execPath, [cli, ...args], options);
    return { ...result, code: 0 };
  } catch (error) {
    return { stdout: error.stdout, stderr: error.stderr, code: error.code };
  }
}

test("version has human and JSON output", async () => {
  assert.equal((await run(["version"])).stdout.trim(), "0.1.0");
  const json = JSON.parse((await run(["--version", "--json"])).stdout);
  assert.deepEqual({ ok: json.ok, command: json.command, version: json.data.version }, { ok: true, command: "version", version: "0.1.0" });
});

test("unknown options produce one JSON error envelope", async () => {
  const result = await run(["tabs", "--wat", "--json"]);
  assert.equal(result.code, 2);
  const json = JSON.parse(result.stdout);
  assert.equal(json.ok, false);
  assert.equal(json.command, "tabs");
  assert.equal(json.error.code, "USAGE_ERROR");
  assert.equal(result.stderr, "");
});

test("doctor does not materialize state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chroma-doctor-test-"));
  const state = path.join(root, "state-that-does-not-exist");
  const result = await run(["doctor", "--state-dir", state, "--json"]);
  assert.equal(result.code, 0);
  assert.equal((await readdir(root)).includes("state-that-does-not-exist"), false);
  assert.equal(JSON.parse(result.stdout).command, "doctor");
});

test("stable subcommand help succeeds without state", async () => {
  for (const command of ["doctor", "launch", "connect", "tabs", "snapshot", "click", "fill", "press", "errors", "network", "screenshot", "report", "version"]) {
    const result = await run([command, "--help"]);
    assert.equal(result.code, 0, `${command}: ${result.stderr}`);
    assert.match(result.stdout, /^Usage:/);
  }
});

test("doctor diagnoses corrupt state without mutating or crashing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chroma-doctor-corrupt-"));
  const state = path.join(root, "state");
  await mkdir(state, { mode: 0o700 });
  await writeFile(path.join(state, "session.json"), "{broken\n", { mode: 0o600 });
  const result = await run(["doctor", "--state-dir", state, "--json"]);
  assert.equal(result.code, 0);
  const json = JSON.parse(result.stdout);
  const stateCheck = json.data.checks.find((check) => check.id === "state");
  assert.equal(stateCheck.status, "fail");
  assert.equal(stateCheck.observed.metadataErrors[0].code, "STATE_INVALID_JSON");
  assert.match(json.data.nextAction, /invalid state file/);
});
