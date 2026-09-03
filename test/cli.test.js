import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const cli = path.resolve("bin/bugbaton.js");

async function run(args, options = {}) {
  try {
    const result = await execFileAsync(process.execPath, [cli, ...args], options);
    return { ...result, code: 0 };
  } catch (error) {
    return { stdout: error.stdout, stderr: error.stderr, code: error.code };
  }
}

function validTestReport(screenshot) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    status: "complete",
    generatedAt: now,
    completedAt: now,
    producer: { name: "bugbaton", version: "0.1.0" },
    browser: { product: "Chrome/Test", protocolVersion: "1.3" },
    connection: { sessionId: "test-session", endpoint: "http://127.0.0.1:9222", mode: "launch" },
    tab: { id: "test-tab", title: "Test", url: "http://127.0.0.1/" },
    observation: { boundary: { id: "test-boundary" }, coverage: "best-effort", bestEffort: true },
    redaction: { policy: "mandatory-v1" },
    sections: {
      snapshot: { status: "collected" },
      errors: { status: "collected" },
      failedNetwork: { status: "collected" },
      actionOutcomes: { status: "collected" },
      screenshot: { status: "collected" },
    },
    snapshot: { targetId: "test-tab", url: "http://127.0.0.1/", nodes: [] },
    errors: [],
    failedNetwork: [],
    actionOutcomes: [],
    timeline: [],
    screenshot: "screenshot.png",
    artifactIntegrity: {
      algorithm: "sha256",
      attachments: [{ path: "screenshot.png", bytes: screenshot.length, sha256: createHash("sha256").update(screenshot).digest("hex") }],
    },
  };
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
  const root = await mkdtemp(path.join(os.tmpdir(), "bugbaton-doctor-test-"));
  const state = path.join(root, "state-that-does-not-exist");
  const result = await run(["doctor", "--state-dir", state, "--json"]);
  assert.equal(result.code, 0);
  assert.equal((await readdir(root)).includes("state-that-does-not-exist"), false);
  assert.equal(JSON.parse(result.stdout).command, "doctor");
});

test("stable subcommand help succeeds without state", async () => {
  for (const command of ["doctor", "demo", "capture", "launch", "connect", "stop", "tabs", "snapshot", "click", "fill", "press", "errors", "network", "screenshot", "report", "verify", "version"]) {
    const result = await run([command, "--help"]);
    assert.equal(result.code, 0, `${command}: ${result.stderr}`);
    assert.match(result.stdout, /^Usage:/);
  }
});

test("stop is idempotent and does not materialize state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bugbaton-stop-test-"));
  const state = path.join(root, "state-that-does-not-exist");
  const result = await run(["stop", "--state-dir", state, "--json"]);
  assert.equal(result.code, 0);
  const json = JSON.parse(result.stdout);
  assert.equal(json.data.activeSession, false);
  assert.equal(json.data.stopped, true);
  assert.equal((await readdir(root)).includes("state-that-does-not-exist"), false);
});

test("capture rejects an oversized bug claim before creating session state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bugbaton-claim-test-"));
  const state = path.join(root, "state-that-does-not-exist");
  const result = await run(["capture", "--title", "x".repeat(161), "--state-dir", state, "--json"]);
  assert.equal(result.code, 2);
  assert.equal(JSON.parse(result.stdout).error.code, "USAGE_ERROR");
  assert.equal((await readdir(root)).includes("state-that-does-not-exist"), false);
});

test("doctor diagnoses corrupt state without mutating or crashing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bugbaton-doctor-corrupt-"));
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

test("verify validates the committed report without opening Chrome", async () => {
  const result = await run(["verify", path.resolve("docs/example-report"), "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.command, "verify");
  assert.equal(json.data.status, "verified");
  assert.equal(json.data.attachments.length, 1);
  assert.equal(json.data.attachments[0].verified, true);
  assert.equal(json.data.receipt.shutdownComplete, true);
  assert.match(json.data.assurance, /authenticity is not established/);
});

test("verify rejects tampered attachments and unsafe manifest paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bugbaton-verify-test-"));
  const screenshot = Buffer.from("original screenshot bytes");
  await writeFile(path.join(root, "README.md"), "# Report\n");
  await writeFile(path.join(root, "screenshot.png"), screenshot);
  const report = validTestReport(screenshot);
  await writeFile(path.join(root, "report.json"), `${JSON.stringify(report)}\n`);
  assert.equal((await run(["verify", root, "--json"])).code, 0);

  await writeFile(path.join(root, "screenshot.png"), "tampered screenshot bytes");
  let result = await run(["verify", root, "--json"]);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).error.code, "REPORT_VERIFICATION_FAILED");

  report.artifactIntegrity.attachments[0].path = "../outside.png";
  report.screenshot = "../outside.png";
  await writeFile(path.join(root, "report.json"), `${JSON.stringify(report)}\n`);
  result = await run(["verify", root, "--json"]);
  assert.equal(result.code, 1);
  assert.match(JSON.parse(result.stdout).error.message, /unsafe attachment path/);

  for (const unsafePath of ["..\\outside.png", "report.json:stream", "CON", "screenshot.png."]) {
    report.artifactIntegrity.attachments[0].path = unsafePath;
    report.screenshot = unsafePath;
    await writeFile(path.join(root, "report.json"), `${JSON.stringify(report)}\n`);
    result = await run(["verify", root, "--json"]);
    assert.equal(result.code, 1);
    assert.match(JSON.parse(result.stdout).error.message, /unsafe attachment path/);
  }
});

test("verify never follows a declared attachment symlink", { skip: process.platform === "win32" }, async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "bugbaton-verify-link-test-"));
  const root = path.join(base, "bundle");
  const external = path.join(base, "outside.png");
  const screenshot = Buffer.from("outside screenshot bytes");
  await mkdir(root);
  await writeFile(external, screenshot);
  await writeFile(path.join(root, "README.md"), "# Report\n");
  await symlink(external, path.join(root, "screenshot.png"));
  await writeFile(path.join(root, "report.json"), `${JSON.stringify(validTestReport(screenshot))}\n`);
  const result = await run(["verify", root, "--json"]);
  assert.equal(result.code, 1);
  assert.match(JSON.parse(result.stdout).error.message, /wrong size or type/);
});

test("verify rejects null, incomplete reports with a stable error", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bugbaton-verify-schema-test-"));
  await writeFile(path.join(root, "README.md"), "# Report\n");
  for (const report of [null, { schemaVersion: 1, status: "complete", producer: { name: "bugbaton", version: "0.1.0" }, artifactIntegrity: { algorithm: "sha256", attachments: [] } }]) {
    await writeFile(path.join(root, "report.json"), `${JSON.stringify(report)}\n`);
    const result = await run(["verify", root, "--json"]);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stdout).error.code, "REPORT_VERIFICATION_FAILED");
  }
});

test("verify rejects a capture receipt with contradictory shutdown fields", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bugbaton-verify-receipt-test-"));
  const screenshot = Buffer.from("screenshot bytes");
  await writeFile(path.join(root, "README.md"), "# Report\n");
  await writeFile(path.join(root, "screenshot.png"), screenshot);
  await writeFile(path.join(root, "report.json"), `${JSON.stringify(validTestReport(screenshot))}\n`);
  await writeFile(path.join(root, "capture-receipt.json"), `${JSON.stringify({
    schemaVersion: 1,
    completedAt: new Date().toISOString(),
    endedBy: "duration",
    bundleStatus: "complete",
    sessionShutdown: { complete: true, monitorStopped: false, browserOwned: true, browserClosed: false },
    evidenceRetained: true,
  })}\n`);
  const result = await run(["verify", root, "--json"]);
  assert.equal(result.code, 1);
  assert.match(JSON.parse(result.stdout).error.message, /inconsistent/);
});

test("verify wraps attachment read failures", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bugbaton-verify-read-test-"));
  const screenshot = Buffer.from("unreadable screenshot bytes");
  const screenshotPath = path.join(root, "screenshot.png");
  await writeFile(path.join(root, "README.md"), "# Report\n");
  await writeFile(screenshotPath, screenshot);
  await writeFile(path.join(root, "report.json"), `${JSON.stringify(validTestReport(screenshot))}\n`);
  await chmod(screenshotPath, 0o000);
  const result = await run(["verify", root, "--json"]);
  await chmod(screenshotPath, 0o600);
  assert.equal(result.code, 1);
  const error = JSON.parse(result.stdout).error;
  assert.equal(error.code, "REPORT_VERIFICATION_FAILED");
  assert.match(error.message, /could not be read/);
});
