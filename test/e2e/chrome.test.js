import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { appendFile, chmod, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { withCdp } from "../../src/cdp.js";
import { listTabs } from "../../src/chrome.js";

const RUN_REAL_CHROME = process.env.CHROMA_E2E === "1";
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CLI = fileURLToPath(new URL("../../bin/chroma.js", import.meta.url));
const FIXTURE_SERVER = fileURLToPath(new URL("../fixtures/server.mjs", import.meta.url));
const MONITOR = fileURLToPath(new URL("../../src/monitor.js", import.meta.url));
const TRACE_TIMING = process.env.CHROMA_E2E_TIMING === "1";

function traceTiming(label, startedAt) {
  if (TRACE_TIMING) process.stderr.write(`[e2e timing] ${label}: ${Date.now() - startedAt}ms\n`);
}

function processLabel(executable, args) {
  const commands = new Set(["doctor", "demo", "capture", "launch", "connect", "stop", "tabs", "snapshot", "click", "fill", "press", "errors", "network", "screenshot", "report", "version"]);
  return `${executable} ${args.find((argument) => commands.has(argument)) ?? args[0] ?? ""}`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function freeLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.equal(typeof address, "object");
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startFixture() {
  const child = spawn(process.execPath, [FIXTURE_SERVER, "--port", "0"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  try {
    const ready = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (operation) => (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        operation(value);
      };
      const succeed = finish(resolve);
      const fail = finish(reject);
      const timer = setTimeout(() => {
        fail(new Error(`fixture did not become ready: ${stderr || stdout}`));
      }, 5_000);

      child.once("error", fail);
      child.once("exit", (code, signal) => {
        fail(new Error(`fixture exited before ready (code=${code}, signal=${signal}): ${stderr}`));
      });
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        const newline = stdout.indexOf("\n");
        if (newline === -1) return;
        try {
          succeed(JSON.parse(stdout.slice(0, newline)));
        } catch (error) {
          fail(new Error(`fixture emitted invalid readiness JSON: ${error.message}: ${stdout}`));
        }
      });
    });

    assert.equal(ready.fixture, "chroma-cdp");
    return { child, url: ready.url, stderr: () => stderr };
  } catch (error) {
    await stopFixture({ child });
    throw error;
  }
}

async function runProcess(executable, args, { timeout = 20_000, input = "" } = {}) {
  const startedAt = Date.now();
  const child = spawn(executable, args, {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdin.on("error", () => {});
  child.stdin.end(input);
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${executable} ${args.join(" ")} timed out after ${timeout}ms\n${stderr}`));
    }, timeout);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      traceTiming(processLabel(executable, args), startedAt);
      if (TRACE_TIMING && stderr.includes("[cdp timing]")) process.stderr.write(stderr);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function commandName(args) {
  return args.find((argument) => !argument.startsWith("-"));
}

function createCli(stateDir) {
  return async function chroma(args, { timeout = 20_000, input = "" } = {}) {
    const command = commandName(args);
    const invocation = [CLI, "--state-dir", stateDir, "--json", ...args];
    const result = await runProcess(process.execPath, invocation, { timeout, input });
    assert.equal(
      result.code,
      0,
      `chroma ${args.join(" ")} failed (signal=${result.signal})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    assert.ok(result.stdout.endsWith("\n"), "JSON stdout must end with one newline");
    let envelope;
    try {
      envelope = JSON.parse(result.stdout);
    } catch (error) {
      assert.fail(`chroma ${command} emitted non-JSON stdout: ${error.message}\n${result.stdout}`);
    }
    assert.deepEqual(
      { schemaVersion: envelope.schemaVersion, ok: envelope.ok, command: envelope.command, error: envelope.error },
      { schemaVersion: 1, ok: true, command, error: null },
    );
    assert.ok(envelope.data && typeof envelope.data === "object");
    return envelope.data;
  };
}

async function expectCliFailure(stateDir, args, { code, exitCode, retryable = false }) {
  const command = commandName(args);
  const invocation = [CLI, "--state-dir", stateDir, "--json", ...args];
  const result = await runProcess(process.execPath, invocation);
  assert.equal(result.code, exitCode, `unexpected exit for chroma ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  if (!TRACE_TIMING) assert.equal(result.stderr, "", "JSON failures must keep stderr quiet unless verbose progress was requested");
  assert.ok(result.stdout.endsWith("\n"), "JSON failure stdout must end with one newline");
  const envelope = JSON.parse(result.stdout);
  assert.deepEqual(
    { schemaVersion: envelope.schemaVersion, ok: envelope.ok, command: envelope.command, data: envelope.data },
    { schemaVersion: 1, ok: false, command, data: null },
  );
  assert.equal(envelope.error.code, code);
  assert.equal(envelope.error.retryable, retryable);
  assert.equal(typeof envelope.error.message, "string");
  assert.ok(envelope.error.hint, `${code} should include a recovery hint`);
  return envelope.error;
}

async function runHumanCli(stateDir, args) {
  const result = await runProcess(process.execPath, [CLI, "--state-dir", stateDir, ...args]);
  assert.equal(result.code, 0, `human-mode chroma ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  assert.ok(result.stdout.endsWith("\n"));
  assert.doesNotMatch(result.stdout, /\u001b\[/, "human output should remain plain without ANSI control codes");
  return result;
}

async function poll(description, operation, predicate, timeout = 12_000) {
  const startedAt = Date.now();
  const deadline = Date.now() + timeout;
  let lastValue;
  let lastError;
  while (Date.now() < deadline) {
    try {
      lastValue = await operation();
      if (predicate(lastValue)) {
        traceTiming(`poll ${description}`, startedAt);
        return lastValue;
      }
      lastError = null;
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }
  const detail = lastError?.stack ?? JSON.stringify(lastValue, null, 2);
  throw new Error(`Timed out waiting for ${description}\n${detail}`);
}

async function waitForMonitorTarget(stateDir, targetId) {
  const eventsPath = join(stateDir, "events.jsonl");
  await poll(
    `monitor attachment to ${targetId}`,
    async () => {
      try {
        return (await readFile(eventsPath, "utf8"))
          .split("\n")
          .filter(Boolean)
          .flatMap((line) => {
            try { return [JSON.parse(line)]; } catch { return []; }
          });
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
    },
    (events) => events.some((event) => event.kind === "target-observed" && event.targetId === targetId),
  );
}

function referenceFor(snapshot, name, role) {
  const node = snapshot.nodes.find((candidate) => candidate.name === name && (!role || candidate.role === role));
  assert.ok(node, `snapshot should contain ${role ? `${role} ` : ""}${JSON.stringify(name)}`);
  assert.match(node.ref ?? "", /^@e\d+$/);
  return node.ref;
}

function assertRedactedFixtureUrl(value, fixtureUrl) {
  assert.equal(typeof value, "string");
  const actual = new URL(value);
  const fixture = new URL(fixtureUrl);
  assert.equal(actual.origin, fixture.origin);
  assert.equal(actual.pathname, "/");
  assert.equal(actual.searchParams.get("token"), "[redacted]");
  assert.equal(actual.searchParams.get("view"), "compact");
  assert.doesNotMatch(value, /CHROMA_E2E_SECRET/);
}

function assertEventCursor(cursor) {
  assert.deepEqual(
    Object.keys(cursor).sort(),
    ["bytes", "capturedAt", "corruptLines", "id", "lastObservedAt", "readError", "records"],
  );
  assert.match(cursor.id, /^[a-f0-9]{20}$/);
  assert.match(cursor.capturedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Number.isInteger(cursor.bytes) && cursor.bytes >= 0);
  assert.ok(Number.isInteger(cursor.records) && cursor.records >= 0);
  assert.equal(cursor.readError, null);
  assert.equal(cursor.corruptLines, 0);
  assert.ok(cursor.lastObservedAt === null || /^\d{4}-\d{2}-\d{2}T/.test(cursor.lastObservedAt));
}

async function textFilesUnder(root) {
  const files = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile()) files.push({ path: entryPath, text: await readFile(entryPath, "utf8"), mode: (await stat(entryPath)).mode & 0o777 });
    }
  }
  await visit(root);
  return files;
}

async function assertStateHasNoMarker(stateDir, marker) {
  const files = await textFilesUnder(stateDir);
  assert.ok(files.length > 0, "state directory should contain persisted metadata");
  for (const file of files) {
    assert.equal(file.mode & 0o077, 0, `${file.path} must be owner-only`);
    assert.equal(file.text.includes(marker), false, `${file.path} must not persist the secret marker`);
  }
  return files;
}

async function readOptionalJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function processGroupAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(process.platform === "win32" ? pid : -pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopOwnedProcessGroup(pid) {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
  const startedAt = Date.now();
  const target = process.platform === "win32" ? pid : -pid;
  try { process.kill(target, "SIGTERM"); } catch {}
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && processGroupAlive(pid)) await delay(100);
  if (processGroupAlive(pid)) {
    try { process.kill(target, "SIGKILL"); } catch {}
    const killDeadline = Date.now() + 2_000;
    while (Date.now() < killDeadline && processGroupAlive(pid)) await delay(50);
  }
  assert.equal(processGroupAlive(pid), false, `owned process group ${pid} must exit after termination`);
  traceTiming(`stop process group ${pid}`, startedAt);
}

async function stopFixture(fixture) {
  if (!fixture?.child || fixture.child.exitCode !== null || fixture.child.signalCode !== null) return;
  const exited = once(fixture.child, "exit");
  fixture.child.kill("SIGTERM");
  await Promise.race([exited, delay(3_000)]);
  if (fixture.child.exitCode === null && fixture.child.signalCode === null) {
    const forcedExit = once(fixture.child, "exit");
    fixture.child.kill("SIGKILL");
    await Promise.race([forcedExit, delay(2_000)]);
  }
  assert.ok(fixture.child.exitCode !== null || fixture.child.signalCode !== null, "fixture process must exit before cleanup completes");
}

async function discoverOwnedProcessGroups(stateDir, profileDir) {
  if (process.platform === "win32") return { chrome: [], monitor: [] };
  const result = await runProcess("ps", ["-axo", "pid=,command="], { timeout: 5_000 }).catch(() => null);
  if (!result || result.code !== 0) return { chrome: [], monitor: [] };
  const owned = { chrome: [], monitor: [] };
  for (const line of result.stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const command = match[2];
    if (command.includes(`--user-data-dir=${profileDir}`)) owned.chrome.push(pid);
    if (command.includes("src/monitor.js") && command.includes(`--state-dir ${stateDir}`)) owned.monitor.push(pid);
  }
  return owned;
}

test("real Chrome completes the diagnosis and report workflow", {
  skip: RUN_REAL_CHROME ? false : "set CHROMA_E2E=1 to run the real-Chrome lane",
  timeout: 120_000,
}, async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "chroma-real-e2e-"));
  const stateDir = join(temporaryRoot, "state");
  const profileDir = join(temporaryRoot, "chrome-profile");
  const artifactsDir = join(temporaryRoot, "artifacts");
  const screenshotPath = join(artifactsDir, "fixture.png");
  const reportPath = join(artifactsDir, "report");
  const querySecret = "CHROMA_E2E_SECRET";
  const fillSecret = "CHROMA_E2E_FILL_SECRET";
  const chroma = createCli(stateDir);
  let fixture;
  let chromePid;
  let monitorPid;
  const previousEventMaxBytes = process.env.CHROMA_EVENT_MAX_BYTES;
  process.env.CHROMA_EVENT_MAX_BYTES = String(64 * 1024);

  try {
    fixture = await startFixture();
    const cdpPort = await freeLoopbackPort();
    assert.notEqual(new URL(fixture.url).port, String(cdpPort), "fixture and CDP ports must be distinct");
    const launchUrl = new URL(fixture.url);
    launchUrl.searchParams.set("token", querySecret);
    launchUrl.searchParams.set("view", "compact");

    const launchArgs = [
      "launch",
      "--port", String(cdpPort),
      "--profile", profileDir,
      "--url", launchUrl.toString(),
      "--headless",
      "--deterministic",
    ];
    if (process.env.CHROME_PATH) launchArgs.push("--chrome", process.env.CHROME_PATH);
    const launched = await chroma(launchArgs, { timeout: 30_000 });
    chromePid = launched.chromePid;
    monitorPid = launched.monitor.pid;
    assert.equal(launched.endpoint, `http://127.0.0.1:${cdpPort}`);
    assert.equal(launched.profile, profileDir);
    assert.ok(Number.isInteger(chromePid) && chromePid > 1);
    assert.ok(Number.isInteger(monitorPid) && monitorPid > 1);

    await chmod(join(stateDir, "events.jsonl"), 0o644);
    await chmod(join(stateDir, "actions.jsonl"), 0o644);

    const connected = await chroma(["connect", launched.endpoint]);
    assert.equal(connected.endpoint, launched.endpoint);
    assert.equal(connected.source, "connect");
    assert.notEqual(connected.sessionId, launched.sessionId, "connect must begin a new observation window");
    monitorPid = connected.monitor.pid;
    assert.equal((await stat(join(stateDir, "events.jsonl"))).mode & 0o077, 0);
    assert.equal((await stat(join(stateDir, "actions.jsonl"))).mode & 0o077, 0);

    const occupiedPort = await expectCliFailure(stateDir, [
      "launch",
      "--port", String(cdpPort),
      "--profile", join(temporaryRoot, "should-not-launch"),
      "--headless",
    ], { code: "PORT_IN_USE", exitCode: 2 });
    assert.equal(occupiedPort.details.endpoint, launched.endpoint);

    const diagnosis = await chroma(["doctor"]);
    assert.equal(diagnosis.status, "ready");
    const expectedCheckIds = [
      "runtime",
      "chrome_binary",
      "state",
      "endpoint",
      "session_identity",
      "protocol",
      "monitor",
      "event_store",
      "profile",
    ];
    assert.equal(diagnosis.checks.length, 9);
    assert.deepEqual(diagnosis.checks.map((check) => check.id), expectedCheckIds);
    assert.equal(new Set(diagnosis.checks.map((check) => check.id)).size, 9);
    assert.equal(diagnosis.checks.find((check) => check.id === "event_store").status, "pass");
    assert.equal(diagnosis.chrome.found, true);
    assert.equal(diagnosis.endpoint.reachable, true);
    assert.match(diagnosis.endpoint.browser, /Chrome|Chromium/);
    assert.equal(diagnosis.monitor.running, true);

    const tabs = await poll(
      "fixture page target",
      () => chroma(["tabs"]),
      (value) => value.tabs.some((tab) => tab.title === "Chroma CDP fixture"),
    );
    assert.ok(tabs.tabs.every((tab) => tab.type === "page"), "tabs must omit non-page CDP targets");
    const fixtureTab = tabs.tabs.find((tab) => tab.title === "Chroma CDP fixture");
    assert.equal(fixtureTab.title, "Chroma CDP fixture");
    assertRedactedFixtureUrl(fixtureTab.url, fixture.url);
    const tabId = fixtureTab.id;

    const humanTabs = await runHumanCli(stateDir, ["tabs"]);
    assert.match(humanTabs.stdout, /Chroma CDP fixture/);
    assert.match(humanTabs.stdout, /token=%5Bredacted%5D/);
    assert.doesNotMatch(humanTabs.stdout, /CHROMA_E2E_SECRET/);

    await waitForMonitorTarget(stateDir, tabId);

    let snapshot = await chroma(["snapshot", "--tab", tabId]);
    assert.equal(snapshot.targetId, tabId);
    assert.equal(snapshot.title, "Chroma CDP fixture");
    assertRedactedFixtureUrl(snapshot.url, fixture.url);
    const preNavigationRef = referenceFor(snapshot, "Increment counter", "button");

    const ambiguous = await expectCliFailure(
      stateDir,
      ["click", "--selector", ".button-row button", "--tab", tabId],
      { code: "ELEMENT_AMBIGUOUS", exitCode: 2 },
    );
    assert.ok(ambiguous.details.matches > 1);
    await expectCliFailure(
      stateDir,
      ["fill", "--selector", "h1", "not allowed", "--tab", tabId],
      { code: "ELEMENT_NOT_FILLABLE", exitCode: 1 },
    );

    await chroma(["click", "--selector", "a[href='#details']", "--tab", tabId]);
    await delay(100);
    const staleRef = await expectCliFailure(
      stateDir,
      ["click", preNavigationRef, "--tab", tabId],
      { code: "STALE_SNAPSHOT", exitCode: 1 },
    );
    assert.match(staleRef.hint, /snapshot/);
    snapshot = await chroma(["snapshot", "--tab", tabId]);
    let incrementRef = referenceFor(snapshot, "Increment counter", "button");
    const reloadRef = referenceFor(snapshot, "Reload same URL", "button");
    await chroma(["click", reloadRef, "--tab", tabId]);
    await delay(300);
    await expectCliFailure(stateDir, ["click", incrementRef, "--tab", tabId], { code: "STALE_SNAPSHOT", exitCode: 1 });

    snapshot = await chroma(["snapshot", "--tab", tabId]);
    incrementRef = referenceFor(snapshot, "Increment counter", "button");
    let coverRef = referenceFor(snapshot, "Cover increment button", "button");
    const snapshotEntries = await readdir(join(stateDir, "snapshots"));
    assert.equal(snapshotEntries.length, 1);
    const bindingPath = join(stateDir, "snapshots", snapshotEntries[0]);
    const binding = JSON.parse(await readFile(bindingPath, "utf8"));
    await writeFile(bindingPath, `${JSON.stringify({ ...binding, browserInstanceId: "different-browser-instance" }, null, 2)}\n`, { mode: 0o600 });
    await expectCliFailure(stateDir, ["click", incrementRef, "--tab", tabId], { code: "STALE_SNAPSHOT", exitCode: 1 });

    snapshot = await chroma(["snapshot", "--tab", tabId]);
    incrementRef = referenceFor(snapshot, "Increment counter", "button");
    coverRef = referenceFor(snapshot, "Cover increment button", "button");
    await chroma(["click", coverRef, "--tab", tabId]);
    await expectCliFailure(stateDir, ["click", incrementRef, "--tab", tabId], { code: "ELEMENT_OBSCURED", exitCode: 1, retryable: true });
    await chroma(["click", "--selector", "#click-overlay", "--tab", tabId]);

    const clicked = await chroma(["click", incrementRef, "--tab", tabId]);
    assert.equal(clicked.action, "click");
    assert.equal(clicked.ref, incrementRef);
    assert.equal(clicked.inputMode, "cdp-mouse");

    snapshot = await chroma(["snapshot", "--all", "--tab", tabId]);
    assert.ok(snapshot.nodes.some((node) => node.name === "Counter incremented to 1"));
    const messageRef = referenceFor(snapshot, "Message", "textbox");

    const secretFilled = await chroma(["fill", messageRef, "--stdin", "--tab", tabId], { input: `${fillSecret}\n` });
    assert.equal(secretFilled.textLength, fillSecret.length);
    assert.equal(Object.hasOwn(secretFilled, "text"), false, "fill output must not echo the secret value");
    snapshot = await chroma(["snapshot", "--all", "--tab", tabId]);
    assertRedactedFixtureUrl(snapshot.url, fixture.url);
    const secretTextbox = snapshot.nodes.find((node) => node.name === "Message" && node.role === "textbox");
    assert.equal(secretTextbox.value, "[redacted]");
    await assertStateHasNoMarker(stateDir, fillSecret);

    const refreshedMessageRef = referenceFor(snapshot, "Message", "textbox");
    const dashFilled = await chroma(["fill", refreshedMessageRef, "--tab", tabId, "--", "-draft"]);
    assert.equal(dashFilled.textLength, "-draft".length);
    const filled = await chroma(["fill", refreshedMessageRef, "hello chroma", "--tab", tabId]);
    assert.equal(filled.action, "fill");
    assert.equal(filled.textLength, "hello chroma".length);
    assert.equal(Object.hasOwn(filled, "text"), false, "fill output must not echo the value");

    const pressed = await chroma(["press", refreshedMessageRef, "Enter", "--tab", tabId]);
    assert.equal(pressed.action, "press");
    assert.equal(pressed.key, "Enter");

    snapshot = await poll(
      "submitted form accessibility state",
      () => chroma(["snapshot", "--all", "--tab", tabId]),
      (value) => value.nodes.some((node) => node.name === "Submitted: hello chroma"),
    );
    const consoleErrorRef = referenceFor(snapshot, "Log console error", "button");
    const runtimeErrorRef = referenceFor(snapshot, "Throw runtime error", "button");
    const httpErrorRef = referenceFor(snapshot, "Request 503", "button");
    const transportErrorRef = referenceFor(snapshot, "Drop connection", "button");

    for (const ref of [consoleErrorRef, runtimeErrorRef, httpErrorRef, transportErrorRef]) {
      await chroma(["click", ref, "--tab", tabId]);
    }

    await poll(
      "console and runtime errors",
      () => chroma(["errors", "--tab", tabId, "--limit", "100"]),
      (value) => {
        const messages = value.events.map((event) => event.message).join("\n");
        return messages.includes("fixture:deliberate-console-error")
          && messages.includes("fixture:deliberate-runtime-error");
      },
    );
    await poll(
      "HTTP and transport failures",
      () => chroma(["network", "--failed", "--tab", tabId, "--limit", "100"]),
      (value) => value.events.some((event) => event.kind === "network-http-error" && event.status === 503)
        && value.events.some((event) => event.kind === "network-failed"),
    );
    await delay(250);
    const errors = await chroma(["errors", "--tab", tabId, "--limit", "100"]);
    const network = await chroma(["network", "--failed", "--tab", tabId, "--limit", "100"]);
    const humanErrors = await runHumanCli(stateDir, ["errors", "--tab", tabId, "--limit", "100"]);
    const humanNetwork = await runHumanCli(stateDir, ["network", "--failed", "--tab", tabId, "--limit", "100"]);
    assert.match(humanErrors.stdout, /fixture:deliberate-console-error/);
    assert.match(humanNetwork.stdout, /503 .*api\/http-error/);
    assert.match(humanNetwork.stdout, /FAIL .*api\/disconnect/);
    assert.equal(errors.targetId, tabId);
    assert.equal(errors.monitorRunning, true);
    assert.equal(errors.bestEffort, true);
    assert.ok(errors.observationStartedAt);
    assert.equal(errors.eventStore.status, "healthy");
    assert.ok(errors.events.every((event) => /^\d{4}-\d{2}-\d{2}T/.test(event.observedAt)));
    assert.ok(errors.events.every((event) => !Object.hasOwn(event, "timestamp")));
    assert.equal(network.targetId, tabId);
    assert.equal(network.eventStore.status, "healthy");
    assertEventCursor(errors.eventStore.cursor);
    assertEventCursor(network.eventStore.cursor);
    assert.deepEqual(Object.keys(errors.eventStore.cursor).sort(), Object.keys(network.eventStore.cursor).sort());
    assert.equal(errors.eventStore.cursor.id, network.eventStore.cursor.id, "quiescent event queries should share a boundary");
    assertRedactedFixtureUrl(errors.url, fixture.url);
    assertRedactedFixtureUrl(network.url, fixture.url);
    assert.ok(network.events.some((event) => event.url === `${fixture.url}/api/http-error` && event.status === 503));
    const httpFailure = network.events.find((event) => event.kind === "network-http-error" && event.status === 503);
    const transportFailure = network.events.find((event) => event.kind === "network-failed");
    assert.equal(httpFailure.method, "GET");
    assert.ok(Number.isInteger(httpFailure.durationToHeadersMs) && httpFailure.durationToHeadersMs >= 0);
    assert.equal(transportFailure.method, "GET");
    assert.equal(transportFailure.url, `${fixture.url}/api/disconnect`);
    assert.ok(Number.isInteger(transportFailure.durationMs) && transportFailure.durationMs >= 0);
    assert.equal(Object.hasOwn(transportFailure, "timestamp"), false);
    assert.match(transportFailure.message, /ERR_|failed|empty/i);

    const screenshot = await chroma([
      "screenshot", "--tab", tabId, "--full-page", "--output", screenshotPath,
    ]);
    assert.equal(screenshot.path, screenshotPath);
    assert.ok(screenshot.bytes > 8);
    const png = await readFile(screenshotPath);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(screenshot.sha256, createHash("sha256").update(png).digest("hex"));
    const screenshotCollision = await expectCliFailure(
      stateDir,
      ["screenshot", "--tab", tabId, "--output", screenshotPath],
      { code: "OUTPUT_EXISTS", exitCode: 2 },
    );
    assert.equal(screenshotCollision.details, undefined);

    const report = await chroma(["report", "--tab", tabId, "--output", reportPath], { timeout: 30_000 });
    assert.equal(report.path, reportPath);
    assert.equal(report.status, "complete");
    assert.deepEqual(new Set(report.files), new Set(["report.json", "README.md", "screenshot.png"]));
    assert.ok(report.summary.errors >= 2);
    assert.ok(report.summary.failedNetwork >= 2);
    assert.ok(report.summary.snapshotNodes > 0);

    const reportJson = JSON.parse(await readFile(join(reportPath, "report.json"), "utf8"));
    assert.equal(reportJson.status, "complete");
    assert.equal(reportJson.tab.id, tabId);
    assertRedactedFixtureUrl(reportJson.tab.url, fixture.url);
    assert.equal(reportJson.observation.monitorRunning, true);
    assert.equal(reportJson.observation.bestEffort, true);
    assertEventCursor(reportJson.observation.boundary);
    assert.equal(report.boundaryId, reportJson.observation.boundary.id);
    assert.equal(reportJson.sections.errors.boundaryId, reportJson.observation.boundary.id);
    assert.equal(reportJson.sections.failedNetwork.boundaryId, reportJson.observation.boundary.id);
    assert.equal(reportJson.redaction.policy, "mandatory-v1");
    assert.equal(reportJson.redaction.appliedBeforePersistence, true);
    assert.equal(reportJson.sections.snapshot.status, "collected");
    assert.equal(reportJson.sections.errors.status, "collected");
    assert.equal(reportJson.sections.failedNetwork.status, "collected");
    assert.equal(reportJson.sections.actionOutcomes.status, "collected");
    assert.ok(reportJson.actionOutcomes.length >= 6);
    assert.ok(reportJson.actionOutcomes.some((action) => action.action === "fill" && action.textLength === "hello chroma".length));
    assert.equal(reportJson.actionOutcomes.some((action) => Object.hasOwn(action, "text")), false);
    assert.ok(reportJson.timeline.some((entry) => entry.correlation?.basis === "temporal" && entry.correlation.confidence === "low" && entry.correlation.afterActionId));
    assert.match(reportJson.correlationPolicy.caveat, /does not prove/);
    assert.equal(reportJson.sections.screenshot.status, "collected");
    assert.ok(reportJson.failedNetwork.some((event) => event.status === 503));
    const reportReadme = await readFile(join(reportPath, "README.md"), "utf8");
    assert.doesNotMatch(reportReadme, /CHROMA_E2E_SECRET|CHROMA_E2E_FILL_SECRET/);
    assert.match(reportReadme, /view=compact/);
    const reportPng = await readFile(join(reportPath, "screenshot.png"));
    assert.deepEqual([...reportPng.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(reportJson.artifactIntegrity.algorithm, "sha256");
    assert.equal(reportJson.artifactIntegrity.attachments[0].sha256, createHash("sha256").update(reportPng).digest("hex"));
    const reportCollision = await expectCliFailure(
      stateDir,
      ["report", "--tab", tabId, "--output", reportPath],
      { code: "OUTPUT_EXISTS", exitCode: 2 },
    );
    assert.equal(reportCollision.details.path, reportPath);

    const noScreenshotReportPath = join(artifactsDir, "report-no-screenshot");
    const noScreenshotReport = await chroma(["report", "--tab", tabId, "--no-screenshot", "--output", noScreenshotReportPath]);
    assert.equal(noScreenshotReport.status, "complete");
    assert.deepEqual(new Set(noScreenshotReport.files), new Set(["report.json", "README.md"]));
    const noScreenshotManifest = JSON.parse(await readFile(join(noScreenshotReportPath, "report.json"), "utf8"));
    assert.equal(noScreenshotManifest.screenshot, null);
    assert.deepEqual(noScreenshotManifest.artifactIntegrity.attachments, []);
    assert.equal(noScreenshotManifest.sections.screenshot.status, "skipped");
    assert.equal(noScreenshotManifest.sections.screenshot.reason.code, "USER_SKIPPED");

    const clearedErrors = await chroma(["errors", "--tab", tabId, "--limit", "100", "--clear"]);
    assert.ok(clearedErrors.count >= 2);
    assert.equal(clearedErrors.cleared, true);
    const afterClearErrors = await chroma(["errors", "--tab", tabId, "--limit", "100"]);
    assert.equal(afterClearErrors.count, 0);
    const networkAfterErrorClear = await chroma(["network", "--failed", "--tab", tabId, "--limit", "100"]);
    assert.ok(networkAfterErrorClear.count >= 2, "clearing errors must not consume network evidence");

    const stateFiles = await assertStateHasNoMarker(stateDir, fillSecret);
    for (const file of stateFiles) {
      assert.equal(file.text.includes(querySecret), false, `${file.path} must redact sensitive query values`);
    }
    assert.ok(stateFiles.some((file) => file.text.includes("view=compact")), "state should retain the non-sensitive view query");
    assert.doesNotMatch(JSON.stringify(reportJson), /CHROMA_E2E_SECRET|CHROMA_E2E_FILL_SECRET/);
    assert.match(JSON.stringify(reportJson), /view=compact/);

    const artifactEntries = await readdir(artifactsDir);
    assert.equal(
      artifactEntries.some((name) => name.startsWith(".report.staging-")),
      false,
      "successful report generation must not leave a staging directory",
    );

    const eventsPath = join(stateDir, "events.jsonl");
    const eventsBackupPath = join(stateDir, "events.before-fault.jsonl");
    await rename(eventsPath, eventsBackupPath);
    await mkdir(eventsPath);
    await chroma(["click", consoleErrorRef, "--tab", tabId]);
    await poll(
      "event-store write failure metadata",
      () => readOptionalJson(join(stateDir, "monitor.json")),
      (state) => state?.eventStore?.writeFailures > 0,
    );
    const degradedErrors = await chroma(["errors", "--tab", tabId]);
    assert.equal(degradedErrors.eventStore.health.status, "failed");
    assert.ok(degradedErrors.eventStore.health.reasons.includes("WRITE_FAILURE"));
    assert.ok(degradedErrors.eventStore.health.reasons.includes("READ_FAILURE"));
    assert.equal(degradedErrors.eventStore.cursor.readError.code, "EISDIR");
    const degradedDoctor = await chroma(["doctor"]);
    assert.equal(degradedDoctor.status, "degraded");
    assert.equal(degradedDoctor.checks.find((check) => check.id === "event_store").status, "fail");
    const faultReportPath = join(artifactsDir, "fault-report");
    const faultReport = await chroma(["report", "--tab", tabId, "--output", faultReportPath]);
    assert.equal(faultReport.status, "partial");
    const faultReportJson = JSON.parse(await readFile(join(faultReportPath, "report.json"), "utf8"));
    assert.equal(faultReportJson.status, "partial");
    assert.equal(faultReportJson.sections.errors.status, "partial");
    assert.equal(faultReportJson.observation.boundary.readError.code, "EISDIR");

    await rm(eventsPath, { recursive: true });
    await rename(eventsBackupPath, eventsPath);
    const recovered = await chroma(["connect", launched.endpoint]);
    monitorPid = recovered.monitor.pid;
    const recoveredDoctor = await chroma(["doctor"]);
    assert.equal(recoveredDoctor.status, "ready");

    await stopOwnedProcessGroup(monitorPid);
    const mismatchedMonitorState = await readOptionalJson(join(stateDir, "monitor.json"));
    await writeFile(
      join(stateDir, "monitor.json"),
      `${JSON.stringify({ ...mismatchedMonitorState, sessionId: "previous-observation-session" }, null, 2)}\n`,
      { mode: 0o600 },
    );
    const identityScopedErrors = await chroma(["errors", "--tab", tabId]);
    assert.equal(identityScopedErrors.count, 0, "events from a mismatched monitor must not be attributed to the live tab");
    assert.equal(identityScopedErrors.eventStore.cursor.ignored, true);
    assert.equal(identityScopedErrors.eventStore.cursor.ignoredReason, "MONITOR_IDENTITY_MISMATCH");
    const identityReportPath = join(artifactsDir, "identity-mismatch-report");
    const identityReport = await chroma(["report", "--tab", tabId, "--no-screenshot", "--output", identityReportPath]);
    assert.equal(identityReport.status, "partial");
    const identityManifest = JSON.parse(await readFile(join(identityReportPath, "report.json"), "utf8"));
    assert.equal(identityManifest.errors.length, 0);
    assert.equal(identityManifest.failedNetwork.length, 0);
    assert.equal(identityManifest.observation.boundary.ignoredReason, "MONITOR_IDENTITY_MISMATCH");

    const identityRecovered = await chroma(["connect", launched.endpoint]);
    monitorPid = identityRecovered.monitor.pid;
    assert.equal((await chroma(["doctor"])).status, "ready");

    const retentionSnapshot = await chroma(["snapshot", "--tab", tabId]);
    const floodRef = referenceFor(retentionSnapshot, "Flood event log", "button");
    await chroma(["click", floodRef, "--tab", tabId]);
    const rotatedState = await poll(
      "bounded event-store rotation",
      () => readOptionalJson(join(stateDir, "monitor.json")),
      (state) => state?.eventStore?.rotations > 0 && state.eventStore.droppedEvents > 0 && state.eventStore.truncatedEvents > 0,
    );
    assert.equal(rotatedState.eventStore.maxBytes, 64 * 1024);
    assert.equal(rotatedState.eventStore.status, "degraded");
    const rotatedErrors = await chroma(["errors", "--tab", tabId, "--limit", "100"]);
    assert.ok(rotatedErrors.eventStore.health.reasons.includes("DROPPED_EVENTS"));
    assert.ok(rotatedErrors.eventStore.health.reasons.includes("TRUNCATED_EVENTS"));
    assert.ok(rotatedErrors.eventStore.cursor.bytes <= 64 * 1024);
    assert.ok(rotatedErrors.events.some((event) => event.message.includes("fixture:oversized:") && event.message.endsWith("[truncated]")));

    await appendFile(join(stateDir, "events.jsonl"), "{fixture-corrupt-line}\n");
    const corruptErrors = await chroma(["errors", "--tab", tabId]);
    assert.equal(corruptErrors.eventStore.cursor.corruptLines, 1);
    assert.ok(corruptErrors.eventStore.health.reasons.includes("CORRUPT_LINES"));
    const retentionReportPath = join(artifactsDir, "retention-report");
    const retentionReport = await chroma(["report", "--tab", tabId, "--output", retentionReportPath]);
    assert.equal(retentionReport.status, "partial");

    await stopOwnedProcessGroup(monitorPid);
    const restartedMonitor = spawn(process.execPath, [MONITOR, "--state-dir", stateDir], { detached: true, stdio: "ignore" });
    restartedMonitor.unref();
    monitorPid = restartedMonitor.pid;
    const restartState = await poll(
      "same-session monitor restart",
      () => readOptionalJson(join(stateDir, "monitor.json")),
      (state) => state?.pid === monitorPid && state.readyAt && state.eventStore?.unknownGapCount > 0,
    );
    assert.equal(restartState.eventStore.status, "degraded");
    assert.ok(restartState.discontinuities.some((entry) => entry.code === "MONITOR_RESTART"));
    const restartDoctor = await chroma(["doctor"]);
    assert.equal(restartDoctor.status, "degraded");
    assert.ok(restartDoctor.checks.find((check) => check.id === "event_store").observed.health.reasons.includes("UNKNOWN_RESTART_GAP"));
    const restartReportPath = join(artifactsDir, "restart-report");
    const restartReport = await chroma(["report", "--tab", tabId, "--output", restartReportPath]);
    assert.equal(restartReport.status, "partial");
    const restartReportJson = JSON.parse(await readFile(join(restartReportPath, "report.json"), "utf8"));
    assert.ok(restartReportJson.observation.discontinuities.some((entry) => entry.code === "MONITOR_RESTART"));
  } finally {
    if (previousEventMaxBytes === undefined) delete process.env.CHROMA_EVENT_MAX_BYTES;
    else process.env.CHROMA_EVENT_MAX_BYTES = previousEventMaxBytes;
    const monitorState = await readOptionalJson(join(stateDir, "monitor.json")).catch(() => null);
    const sessionState = await readOptionalJson(join(stateDir, "session.json")).catch(() => null);
    const discovered = await discoverOwnedProcessGroups(stateDir, profileDir);
    const monitorPids = new Set([monitorPid, monitorState?.pid, ...discovered.monitor].filter(Number.isInteger));
    const chromePids = new Set([chromePid, sessionState?.chromePid, ...discovered.chrome].filter(Number.isInteger));
    for (const pid of monitorPids) await stopOwnedProcessGroup(pid);
    for (const pid of chromePids) await stopOwnedProcessGroup(pid);
    await stopFixture(fixture);
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await assert.rejects(stat(temporaryRoot), (error) => error.code === "ENOENT");
  }
});

test("capture records manual actions, writes evidence, and stops its session", {
  skip: RUN_REAL_CHROME ? false : "set CHROMA_E2E=1 to run the real-Chrome lane",
  timeout: 30_000,
}, async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "chroma-capture-e2e-"));
  const stateDir = join(temporaryRoot, "state");
  const profileDir = join(temporaryRoot, "chrome-profile");
  const reportDir = join(temporaryRoot, "report");
  const fixture = await startFixture();
  let chromePid;
  let monitorPid;

  try {
    const args = [CLI, "--state-dir", stateDir, "--json", "capture", "--headless", "--deterministic", "--profile", profileDir, "--url", fixture.url, "--duration", "3", "--output", reportDir, "--title", "HTTP request fails", "--expected", "The request succeeds.", "--actual", "The endpoint returns HTTP 503."];
    if (process.env.CHROME_PATH) args.push("--chrome", process.env.CHROME_PATH);
    const capturePromise = runProcess(process.execPath, args, { timeout: 35_000 });
    const session = await poll(
      "capture session",
      () => readOptionalJson(join(stateDir, "session.json")),
      (value) => value?.captureActions === true,
      25_000,
    );
    chromePid = session.chromePid;
    const monitor = await poll(
      "capture monitor readiness",
      () => readOptionalJson(join(stateDir, "monitor.json")),
      (value) => value?.sessionId === session.sessionId && value?.readyAt,
    );
    monitorPid = monitor.pid;
    const endpoint = session.endpoint;
    assert.match(endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
    const tab = (await listTabs(endpoint)).find((candidate) => candidate.url.startsWith(fixture.url));
    assert.ok(tab, "capture should open the fixture tab");
    const privateValue = "CAPTURE_INPUT_MUST_NOT_PERSIST";
    await withCdp(tab.webSocketDebuggerUrl, async (cdp) => {
      await cdp.send("Runtime.enable");
      await cdp.send("Runtime.evaluate", { expression: "document.querySelector('#request-http-error').click()" });
      await delay(300);
      await cdp.send("Runtime.evaluate", { expression: `(()=>{const input=document.querySelector('#message');input.value=${JSON.stringify(privateValue)};input.dispatchEvent(new Event('input',{bubbles:true}));})()` });
      await delay(400);
      await cdp.send("Runtime.evaluate", { expression: "document.querySelector('#message').value=''" });
    });

    const captureResult = await capturePromise;
    assert.equal(captureResult.code, 0, captureResult.stderr);
    const envelope = JSON.parse(captureResult.stdout);
    assert.equal(envelope.command, "capture");
    assert.equal(envelope.data.report.status, "complete");
    assert.ok(envelope.data.report.summary.actions >= 2);
    assert.ok(envelope.data.report.summary.failedNetwork >= 1);
    assert.equal(envelope.data.stopped.browser.closed, true);
    assert.equal(envelope.data.stopped.monitor.stopped, true);
    assert.equal(envelope.data.receipt.sessionShutdown.complete, true);
    assert.ok(envelope.data.report.files.includes("capture-receipt.json"));

    const report = JSON.parse(await readFile(join(reportDir, "report.json"), "utf8"));
    const receipt = JSON.parse(await readFile(join(reportDir, "capture-receipt.json"), "utf8"));
    assert.deepEqual(report.claim, { title: "HTTP request fails", expected: "The request succeeds.", actual: "The endpoint returns HTTP 503." });
    assert.match(await readFile(join(reportDir, "README.md"), "utf8"), /## Bug claim[\s\S]*HTTP request fails[\s\S]*Expected:[\s\S]*Actual:/);
    assert.equal(report.observation.coverage, "best-effort");
    assert.deepEqual(receipt.sessionShutdown, { complete: true, monitorStopped: true, browserOwned: true, browserClosed: true });
    assert.ok(report.actionOutcomes.some((action) => action.source === "browser" && action.action === "click" && action.target?.ordinal));
    assert.ok(report.actionOutcomes.some((action) => action.source === "browser" && action.action === "input" && action.textLength === privateValue.length));
    assert.doesNotMatch(JSON.stringify(report), new RegExp(privateValue));
    assert.ok(report.errors.every((event) => !event.sourceTimestamp || new Date(event.sourceTimestamp).getUTCFullYear() < 2100));
    await assertStateHasNoMarker(stateDir, privateValue);
    assert.equal(processGroupAlive(monitorPid), false);
    assert.equal(processGroupAlive(chromePid), false);
  } finally {
    if (monitorPid) await stopOwnedProcessGroup(monitorPid);
    if (chromePid) await stopOwnedProcessGroup(chromePid);
    await stopFixture(fixture);
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("demo refuses an empty success claim and accepts a captured failure", {
  skip: RUN_REAL_CHROME ? false : "set CHROMA_E2E=1 to run the real-Chrome lane",
  timeout: 30_000,
}, async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "chroma-demo-e2e-"));
  const emptyStateDir = join(temporaryRoot, "empty-state");
  const emptyProfileDir = join(temporaryRoot, "empty-profile");
  const emptyReportDir = join(temporaryRoot, "empty-report");
  const capturedStateDir = join(temporaryRoot, "captured-state");
  const capturedProfileDir = join(temporaryRoot, "captured-profile");
  const capturedReportDir = join(temporaryRoot, "captured-report");
  const ownedPids = new Set();

  try {
    const emptyArgs = [CLI, "--state-dir", emptyStateDir, "--json", "demo", "--headless", "--deterministic", "--profile", emptyProfileDir, "--duration", "1", "--output", emptyReportDir];
    if (process.env.CHROME_PATH) emptyArgs.push("--chrome", process.env.CHROME_PATH);
    const emptyResult = await runProcess(process.execPath, emptyArgs, { timeout: 20_000 });
    assert.equal(emptyResult.code, 1, emptyResult.stderr);
    const emptyEnvelope = JSON.parse(emptyResult.stdout);
    assert.equal(emptyEnvelope.error.code, "DEMO_EVIDENCE_INCOMPLETE");
    assert.equal(emptyEnvelope.error.retryable, true);
    assert.equal(emptyEnvelope.error.details.reportPath, emptyReportDir);
    assert.equal(emptyEnvelope.error.details.evidenceRequirement.status, "not-met");
    assert.equal(emptyEnvelope.error.details.sessionShutdown.complete, true);
    const emptyReport = JSON.parse(await readFile(join(emptyReportDir, "report.json"), "utf8"));
    assert.equal(emptyReport.status, "complete", "bundle integrity and demo evidence are separate claims");
    assert.equal(emptyReport.evidenceRequirement.status, "not-met");
    assert.match(await readFile(join(emptyReportDir, "README.md"), "utf8"), /Demo evidence requirement: \*\*not-met\*\*/);

    const capturedArgs = [CLI, "--state-dir", capturedStateDir, "--json", "demo", "--headless", "--deterministic", "--profile", capturedProfileDir, "--duration", "2", "--output", capturedReportDir];
    if (process.env.CHROME_PATH) capturedArgs.push("--chrome", process.env.CHROME_PATH);
    const capturedPromise = runProcess(process.execPath, capturedArgs, { timeout: 20_000 });
    const session = await poll(
      "demo capture session",
      () => readOptionalJson(join(capturedStateDir, "session.json")),
      (value) => value?.captureActions === true,
      15_000,
    );
    ownedPids.add(session.chromePid);
    const monitor = await poll(
      "demo monitor readiness",
      () => readOptionalJson(join(capturedStateDir, "monitor.json")),
      (value) => value?.sessionId === session.sessionId && value?.readyAt,
    );
    ownedPids.add(monitor.pid);
    const tab = await poll(
      "demo tab",
      async () => (await listTabs(session.endpoint)).find((candidate) => candidate.title === "Chroma capture demo"),
      Boolean,
    );
    await withCdp(tab.webSocketDebuggerUrl, async (cdp) => {
      await cdp.send("Runtime.enable");
      await cdp.send("Runtime.evaluate", { expression: "document.querySelector('#request-failure').click()" });
      await delay(500);
    });

    const capturedResult = await capturedPromise;
    assert.equal(capturedResult.code, 0, capturedResult.stderr);
    const capturedEnvelope = JSON.parse(capturedResult.stdout);
    assert.equal(capturedEnvelope.data.report.evidenceRequirement.status, "met");
    assert.equal(capturedEnvelope.data.receipt.evidenceRequirement.status, "met");
    assert.equal(capturedEnvelope.data.demo.evidenceRequirement.status, "met");
    assert.ok(capturedEnvelope.data.report.summary.actions >= 1);
    assert.ok(capturedEnvelope.data.report.summary.errors >= 1);
    assert.ok(capturedEnvelope.data.report.summary.failedNetwork >= 1);
    assert.equal(capturedEnvelope.data.receipt.sessionShutdown.complete, true);
    assert.match(await readFile(join(capturedReportDir, "README.md"), "utf8"), /Demo evidence requirement: \*\*met\*\*/);
  } finally {
    for (const pid of ownedPids) await stopOwnedProcessGroup(pid);
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
