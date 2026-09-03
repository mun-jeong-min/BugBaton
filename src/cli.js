import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, lstat, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { commandHint, parseArgs } from "./args.js";
import { CdpConnection } from "./cdp.js";
import { assertSafeEndpoint, browserInstanceId, browserVersion, chromeBinaryVersion, findChrome, findFreeLoopbackPort, launchChrome, listTabs, normalizeEndpoint, waitForChrome } from "./chrome.js";
import { captureScreenshot, captureSnapshot, interact, readActions, readEventLog, readEvents, tabContext } from "./operations.js";
import { readJson, sessionPaths, stateRoot, writeJson } from "./state.js";
import { redactUrl } from "./redact.js";
import { eventStoreHealth } from "./event-health.js";
import { codedError, errorPayload, safeSingleLine } from "./errors.js";
import { assessDemoEvidence, startDemoServer } from "./demo.js";

const VERSION = "0.1.0";
const MONITOR = fileURLToPath(new URL("./monitor.js", import.meta.url));
const MAX_BUNDLE_JSON_BYTES = 25 * 1024 * 1024;
const MAX_BUNDLE_ATTACHMENTS = 100;

const HELP = `bugbaton — pass the bug, not the browser

A local flight recorder for a browser bug you can reproduce but have not automated.
No account, cloud, browser extension, or MCP server.

Usage:
  bugbaton <command> [options]

Session:
  doctor                   Inspect local runtime and connection readiness
  demo                     Run a self-contained capture against a safe local bug
  capture [--url URL]      Reproduce once, then write a report and stop
  launch [--url URL]       Launch an isolated Chrome with CDP enabled
  connect [ENDPOINT]       Remember an existing local Chrome endpoint
  stop                     Stop observation and an owned Chrome process
  tabs                     List page targets

Observe and diagnose:
  snapshot [--tab MATCH]   Print an accessibility snapshot with stable @e refs
  errors [--since TIME]    Show errors observed since launch/connect
  network --failed         Show failed and HTTP 4xx/5xx requests
  screenshot               Capture the selected tab as PNG
  report                   Write a shareable local diagnostic bundle
  verify REPORT_DIR        Verify a saved bundle without opening Chrome

Light interaction:
  click @e1                Click a ref from the latest snapshot
  fill @e2 "text"          Fill an input without echoing the value
  press [@e2] Enter        Focus an optional ref and dispatch a key

Global options:
  --json                   Emit one versioned JSON envelope on stdout
  --endpoint URL           Override the remembered endpoint
  --state-dir PATH         Override local state (or BUGBATON_STATE_DIR)
  --allow-remote           Permit a non-loopback CDP endpoint (unsafe by default)
  -v, --verbose            Print diagnostic progress to stderr
  -h, --help               Show help without side effects
  --version                Print the version

Run "bugbaton <command> --help" for command-specific usage.`;

const COMMAND_HELP = {
  doctor: "Usage: bugbaton doctor [--chrome PATH] [--json]\nRead-only checks for Node, Chrome, saved session, monitor, and endpoint.",
  demo: "Usage: bugbaton demo [--output DIR] [--duration SECONDS] [--title TEXT] [--expected TEXT] [--actual TEXT] [--chrome PATH] [--port PORT] [--profile PATH] [--headless] [--deterministic] [--no-screenshot] [--json]\nOpen a packaged local failure page, capture your actions and diagnostics, write a report, and stop. No existing app or network service is required.",
  capture: "Usage: bugbaton capture [--url URL] [--output DIR] [--duration SECONDS] [--title TEXT] [--expected TEXT] [--actual TEXT] [--chrome PATH] [--port PORT] [--profile PATH] [--headless] [--deterministic] [--no-screenshot] [--json]\nLaunch isolated Chrome, capture a privacy-safe manual action trail, write a report, and stop. A free loopback CDP port and unique report directory are selected by default. Without --duration, press Enter or Ctrl+C after reproducing the bug.",
  launch: "Usage: bugbaton launch [--chrome PATH] [--port 9222] [--profile PATH] [--url URL] [--headless] [--deterministic] [--json]",
  connect: "Usage: bugbaton connect [ENDPOINT] [--allow-remote] [--json]\nDefault endpoint: http://127.0.0.1:9222",
  stop: "Usage: bugbaton stop [--json]\nStop the observation monitor and close Chrome only when BugBaton launched and can verify it.",
  tabs: "Usage: bugbaton tabs [--endpoint URL] [--json]",
  snapshot: "Usage: bugbaton snapshot [--tab ID|URL|TITLE] [--all] [--json]",
  click: "Usage: bugbaton click @eN [--tab MATCH] [--json]\n       bugbaton click --selector CSS [--tab MATCH]",
  fill: "Usage: bugbaton fill @eN TEXT [--tab MATCH] [--json]\n       bugbaton fill @eN --stdin < value.txt\n       bugbaton fill --selector CSS TEXT",
  press: "Usage: bugbaton press [@eN] KEY [--tab MATCH] [--json]",
  errors: "Usage: bugbaton errors [--tab MATCH] [--since ISO_TIME] [--limit N] [--clear] [--json]",
  network: "Usage: bugbaton network --failed [--tab MATCH] [--since ISO_TIME] [--limit N] [--clear] [--json]",
  screenshot: "Usage: bugbaton screenshot [--tab MATCH] [--output FILE] [--full-page] [--json]",
  report: "Usage: bugbaton report [--tab MATCH] [--output DIR] [--title TEXT] [--expected TEXT] [--actual TEXT] [--no-screenshot] [--json]",
  verify: "Usage: bugbaton verify REPORT_DIR [--json]\nValidate a BugBaton report, attachment hashes, safe paths, and capture-receipt consistency without opening Chrome.",
  version: "Usage: bugbaton version [--json]",
};

function cliError(message, code = "OPERATION_FAILED", exitCode = 1) {
  return codedError(code, message, { exitCode });
}

function output(command, data, json, human) {
  if (json) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: true, command, data, error: null })}\n`);
  } else {
    process.stdout.write(`${human(data)}\n`);
  }
}

function formatRows(rows, columns) {
  if (!rows.length) return "No results.";
  const widths = columns.map(({ label, value }) => Math.max(label.length, ...rows.map((row) => safeSingleLine(value(row)).length)));
  const line = (row) => columns.map(({ value }, index) => safeSingleLine(value(row)).padEnd(widths[index])).join("  ").trimEnd();
  return [columns.map(({ label }, index) => label.padEnd(widths[index])).join("  ").trimEnd(), ...rows.map(line)].join("\n");
}

async function pidAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function startMonitor(paths, endpoint, instanceId, sessionId, verbose = false) {
  const current = await readJson(paths.monitor);
  if (current && await pidAlive(current.pid)) {
    if (current.endpoint === endpoint && current.browserInstanceId === instanceId && current.sessionId === sessionId) {
      if (current.readyAt) return { ...current, reused: true };
      const readyDeadline = Date.now() + 3_000;
      while (Date.now() < readyDeadline) {
        const state = await readJson(paths.monitor);
        if (state?.pid === current.pid && state.readyAt) return { ...state, reused: true };
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw codedError("MONITOR_NOT_READY", "The observation monitor is alive but not ready", { exitCode: 3, retryable: true, hint: "Run `bugbaton doctor`; retry when the monitor check is ready." });
    }
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && await pidAlive(current.pid)) await new Promise((resolve) => setTimeout(resolve, 100));
    if (await pidAlive(current.pid)) throw codedError("MONITOR_HANDOFF", "The previous observation monitor is still stopping", { exitCode: 3, retryable: true, hint: "Retry in a moment; use `bugbaton doctor` if the process remains stuck." });
  }
  if (verbose) process.stderr.write("Starting background observation monitor…\n");
  const child = spawn(process.execPath, [MONITOR, "--state-dir", paths.root], { detached: true, stdio: "ignore" });
  child.unref();
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const state = await readJson(paths.monitor);
    if (state?.pid === child.pid && state.readyAt) return { ...state, reused: false };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw codedError("MONITOR_START_FAILED", "Observation monitor did not start", { exitCode: 3, retryable: true, hint: "Run `bugbaton doctor` to inspect state permissions and endpoint health." });
}

async function resolveSession(parsed, paths) {
  const stored = await readJson(paths.session);
  const endpoint = normalizeEndpoint(parsed.options.endpoint ?? stored?.endpoint ?? "http://127.0.0.1:9222");
  assertSafeEndpoint(endpoint, parsed.options.allow_remote);
  return { endpoint, stored };
}

function assertSessionIdentity(stored, version, endpoint) {
  if (!stored?.browserInstanceId || stored.endpoint !== endpoint) return;
  if (stored.browserInstanceId !== browserInstanceId(version)) {
    throw cliError("A different Chrome process now owns the saved endpoint; run `bugbaton connect` to establish a new observation window", "STALE_SESSION", 3);
  }
}

function requirePositionals(parsed, min, max, usage) {
  if (parsed.positionals.length < min || parsed.positionals.length > max) throw cliError(usage, "USAGE_ERROR", 2);
}

async function readStdinText() {
  if (process.stdin.isTTY) throw cliError("--stdin requires piped or redirected input", "USAGE_ERROR", 2);
  process.stdin.setEncoding("utf8");
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  if (value.endsWith("\r\n")) return value.slice(0, -2);
  if (value.endsWith("\n")) return value.slice(0, -1);
  return value;
}

async function nearestWritableParent(target) {
  let current = target;
  while (true) {
    try {
      const info = await stat(current);
      let writable = true;
      try { await access(current, constants.W_OK); } catch { writable = false; }
      const posixPermissions = process.platform !== "win32";
      return {
        path: current,
        exists: current === target,
        writable,
        mode: posixPermissions ? (info.mode & 0o777).toString(8).padStart(3, "0") : null,
        ownerOnly: posixPermissions ? (info.mode & 0o077) === 0 : null,
        permissionModel: posixPermissions ? "posix-mode" : "platform-acl-not-inspected",
      };
    } catch (error) {
      if (error.code !== "ENOENT") return { path: current, exists: false, writable: false, error: error.message };
      const parent = path.dirname(current);
      if (parent === current) return { path: current, exists: false, writable: false };
      current = parent;
    }
  }
}

function runtimeDoctorCheck(nodeOk) {
  return { id: "runtime", status: nodeOk ? "pass" : "fail", summary: `BugBaton ${VERSION} on Node ${process.version}`, observed: { requiredNodeMajor: 22 } };
}

function chromeDoctorCheck(chrome, chromeVersion) {
  return { id: "chrome_binary", status: chrome ? "pass" : "warn", summary: chrome ? `${chromeVersion ?? "Chrome"} is executable` : "Chrome binary was not found for launch", observed: { path: chrome, version: chromeVersion } };
}

function stateDoctorCheck(state, metadataErrors = []) {
  let status = "fail";
  let summary = "State path is not writable";
  if (metadataErrors.length) {
    summary = "State metadata contains invalid JSON";
  } else if (state.writable && (!state.exists || state.ownerOnly || state.permissionModel === "platform-acl-not-inspected")) {
    status = "pass";
    summary = state.permissionModel === "platform-acl-not-inspected"
      ? "State path is writable; platform ACLs were not inspected"
      : "State path is writable with an owner-only directory when materialized";
  } else if (state.writable) {
    status = "warn";
    summary = "State directory is writable but accessible by group/others";
  }
  return { id: "state", status, summary, observed: { ...state, metadataErrors } };
}

function endpointDoctorCheck(version, endpointError, endpoint) {
  return { id: "endpoint", status: version ? "pass" : "fail", summary: version ? `CDP discovery reached ${version.Browser}` : `CDP discovery failed: ${endpointError}`, observed: { endpoint, reachable: Boolean(version) } };
}

function identityDoctorCheck(version, session, instanceMatches) {
  let summary = "No saved session identity";
  if (session) summary = instanceMatches ? "Saved session matches the live Chrome instance" : "A different Chrome process owns the saved endpoint";
  return { id: "session_identity", status: version && session ? instanceMatches ? "pass" : "fail" : "warn", summary, observed: { saved: Boolean(session?.browserInstanceId), matches: version && session ? instanceMatches : null } };
}

function protocolDoctorCheck(version, protocolOk) {
  return { id: "protocol", status: version && protocolOk ? "pass" : "warn", summary: version ? `CDP protocol ${version["Protocol-Version"] ?? "unknown"}` : "Protocol unavailable until Chrome connects", observed: { expected: "1.3", actual: version?.["Protocol-Version"] ?? null } };
}

function monitorDoctorCheck(monitor, monitorRunning) {
  let summary = "Observation monitor is not running";
  if (monitorRunning) summary = monitor?.readyAt ? `${monitor.activeTargetIds?.length ?? 0} active page target(s) observed` : "Monitor process is starting";
  return { id: "monitor", status: monitorRunning && monitor?.readyAt ? "pass" : "warn", summary, observed: { pid: monitorRunning ? monitor.pid : null, startedAt: monitor?.startedAt ?? null, readyAt: monitor?.readyAt ?? null } };
}

function eventStoreDoctorCheck(monitor, cursor, collectorHealthy) {
  const health = eventStoreHealth(monitor?.eventStore, cursor);
  return { id: "event_store", status: collectorHealthy ? "pass" : health.status === "failed" ? "fail" : "warn", summary: collectorHealthy ? "Event store is writable and parseable" : `Event store is incomplete (${health.status}; ${health.reasons.join(", ") || "collector unavailable"})`, observed: { ...monitor?.eventStore, health, cursor } };
}

function profileDoctorCheck(session, profileInsideState) {
  let summary = "External Chrome profile ownership is unknown";
  if (session?.profile) summary = profileInsideState ? "Chrome profile is isolated under BugBaton state" : "Explicit Chrome profile is outside BugBaton state";
  return { id: "profile", status: session?.profile && profileInsideState ? "pass" : "warn", summary, observed: { path: session?.profile ?? null, isolated: session?.profile ? profileInsideState : null } };
}

function deriveDoctorStatus({ version, instanceMatches, monitorRunning, collectorHealthy, stateCheck }) {
  if (!version) return "not_connected";
  if (!instanceMatches) return "stale_session";
  if (!monitorRunning || !collectorHealthy || stateCheck.status === "fail") return "degraded";
  return "ready";
}

function deriveDoctorNextAction({ version, instanceMatches, monitor, monitorRunning, collectorHealthy, stateCheck }) {
  if (stateCheck.status === "fail") return "Fix state-directory permissions or move the invalid state file named by the state check, then run `bugbaton connect`.";
  if (!version) return "Run `bugbaton launch` or start Chrome with remote debugging and run `bugbaton connect`.";
  if (!instanceMatches) return "Run `bugbaton connect` to trust the Chrome process now at this endpoint.";
  if (!monitorRunning || !monitor?.readyAt) return "Run `bugbaton connect` again to start a ready observation monitor.";
  if (!collectorHealthy) return "Check state-directory permissions and free space, then run `bugbaton connect` to start a clean observation window.";
  return "Run `bugbaton tabs` or `bugbaton snapshot`.";
}

function buildDoctorResult({ status, checks, nodeOk, chrome, chromeVersion, session, paths, endpoint, version, endpointError, monitor, monitorRunning, nextAction }) {
  return {
    status,
    version: VERSION,
    checks,
    node: { ok: nodeOk, version: process.version },
    chrome: { found: Boolean(chrome), path: chrome, version: chromeVersion },
    session: { found: Boolean(session), path: paths.session, endpoint: session?.endpoint ?? null },
    endpoint: { url: endpoint, reachable: Boolean(version), browser: version?.Browser ?? null, protocolVersion: version?.["Protocol-Version"] ?? null, error: endpointError },
    monitor: { running: monitorRunning, pid: monitorRunning ? monitor.pid : null, startedAt: monitorRunning ? monitor.startedAt : null },
    nextAction,
  };
}

async function doctor(parsed, paths) {
  const chrome = await findChrome(parsed.options.chrome);
  const chromeVersion = await chromeBinaryVersion(chrome);
  const sessionResult = await inspectStateJson(paths.session);
  const monitorResult = await inspectStateJson(paths.monitor);
  const session = sessionResult.value;
  const monitor = monitorResult.value;
  const state = await nearestWritableParent(paths.root);
  const eventLog = await readEventLog(paths);
  const endpoint = normalizeEndpoint(parsed.options.endpoint ?? session?.endpoint ?? "http://127.0.0.1:9222");
  let version = null;
  let endpointError = null;
  try {
    assertSafeEndpoint(endpoint, parsed.options.allow_remote);
    version = await browserVersion(endpoint);
  } catch (error) { endpointError = error.message; }
  const instanceMatches = !session?.browserInstanceId || !version || session.browserInstanceId === browserInstanceId(version);
  const monitorRunning = monitor ? await pidAlive(monitor.pid) && monitor.browserInstanceId === session?.browserInstanceId && monitor.sessionId === session?.sessionId : false;
  const nodeOk = Number(process.versions.node.split(".")[0]) >= 22;
  const protocolOk = !version || version["Protocol-Version"] === "1.3";
  const collectorHealthy = monitorRunning && monitor?.readyAt && eventStoreHealth(monitor?.eventStore, eventLog.cursor).status === "healthy";
  const profileInsideState = !session?.profile || path.resolve(session.profile).startsWith(`${paths.root}${path.sep}`);
  const metadataErrors = [sessionResult.error, monitorResult.error].filter(Boolean);
  const stateCheck = stateDoctorCheck(state, metadataErrors);
  const checks = [
    runtimeDoctorCheck(nodeOk),
    chromeDoctorCheck(chrome, chromeVersion),
    stateCheck,
    endpointDoctorCheck(version, endpointError, endpoint),
    identityDoctorCheck(version, session, instanceMatches),
    protocolDoctorCheck(version, protocolOk),
    monitorDoctorCheck(monitor, monitorRunning),
    eventStoreDoctorCheck(monitor, eventLog.cursor, collectorHealthy),
    profileDoctorCheck(session, profileInsideState),
  ];
  const metrics = { version, instanceMatches, monitor, monitorRunning, collectorHealthy, stateCheck };
  return buildDoctorResult({ status: deriveDoctorStatus(metrics), checks, nodeOk, chrome, chromeVersion, session, paths, endpoint, version, endpointError, monitor, monitorRunning, nextAction: deriveDoctorNextAction(metrics) });
}

async function inspectStateJson(file) {
  try {
    return { value: await readJson(file), error: null };
  } catch (error) {
    return { value: null, error: { code: error.code ?? "STATE_READ_FAILED", message: error.message, path: file } };
  }
}

async function commandLaunch(parsed, paths, { captureActions = false } = {}) {
  requirePositionals(parsed, 0, 0, COMMAND_HELP.launch);
  const binary = await findChrome(parsed.options.chrome);
  if (!binary) throw cliError("Chrome was not found; pass --chrome PATH or set CHROME_PATH", "CHROME_NOT_FOUND", 3);
  const port = Number(parsed.options.port ?? 9222);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw cliError("--port must be an integer from 1 to 65535", "USAGE_ERROR", 2);
  const endpoint = normalizeEndpoint(`http://127.0.0.1:${port}`);
  try {
    const occupied = await browserVersion(endpoint);
    throw codedError("PORT_IN_USE", `CDP port ${port} already belongs to ${occupied.Browser ?? "a browser"}`, {
      exitCode: 2,
      hint: `Choose another --port, or run \`bugbaton connect ${endpoint}\` to begin a new observation window.`,
      details: { endpoint, browser: occupied.Browser ?? null },
    });
  } catch (error) {
    if (error.code === "PORT_IN_USE") throw error;
  }
  const profile = path.resolve(parsed.options.profile ?? path.join(paths.root, "chrome-profile"));
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  const launched = launchChrome(binary, { port, profile, url: parsed.options.url, headless: parsed.options.headless, deterministic: parsed.options.deterministic });
  let version;
  try {
    version = await waitForChrome(endpoint, 30_000);
  } catch (error) {
    try { process.kill(launched.pid, "SIGTERM"); } catch {}
    throw codedError("CDP_STARTUP_FAILED", `Chrome did not expose CDP at ${endpoint}`, {
      exitCode: 3,
      retryable: true,
      hint: "Check the Chrome binary/profile, choose a free --port, and run `bugbaton doctor`.",
      details: { endpoint, cause: error.message },
    });
  }
  const instanceId = browserInstanceId(version);
  const session = { schemaVersion: 1, sessionId: randomUUID(), endpoint, browserInstanceId: instanceId, connectedAt: new Date().toISOString(), source: "launch", chromePid: launched.pid, profile, deterministic: Boolean(parsed.options.deterministic), captureActions, browser: version.Browser, protocolVersion: version["Protocol-Version"] ?? null, warnings: parsed.options.profile ? ["An explicit Chrome profile may expose authenticated sessions and be modified by page actions."] : [] };
  await writeJson(paths.session, session);
  const monitor = await startMonitor(paths, endpoint, instanceId, session.sessionId, parsed.options.verbose || parsed.options.v);
  return { ...session, monitor };
}

async function commandConnect(parsed, paths) {
  requirePositionals(parsed, 0, 1, COMMAND_HELP.connect);
  if (parsed.positionals[0] && parsed.options.endpoint) throw cliError("Use either positional ENDPOINT or --endpoint, not both", "USAGE_ERROR", 2);
  const endpoint = normalizeEndpoint(parsed.positionals[0] ?? parsed.options.endpoint ?? "http://127.0.0.1:9222");
  assertSafeEndpoint(endpoint, parsed.options.allow_remote);
  const version = await browserVersion(endpoint).catch((error) => {
    throw codedError("CDP_UNAVAILABLE", `Cannot reach Chrome at ${endpoint}: ${error.message}`, { exitCode: 3, retryable: true, hint: "Start Chrome with remote debugging, or run `bugbaton launch`." });
  });
  const instanceId = browserInstanceId(version);
  const session = { schemaVersion: 1, sessionId: randomUUID(), endpoint, browserInstanceId: instanceId, connectedAt: new Date().toISOString(), source: "connect", browser: version.Browser, protocolVersion: version["Protocol-Version"] ?? null, warnings: parsed.options.allow_remote ? ["Remote CDP grants browser-level control and is not authenticated by BugBaton."] : [] };
  await writeJson(paths.session, session);
  const monitor = await startMonitor(paths, endpoint, instanceId, session.sessionId, parsed.options.verbose || parsed.options.v);
  return { ...session, monitor };
}

async function waitForPidExit(pid, timeoutMs = 3_000) {
  if (!await pidAlive(pid)) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!await pidAlive(pid)) return true;
  }
  return false;
}

async function waitForEndpointExit(endpoint, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await browserVersion(endpoint);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function closeOwnedChrome(session) {
  if (session?.source !== "launch") return { owned: false, closed: false, reason: "external-browser" };
  let version;
  try {
    version = await browserVersion(session.endpoint);
  } catch {
    const processExited = await waitForPidExit(session.chromePid, 5_000);
    return { owned: true, closed: processExited, endpointClosed: true, processExited, pid: session.chromePid, reason: processExited ? null : "endpoint-unreachable-process-alive" };
  }
  if (!session.browserInstanceId || browserInstanceId(version) !== session.browserInstanceId) {
    return { owned: true, closed: false, pid: session.chromePid, reason: "browser-identity-mismatch" };
  }
  try {
    const cdp = await new CdpConnection(version.webSocketDebuggerUrl).open();
    await cdp.send("Browser.close").catch(() => {});
    cdp.close();
  } catch {}
  const [endpointClosed, processExited] = await Promise.all([
    waitForEndpointExit(session.endpoint, 8_000),
    waitForPidExit(session.chromePid, 8_000),
  ]);
  const closed = endpointClosed && processExited;
  const reason = closed ? null : !endpointClosed ? "endpoint-close-timeout" : "process-exit-timeout";
  return { owned: true, closed, endpointClosed, processExited, pid: session.chromePid, reason };
}

async function commandStop(parsed, paths) {
  requirePositionals(parsed, 0, 0, COMMAND_HELP.stop);
  const [session, monitor] = await Promise.all([readJson(paths.session), readJson(paths.monitor)]);
  await rm(paths.session, { force: true });
  const browser = await closeOwnedChrome(session);
  const monitorStopped = !monitor?.pid || await waitForPidExit(monitor.pid);
  if (monitorStopped) await rm(paths.monitor, { force: true });
  const warnings = [];
  if (!monitorStopped) warnings.push("The observation monitor did not stop before the timeout; run `bugbaton doctor` before starting another session.");
  if (browser.owned && !browser.closed) warnings.push(`BugBaton left its Chrome process running because it could not close it safely (${browser.reason}).`);
  return {
    activeSession: Boolean(session),
    stopped: monitorStopped && (!browser.owned || browser.closed),
    monitor: { pid: monitor?.pid ?? null, stopped: monitorStopped },
    browser,
    evidenceRetained: true,
    stateDir: paths.root,
    warnings,
  };
}

function captureDuration(value) {
  if (value === undefined) return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3_600) {
    throw cliError("--duration must be a number greater than 0 and no more than 3600 seconds", "USAGE_ERROR", 2);
  }
  return seconds;
}

async function waitForCapture(durationSeconds) {
  if (durationSeconds !== null) {
    process.stderr.write(`Capturing for ${durationSeconds} seconds. Reproduce the bug in Chrome now.\n`);
    await new Promise((resolve) => setTimeout(resolve, durationSeconds * 1_000));
    return "duration";
  }
  process.stderr.write("Capturing. Reproduce the bug in Chrome, then press Enter or Ctrl+C here.\n");
  return new Promise((resolve, reject) => {
    let receivedInput = false;
    const finish = (reason) => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.off("SIGINT", onInterrupt);
      process.stdin.pause();
      resolve(reason);
    };
    const onData = () => { receivedInput = true; finish("input"); };
    const onEnd = () => {
      if (receivedInput) return;
      process.off("SIGINT", onInterrupt);
      reject(cliError("Interactive capture needs a terminal or piped newline; use --duration SECONDS in non-interactive environments", "USAGE_ERROR", 2));
    };
    const onInterrupt = () => finish("interrupt");
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", onData);
    process.stdin.once("end", onEnd);
    process.once("SIGINT", onInterrupt);
    process.stdin.resume();
  });
}

async function commandCapture(parsed, paths, context = {}) {
  requirePositionals(parsed, 0, 0, COMMAND_HELP.capture);
  const duration = captureDuration(parsed.options.duration);
  reportClaim(parsed.options);
  const captureArgs = parsed.options.port === undefined
    ? { ...parsed, options: { ...parsed.options, port: String(await findFreeLoopbackPort()) } }
    : parsed;
  let launched;
  let report;
  let endedBy;
  let stopped;
  let receipt;
  try {
    launched = await commandLaunch(captureArgs, paths, { captureActions: true });
    endedBy = await waitForCapture(duration);
    report = await commandReport(captureArgs, paths, launched.endpoint, context);
  } finally {
    if (launched) stopped = await commandStop({ ...captureArgs, positionals: [] }, paths);
  }
  if (report && stopped) {
    receipt = {
      schemaVersion: 1,
      completedAt: new Date().toISOString(),
      endedBy,
      bundleStatus: report.status,
      ...(report.evidenceRequirement ? { evidenceRequirement: report.evidenceRequirement } : {}),
      sessionShutdown: {
        complete: stopped.stopped,
        monitorStopped: stopped.monitor.stopped,
        browserOwned: stopped.browser.owned,
        browserClosed: stopped.browser.owned ? stopped.browser.closed : null,
      },
      evidenceRetained: stopped.evidenceRetained,
    };
    await writeFile(path.join(report.path, "capture-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    report.files.push("capture-receipt.json");
  }
  return {
    report,
    receipt,
    endedBy,
    stopped,
    warnings: [...(report?.warning ? [report.warning] : []), ...(stopped?.warnings ?? [])],
  };
}

async function commandDemo(parsed, paths) {
  requirePositionals(parsed, 0, 0, COMMAND_HELP.demo);
  const demo = await startDemoServer();
  process.stderr.write(`Demo ready at ${demo.url}. Follow the three steps in Chrome.\n`);
  try {
    const capture = await commandCapture({
      ...parsed,
      options: {
        title: "The demo request fails after one click",
        expected: "The request completes successfully.",
        actual: "The endpoint returns HTTP 503 and the page logs an error.",
        ...parsed.options,
        url: demo.url,
      },
    }, paths, { assessEvidence: assessDemoEvidence });
    if (capture.report.evidenceRequirement?.status !== "met") {
      const { actions, errors, failedNetwork } = capture.report.summary;
      throw codedError(
        "DEMO_EVIDENCE_INCOMPLETE",
        `Demo ended without the promised evidence (${actions} actions, ${errors} errors, ${failedNetwork} failed requests). The report was kept at ${capture.report.path} and Chrome was closed. Run it again and complete the HTTP 503 step before ending capture.`,
        {
          retryable: true,
          hint: "Run `bugbaton demo` again, complete at least the HTTP 503 step, then end the capture.",
          details: { reportPath: capture.report.path, evidenceRequirement: capture.report.evidenceRequirement, sessionShutdown: capture.receipt?.sessionShutdown ?? null },
        },
      );
    }
    return { ...capture, demo: { url: demo.url, localOnly: true, evidenceRequirement: capture.report.evidenceRequirement } };
  } finally {
    await demo.close();
  }
}

async function commandEvents(parsed, paths, endpoint, type, liveVersion) {
  const limit = Number(parsed.options.limit ?? 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw cliError("--limit must be an integer from 1 to 1000", "USAGE_ERROR", 2);
  if (parsed.options.since && Number.isNaN(Date.parse(parsed.options.since))) throw cliError("--since must be a valid ISO-8601 time", "USAGE_ERROR", 2);
  const { tab } = await tabContext(endpoint, parsed.options.tab, { requireExplicit: true });
  const kinds = type === "errors" ? ["error", "warning"] : ["network-failed", "network-http-error"];
  const [storedSession, storedMonitor] = await Promise.all([readJson(paths.session), readJson(paths.monitor)]);
  const instanceId = browserInstanceId(liveVersion);
  const session = belongsToLiveBrowser(storedSession, endpoint, instanceId) ? storedSession : null;
  const monitor = session && belongsToLiveBrowser(storedMonitor, endpoint, instanceId, session.sessionId) ? storedMonitor : null;
  const rawEventLog = await readEventLog(paths);
  const eventLog = monitor ? rawEventLog : ignoredEventLog(rawEventLog, "MONITOR_IDENTITY_MISMATCH");
  const eventResult = await readEvents(paths, { kinds, tabId: tab.id, limit, since: parsed.options.since, clear: parsed.options.clear, eventLog });
  const events = eventResult.events;
  const targetObservation = monitor?.targets?.[tab.id];
  const health = eventStoreHealth(monitor?.eventStore, eventResult.cursor);
  return { targetId: tab.id, url: redactUrl(tab.url), observationStartedAt: targetObservation?.observedAt ?? null, monitorStartedAt: monitor?.startedAt ?? null, monitorRunning: monitor ? await pidAlive(monitor.pid) : false, bestEffort: true, completeSinceNavigation: false, eventStore: { ...monitor?.eventStore, health, cursor: eventResult.cursor }, count: events.length, events, cleared: Boolean(parsed.options.clear) };
}

function snapshotHuman(data) {
  const lines = [`${safeSingleLine(data.title || "(untitled)")} — ${safeSingleLine(data.url)}`];
  for (const node of data.nodes) {
    const ref = node.ref ? `${node.ref} ` : "    ";
    const label = [node.name && JSON.stringify(node.name), node.value && `value=${JSON.stringify(node.value)}`].filter(Boolean).join(" ");
    lines.push(`${ref}${node.role}${label ? ` ${label}` : ""}`);
  }
  return lines.join("\n");
}

function markdownInline(value) {
  return safeSingleLine(value).replace(/[\\`*_[\]<>]/g, "\\$&");
}

function actionTargetLabel(action) {
  if (action.ref) return action.ref;
  if (action.selector) return action.selector;
  const tag = action.target?.tag ?? "element";
  const ordinal = action.target?.ordinal ? ` #${action.target.ordinal}` : "";
  const type = action.target?.type ? ` type=${action.target.type}` : "";
  return `${tag}${ordinal}${type}`;
}

function reportTimelineMarkdown(timeline) {
  const visible = timeline.slice(0, 30).map((entry) => {
    if (entry.type === "action") {
      const details = [entry.key && `key=${entry.key}`, Number.isInteger(entry.textLength) && `length=${entry.textLength}`].filter(Boolean).join(", ");
      return `- \`${markdownInline(entry.at)}\` **${markdownInline(entry.action)}** on \`${markdownInline(actionTargetLabel(entry))}\`${details ? ` (${markdownInline(details)})` : ""}`;
    }
    if (entry.type === "network") return `- \`${markdownInline(entry.at)}\` **HTTP ${entry.status ?? "failure"}** \`${markdownInline(entry.method ?? "GET")} ${markdownInline(entry.url ?? entry.message ?? "unknown request")}\``;
    return `- \`${markdownInline(entry.at)}\` **${markdownInline(entry.kind ?? "error")}** ${markdownInline(entry.message ?? "Unknown error")}`;
  });
  if (timeline.length > visible.length) visible.push(`- ... ${timeline.length - visible.length} more entries are available in \`report.json\`.`);
  return visible.length ? visible.join("\n") : "No reproduction actions or findings were observed.";
}

function reportClaim(options) {
  const limits = { title: 160, expected: 600, actual: 600 };
  const claim = {};
  for (const [field, limit] of Object.entries(limits)) {
    if (options[field] === undefined) continue;
    const value = safeSingleLine(String(options[field])).trim();
    if (!value) throw cliError(`--${field} must not be empty`, "USAGE_ERROR", 2);
    if (value.length > limit) throw cliError(`--${field} must be ${limit} characters or fewer`, "USAGE_ERROR", 2);
    claim[field] = value;
  }
  return Object.keys(claim).length ? claim : null;
}

function reportClaimMarkdown(claim) {
  if (!claim) return "";
  const lines = ["## Bug claim", ""];
  if (claim.title) lines.push(`**${markdownInline(claim.title)}**`, "");
  if (claim.expected) lines.push(`- Expected: ${markdownInline(claim.expected)}`);
  if (claim.actual) lines.push(`- Actual: ${markdownInline(claim.actual)}`);
  return `${lines.join("\n")}\n\n`;
}

function buildReportConnection(session, endpoint) {
  return { sessionId: session?.sessionId ?? null, endpoint, mode: session?.source ?? "override", launchedChromePid: session?.chromePid ?? null, isolatedProfile: session?.source === "launch" && !session?.warnings?.length, deterministicLaunch: session?.deterministic ?? null };
}

export function belongsToLiveBrowser(record, endpoint, instanceId, sessionId) {
  return Boolean(record
    && record.endpoint === endpoint
    && record.browserInstanceId === instanceId
    && (sessionId === undefined || record.sessionId === sessionId));
}

function ignoredEventLog(eventLog, reason) {
  return { records: [], cursor: { ...eventLog.cursor, ignored: true, ignoredReason: reason } };
}

function buildReportObservation(monitor, tab, eventCursor, monitorRunning) {
  const targetObservationStarted = monitor?.targets?.[tab.id]?.observedAt ?? null;
  const discontinuities = [...(monitor?.discontinuities ?? [])];
  if (monitor?.redactionPolicy !== "mandatory-v1") discontinuities.push({ code: "MONITOR_VERSION_CHANGED", message: "The current monitor predates mandatory-v1 metadata." });
  return { startedAt: targetObservationStarted, monitorStartedAt: monitor?.startedAt ?? null, boundary: eventCursor, monitorRunning, coverage: "best-effort", bestEffort: true, completeSinceNavigation: false, discontinuities };
}

function buildTimeline(actions, errors, network) {
  const actionEntries = actions.map((action) => ({ type: "action", at: action.startedAt ?? action.observedAt, actionId: action.actionId, source: action.source, action: action.action, target: action.target, ref: action.ref, selector: action.selector, inputMode: action.inputMode, key: action.key, textLength: action.textLength }));
  const findings = [...errors.map((event) => ({ type: "error", ...event })), ...network.map((event) => ({ type: "network", ...event }))];
  const findingEntries = findings.map((finding) => {
    const findingTime = Date.parse(finding.observedAt);
    const preceding = [...actions].reverse().find((action) => {
      const delta = findingTime - Date.parse(action.startedAt ?? action.observedAt);
      return delta >= 0 && delta <= 10_000;
    });
    return { ...finding, at: finding.observedAt, correlation: preceding ? { basis: "temporal", confidence: "low", afterActionId: preceding.actionId, deltaMs: findingTime - Date.parse(preceding.startedAt ?? preceding.observedAt), windowMs: 10_000 } : null };
  });
  return [...actionEntries, ...findingEntries].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}

function buildReportManifest({ generatedAt, completedAt, endpoint, tab, session, monitor, monitorRunning, version, claim, sections, snapshot, errors, network, actions, timeline, screenshot, eventCursor, evidenceRequirement }) {
  const observation = buildReportObservation(monitor, tab, eventCursor, monitorRunning);
  const partial = !monitorRunning || !observation.startedAt || Object.values(sections).some((section) => section.status === "partial");
  return {
    schemaVersion: 1,
    status: partial ? "partial" : "complete",
    generatedAt,
    completedAt,
    producer: { name: "bugbaton", version: VERSION, node: process.version, platform: process.platform },
    browser: { product: version.Browser ?? session?.browser ?? null, protocolVersion: version["Protocol-Version"] ?? session?.protocolVersion ?? null },
    connection: buildReportConnection(session, endpoint),
    tab: { id: tab.id, title: tab.title, url: redactUrl(tab.url) },
    claim,
    ...(evidenceRequirement ? { evidenceRequirement } : {}),
    observation,
    redaction: { policy: "mandatory-v1", appliedBeforePersistence: monitor?.redactionPolicy === "mandatory-v1", urlCredentials: true, sensitiveQueryValues: true, authorizationLikeText: true, inputValuesInReport: true, warning: "Screenshots and accessible names may still contain sensitive content; review before sharing." },
    sections,
    snapshot,
    errors,
    failedNetwork: network,
    actionOutcomes: actions,
    correlationPolicy: { name: "temporal-v1", confidence: "low", windowMs: 10_000, caveat: "Temporal proximity does not prove that an action caused a finding." },
    timeline,
    screenshot: screenshot ? path.basename(screenshot.path) : null,
    artifactIntegrity: { algorithm: "sha256", attachments: screenshot ? [{ path: path.basename(screenshot.path), bytes: screenshot.bytes, sha256: screenshot.sha256 }] : [] },
  };
}

async function commandReport(parsed, paths, endpoint, context = {}) {
  const generatedAt = new Date().toISOString();
  const claim = reportClaim(parsed.options);
  const outputDir = path.resolve(parsed.options.output ?? `bugbaton-report-${generatedAt.replaceAll(":", "-").replace(".", "-")}-${process.pid}`);
  try {
    await lstat(outputDir);
    throw codedError("OUTPUT_EXISTS", `Report output already exists: ${outputDir}`, {
      exitCode: 2,
      hint: "Choose a new --output directory.",
      details: { path: outputDir },
    });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const { tab } = await tabContext(endpoint, parsed.options.tab, { requireExplicit: true });
  const [storedSession, storedMonitor, version, eventLog] = await Promise.all([
    readJson(paths.session),
    readJson(paths.monitor),
    browserVersion(endpoint),
    readEventLog(paths),
  ]);
  const instanceId = browserInstanceId(version);
  const session = belongsToLiveBrowser(storedSession, endpoint, instanceId) ? storedSession : null;
  const monitor = session && belongsToLiveBrowser(storedMonitor, endpoint, instanceId, session.sessionId) ? storedMonitor : null;
  const evidenceLog = monitor ? eventLog : ignoredEventLog(eventLog, "MONITOR_IDENTITY_MISMATCH");
  const parentDir = path.dirname(outputDir);
  const stagingDir = path.join(parentDir, `.${path.basename(outputDir)}.staging-${process.pid}-${Date.now()}`);
  await mkdir(parentDir, { recursive: true });
  await mkdir(stagingDir, { recursive: false, mode: 0o700 });
  try {
    const storeHealth = eventStoreHealth(monitor?.eventStore, evidenceLog.cursor);
    const storeIsHealthy = storeHealth.status === "healthy";
    const sections = {
      snapshot: { status: "pending", reason: null },
      errors: { status: storeIsHealthy ? "collected" : "partial", reason: storeIsHealthy ? null : { code: "EVENT_STORE_DEGRADED", message: "The event store reported write loss, truncation, identity mismatch, or corrupt lines." }, boundaryId: evidenceLog.cursor.id },
      failedNetwork: { status: storeIsHealthy ? "collected" : "partial", reason: storeIsHealthy ? null : { code: "EVENT_STORE_DEGRADED", message: "The event store reported write loss, truncation, identity mismatch, or corrupt lines." }, boundaryId: evidenceLog.cursor.id },
      actionOutcomes: { status: "pending", reason: null },
      screenshot: { status: "pending", reason: null },
    };
    let rawSnapshot;
    try {
      rawSnapshot = await captureSnapshot(endpoint, paths, tab.id, false);
      sections.snapshot = { status: "collected", reason: null, capturedAt: rawSnapshot.capturedAt };
    } catch (error) {
      rawSnapshot = { capturedAt: null, targetId: tab.id, url: redactUrl(tab.url), title: tab.title, nodes: [] };
      sections.snapshot = { status: "partial", reason: { code: error.code ?? "COLLECTION_FAILED", message: error.message }, capturedAt: null };
    }
    const [errorResult, networkResult, cliActions, browserActionResult] = await Promise.all([
      readEvents(paths, { kinds: ["error", "warning"], tabId: tab.id, limit: 500, eventLog: evidenceLog }),
      readEvents(paths, { kinds: ["network-failed", "network-http-error"], tabId: tab.id, limit: 500, eventLog: evidenceLog }),
      monitor ? readActions(paths, tab.id, 100) : Promise.resolve([]),
      readEvents(paths, { kinds: ["user-action"], tabId: tab.id, limit: 500, eventLog: evidenceLog }),
    ]);
    const browserActions = browserActionResult.events;
    const actions = [
      ...cliActions.map((action) => ({ source: "bugbaton-cli", ...action })),
      ...browserActions,
    ].sort((left, right) => Date.parse(left.startedAt ?? left.observedAt) - Date.parse(right.startedAt ?? right.observedAt));
    sections.actionOutcomes = { status: "collected", reason: null, capturedAt: new Date().toISOString(), boundaryId: evidenceLog.cursor.id };
    const errors = errorResult.events;
    const network = networkResult.events;
    const snapshot = { ...rawSnapshot, nodes: rawSnapshot.nodes.map((node) => node.value === undefined ? node : { ...node, value: "[redacted]" }) };
    let screenshot = null;
    if (!parsed.options.no_screenshot) {
      try {
        screenshot = await captureScreenshot(endpoint, tab.id, path.join(stagingDir, "screenshot.png"), true);
        sections.screenshot = { status: "collected", reason: null, capturedAt: screenshot.capturedAt };
      } catch (error) {
        sections.screenshot = { status: "partial", reason: { code: error.code ?? "COLLECTION_FAILED", message: error.message }, capturedAt: null };
      }
    } else {
      sections.screenshot = { status: "skipped", reason: { code: "USER_SKIPPED", message: "--no-screenshot was supplied" }, capturedAt: null };
    }
    const monitorRunning = monitor ? await pidAlive(monitor.pid) : false;
    const completedAt = new Date().toISOString();
    const timeline = buildTimeline(actions, errors, network);
    const summary = { errors: errors.length, failedNetwork: network.length, actions: actions.length, snapshotNodes: snapshot.nodes.length };
    const evidenceRequirement = context.assessEvidence?.(summary) ?? null;
    const report = buildReportManifest({ generatedAt, completedAt, endpoint, tab, session, monitor, monitorRunning, version, claim, sections, snapshot, errors, network, actions, timeline, screenshot, eventCursor: evidenceLog.cursor, evidenceRequirement });
    await writeFile(path.join(stagingDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    const evidenceLine = evidenceRequirement ? `- Demo evidence requirement: **${evidenceRequirement.status}** (${evidenceRequirement.description})\n` : "";
    const markdown = `# BugBaton diagnostic report\n\n- Bundle status: **${report.status}**\n${evidenceLine}- Observation coverage: **best effort**\n- Complete since navigation: **no**\n- Generated: ${report.generatedAt}\n\n${reportClaimMarkdown(claim)}Page: **${markdownInline(tab.title || "(untitled)")}**\n\nURL: \`${markdownInline(report.tab.url)}\`\n\n- Observed errors/warnings: ${errors.length}\n- Failed/HTTP-error requests: ${network.length}\n- Recorded reproduction actions: ${actions.length}\n- Accessibility nodes: ${snapshot.nodes.length}\n- Screenshot: ${report.screenshot ?? "not captured"}\n- Evidence boundary: ${evidenceLog.cursor.id}\n- Observation monitor at report boundary: ${monitorRunning ? `running since ${monitor.startedAt}` : "not running; evidence is partial"}\n\n## Verify this bundle\n\nFrom this directory, run \`bugbaton verify .\`. This checks the compatible report header, safe attachment paths, declared file sizes and SHA-256 hashes, and capture-receipt consistency. It does not prove who created the bundle.\n\n## Reproduction timeline\n\n${reportTimelineMarkdown(timeline)}\n\n> Observation starts after \`bugbaton launch\`, \`bugbaton connect\`, or \`bugbaton capture\`, so the bundle can be structurally complete without claiming gap-free browser history. A \`capture-receipt.json\` file records verified shutdown for one-command captures. Temporal proximity does not prove causality. Screenshots and accessible names may contain sensitive page content; review before sharing.\n`;
    await writeFile(path.join(stagingDir, "README.md"), markdown, { flag: "wx", mode: 0o600 });
    await rename(stagingDir, outputDir);
    return { path: outputDir, status: report.status, boundaryId: evidenceLog.cursor.id, files: ["report.json", "README.md", ...(screenshot ? ["screenshot.png"] : [])], warning: "Screenshots and accessible names may contain sensitive page content; review before sharing.", summary, evidenceRequirement };
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

async function runConnectedCommand(command, parsed, paths, endpoint, liveVersion) {
  if (command === "tabs") {
    requirePositionals(parsed, 0, 0, COMMAND_HELP.tabs);
    return { endpoint, tabs: (await listTabs(endpoint)).map(({ id, title, url, type }) => ({ id, title, url: redactUrl(url), type })) };
  }
  if (command === "snapshot") {
    requirePositionals(parsed, 0, 0, COMMAND_HELP.snapshot);
    return captureSnapshot(endpoint, paths, parsed.options.tab, parsed.options.all);
  }
  if (command === "click") {
    requirePositionals(parsed, parsed.options.selector ? 0 : 1, parsed.options.selector ? 0 : 1, COMMAND_HELP.click);
    return interact(endpoint, paths, "click", { tabSelector: parsed.options.tab, reference: parsed.positionals[0], selector: parsed.options.selector });
  }
  if (command === "fill") {
    const referenceCount = parsed.options.selector ? 0 : 1;
    const expected = referenceCount + (parsed.options.stdin ? 0 : 1);
    requirePositionals(parsed, expected, expected, COMMAND_HELP.fill);
    const text = parsed.options.stdin ? await readStdinText() : parsed.positionals.at(-1);
    return interact(endpoint, paths, "fill", { tabSelector: parsed.options.tab, reference: parsed.options.selector ? null : parsed.positionals[0], selector: parsed.options.selector, text });
  }
  if (command === "press") {
    requirePositionals(parsed, 1, 2, COMMAND_HELP.press);
    const hasRef = parsed.positionals.length === 2;
    return interact(endpoint, paths, "press", { tabSelector: parsed.options.tab, reference: hasRef ? parsed.positionals[0] : null, key: parsed.positionals.at(-1) });
  }
  if (command === "errors") {
    requirePositionals(parsed, 0, 0, COMMAND_HELP.errors);
    return commandEvents(parsed, paths, endpoint, "errors", liveVersion);
  }
  if (command === "network") {
    requirePositionals(parsed, 0, 0, COMMAND_HELP.network);
    if (!parsed.options.failed) throw cliError("MVP network inspection requires --failed", "USAGE_ERROR", 2);
    return commandEvents(parsed, paths, endpoint, "network", liveVersion);
  }
  if (command === "screenshot") {
    requirePositionals(parsed, 0, 0, COMMAND_HELP.screenshot);
    const file = parsed.options.output ?? `bugbaton-${Date.now()}-${process.pid}.png`;
    return captureScreenshot(endpoint, parsed.options.tab, file, parsed.options.full_page);
  }
  if (command === "report") {
    requirePositionals(parsed, 0, 0, COMMAND_HELP.report);
    return commandReport(parsed, paths, endpoint);
  }
  throw cliError(`Unknown command: ${command}`, "USAGE_ERROR", 2);
}

async function executeCommand(command, parsed, paths) {
  if (command === "doctor") return doctor(parsed, paths);
  if (command === "demo") return commandDemo(parsed, paths);
  if (command === "capture") return commandCapture(parsed, paths);
  if (command === "launch") return commandLaunch(parsed, paths);
  if (command === "connect") return commandConnect(parsed, paths);
  if (command === "stop") return commandStop(parsed, paths);
  const { endpoint, stored } = await resolveSession(parsed, paths);
  const liveVersion = await browserVersion(endpoint).catch((error) => {
    throw codedError("CDP_UNAVAILABLE", `Cannot reach Chrome at ${endpoint}: ${error.message}`, { exitCode: 3, retryable: true, hint: "Run `bugbaton doctor`, then launch or connect to a reachable Chrome." });
  });
  assertSessionIdentity(stored, liveVersion, endpoint);
  return runConnectedCommand(command, parsed, paths, endpoint, liveVersion);
}

function countLabel(count, singular) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function reportVerificationError(message, details) {
  return codedError("REPORT_VERIFICATION_FAILED", message, {
    hint: "Use an unchanged BugBaton report directory, or capture the bug again.",
    details,
  });
}

async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function safeBundleFile(root, relativePath) {
  const portableName = typeof relativePath === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(relativePath);
  const windowsStem = portableName ? relativePath.split(".", 1)[0].toUpperCase() : "";
  const windowsReserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(windowsStem);
  if (!portableName || windowsReserved || relativePath.endsWith(".")) {
    throw reportVerificationError("The report contains an unsafe attachment path", { path: relativePath ?? null });
  }
  return path.join(root, relativePath);
}

async function readBundleJson(file, label) {
  try {
    const metadata = await lstat(file);
    if (!metadata.isFile()) throw new Error(`${label} is not a regular file`);
    if (metadata.size > MAX_BUNDLE_JSON_BYTES) throw new Error(`${label} exceeds the ${MAX_BUNDLE_JSON_BYTES}-byte verification limit`);
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw reportVerificationError(`${label} is missing or invalid JSON`, { path: file, cause: error.code ?? error.name });
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function reportSectionStatusesValid(sections) {
  return [
    [sections?.snapshot?.status, ["collected", "partial"]],
    [sections?.errors?.status, ["collected", "partial"]],
    [sections?.failedNetwork?.status, ["collected", "partial"]],
    [sections?.actionOutcomes?.status, ["collected", "partial"]],
    [sections?.screenshot?.status, ["collected", "partial", "skipped"]],
  ].every(([status, accepted]) => accepted.includes(status));
}

function reportStructuresValid(report) {
  const requiredObjects = [report.browser, report.connection, report.tab, report.observation, report.redaction, report.sections, report.snapshot];
  const requiredArrays = [report.snapshot?.nodes, report.errors, report.failedNetwork, report.actionOutcomes, report.timeline];
  return requiredObjects.every(isRecord) && requiredArrays.every(Array.isArray);
}

function reportEvidenceShapeValid(report) {
  return [
    typeof report.tab?.id === "string",
    typeof report.tab?.url === "string",
    isRecord(report.observation?.boundary),
    typeof report.observation?.boundary?.id === "string",
    typeof report.snapshot?.targetId === "string",
    typeof report.snapshot?.url === "string",
    report.screenshot === null || typeof report.screenshot === "string",
    report.observation?.bestEffort === true,
    report.observation?.coverage === "best-effort",
    report.redaction?.policy === "mandatory-v1",
    reportSectionStatusesValid(report.sections),
  ].every(Boolean);
}

function verifyReportHeader(report) {
  if (!isRecord(report)) {
    throw reportVerificationError("report.json must contain a report object", { type: report === null ? "null" : typeof report });
  }
  if (report.schemaVersion !== 1 || report.producer?.name !== "bugbaton" || typeof report.producer.version !== "string" || !report.producer.version) {
    throw reportVerificationError("Unsupported report schema or producer", { schemaVersion: report.schemaVersion ?? null, producer: report.producer?.name ?? null });
  }
  if (!(["complete", "partial"].includes(report.status)) || !validTimestamp(report.generatedAt) || !validTimestamp(report.completedAt) || !reportStructuresValid(report) || !reportEvidenceShapeValid(report)) {
    throw reportVerificationError("The report header is incomplete", { status: report.status ?? null, generatedAt: report.generatedAt ?? null });
  }
}

async function verifyReadme(root) {
  try {
    const readme = await lstat(path.join(root, "README.md"));
    if (!readme.isFile()) throw new Error("README.md is not a regular file");
  } catch (error) {
    throw reportVerificationError("README.md is missing or invalid", { path: path.join(root, "README.md"), cause: error.code ?? error.message });
  }
}

async function verifyAttachments(root, report) {
  if (report.artifactIntegrity?.algorithm !== "sha256" || !Array.isArray(report.artifactIntegrity.attachments)) {
    throw reportVerificationError("The report has no supported attachment-integrity manifest", { algorithm: report.artifactIntegrity?.algorithm ?? null });
  }
  if (report.artifactIntegrity.attachments.length > MAX_BUNDLE_ATTACHMENTS) {
    throw reportVerificationError("The attachment manifest exceeds the verification limit", { attachments: report.artifactIntegrity.attachments.length, limit: MAX_BUNDLE_ATTACHMENTS });
  }
  const attachments = [];
  const seen = new Set();
  for (const attachment of report.artifactIntegrity.attachments) {
    if (!attachment || typeof attachment !== "object" || !Number.isSafeInteger(attachment.bytes) || attachment.bytes < 0 || !/^[a-f0-9]{64}$/u.test(attachment.sha256 ?? "")) {
      throw reportVerificationError("The attachment manifest contains invalid metadata", { path: attachment?.path ?? null });
    }
    const file = safeBundleFile(root, attachment.path);
    if (seen.has(attachment.path)) throw reportVerificationError("The attachment manifest contains a duplicate path", { path: attachment.path });
    seen.add(attachment.path);
    let metadata;
    try { metadata = await lstat(file); } catch (error) {
      throw reportVerificationError("A declared attachment is missing", { path: attachment.path, cause: error.code ?? error.message });
    }
    if (!metadata.isFile() || metadata.size !== attachment.bytes) {
      throw reportVerificationError("A declared attachment has the wrong size or type", { path: attachment.path, expectedBytes: attachment.bytes, actualBytes: metadata.size });
    }
    let sha256;
    try {
      sha256 = await sha256File(file);
    } catch (error) {
      throw reportVerificationError("A declared attachment could not be read", { path: attachment.path, cause: error.code ?? error.message });
    }
    if (sha256 !== attachment.sha256) {
      throw reportVerificationError("A declared attachment failed SHA-256 verification", { path: attachment.path, expectedSha256: attachment.sha256, actualSha256: sha256 });
    }
    attachments.push({ path: attachment.path, bytes: metadata.size, sha256, verified: true });
  }
  if (report.screenshot && !seen.has(report.screenshot)) {
    throw reportVerificationError("The screenshot is not covered by the attachment-integrity manifest", { path: report.screenshot });
  }
  return attachments;
}

function receiptShapeValid(value) {
  const shutdown = value?.sessionShutdown;
  return [
    isRecord(value),
    value?.schemaVersion === 1,
    validTimestamp(value?.completedAt),
    typeof value?.endedBy === "string",
    typeof value?.evidenceRetained === "boolean",
    isRecord(shutdown),
    typeof shutdown?.complete === "boolean",
    typeof shutdown?.monitorStopped === "boolean",
    typeof shutdown?.browserOwned === "boolean",
    typeof shutdown?.browserClosed === "boolean" || shutdown?.browserClosed === null,
  ].every(Boolean);
}

function expectedShutdownComplete(shutdown) {
  return shutdown.monitorStopped && (!shutdown.browserOwned || shutdown.browserClosed === true);
}

async function verifyReceipt(root, report) {
  const receiptPath = path.join(root, "capture-receipt.json");
  try {
    const metadata = await lstat(receiptPath);
    if (!metadata.isFile()) throw reportVerificationError("capture-receipt.json is not a regular file", { path: receiptPath });
    const value = await readBundleJson(receiptPath, "capture-receipt.json");
    const shutdown = value?.sessionShutdown;
    const shapeValid = receiptShapeValid(value);
    const expectedComplete = shapeValid ? expectedShutdownComplete(shutdown) : null;
    const evidenceMatches = isDeepStrictEqual(value?.evidenceRequirement ?? null, report.evidenceRequirement ?? null);
    if (!shapeValid || value.bundleStatus !== report.status || shutdown.complete !== expectedComplete || !evidenceMatches) {
      throw reportVerificationError("capture-receipt.json is inconsistent with the report", { receiptSchemaVersion: value?.schemaVersion ?? null, receiptBundleStatus: value?.bundleStatus ?? null, reportStatus: report.status ?? null });
    }
    return { present: true, consistent: true, shutdownComplete: value.sessionShutdown.complete, evidenceRetained: value.evidenceRetained === true };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { present: false, consistent: null, shutdownComplete: null, evidenceRetained: null };
  }
}

async function commandVerify(parsed) {
  requirePositionals(parsed, 1, 1, COMMAND_HELP.verify);
  const root = path.resolve(parsed.positionals[0]);
  const report = await readBundleJson(path.join(root, "report.json"), "report.json");
  verifyReportHeader(report);
  await verifyReadme(root);
  const attachments = await verifyAttachments(root, report);
  const receipt = await verifyReceipt(root, report);
  return {
    status: "verified",
    path: root,
    report: { schemaVersion: report.schemaVersion, bundleStatus: report.status, producer: report.producer, generatedAt: report.generatedAt },
    attachments,
    receipt,
    evidenceRequirement: report.evidenceRequirement ?? null,
    assurance: "Structure and declared attachment integrity verified; authenticity is not established.",
  };
}

const FORMATTERS = {
  doctor: (value) => `${value.status === "ready" ? "✓" : "!"} ${value.status}\nChrome: ${value.chrome.path ?? "not found"}\nEndpoint: ${value.endpoint.reachable ? value.endpoint.browser : value.endpoint.error}\nMonitor: ${value.monitor.running ? `running (pid ${value.monitor.pid})` : "not running"}\nNext: ${value.nextAction}`,
  demo: (value) => `Demo complete\nWrote report to ${value.report.path}\n${countLabel(value.report.summary.errors, "error")}, ${countLabel(value.report.summary.failedNetwork, "failed request")}, ${countLabel(value.report.summary.actions, "reproduction action")}\nChrome session stopped: ${value.stopped.stopped ? "yes" : "incomplete"}`,
  capture: (value) => `Wrote report to ${value.report.path}\n${countLabel(value.report.summary.errors, "error")}, ${countLabel(value.report.summary.failedNetwork, "failed request")}, ${countLabel(value.report.summary.actions, "reproduction action")}\nChrome session stopped: ${value.stopped.stopped ? "yes" : "incomplete"}`,
  launch: (value) => `Chrome launched (pid ${value.chromePid})\n${value.endpoint}\nMonitor: pid ${value.monitor.pid}`,
  connect: (value) => `Connected to ${value.browser}\n${value.endpoint}\nMonitor: pid ${value.monitor.pid}`,
  stop: (value) => value.activeSession ? `Observation stopped\nOwned Chrome closed: ${value.browser.owned ? value.browser.closed ? "yes" : "no" : "not applicable"}\nEvidence retained in ${value.stateDir}` : "No active BugBaton session.",
  tabs: (value) => formatRows(value.tabs, [{ label: "ID", value: (row) => row.id.slice(0, 10) }, { label: "TITLE", value: (row) => row.title }, { label: "URL", value: (row) => row.url }]),
  snapshot: snapshotHuman,
  click: (value) => `Clicked ${value.ref ?? value.selector}`,
  fill: (value) => `Filled ${value.ref ?? value.selector} (${value.textLength} characters)`,
  press: (value) => `Pressed ${value.key}${value.ref ? ` on ${value.ref}` : ""}`,
  errors: (value) => value.events.length ? value.events.map((event) => `${event.observedAt} ${event.kind.toUpperCase()} ${safeSingleLine(event.message)}`).join("\n") : `No observed errors for ${safeSingleLine(value.url)}.`,
  network: (value) => value.events.length ? value.events.map((event) => `${event.status ?? "FAIL"} ${safeSingleLine(event.url ?? event.message)}`).join("\n") : `No observed failed requests for ${safeSingleLine(value.url)}.`,
  screenshot: (value) => `Wrote ${value.path} (${value.bytes} bytes)`,
  report: (value) => `Wrote report to ${value.path}\n${countLabel(value.summary.errors, "error")}, ${countLabel(value.summary.failedNetwork, "failed request")}, ${countLabel(value.summary.snapshotNodes, "snapshot node")}`,
  verify: (value) => `Verified BugBaton report at ${value.path}\n${countLabel(value.attachments.length, "attachment")} verified\nCapture shutdown: ${value.receipt.present ? value.receipt.shutdownComplete ? "complete" : "incomplete" : "not recorded"}\nAssurance: ${value.assurance}`,
};

export async function main(argv) {
  let parsed;
  try { parsed = parseArgs(argv); } catch (error) {
    const json = argv.includes("--json");
    if (json) process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: false, command: commandHint(argv), data: null, error: errorPayload(error, "USAGE_ERROR") })}\n`);
    else process.stderr.write(`bugbaton: ${safeSingleLine(error.message)}\nTry 'bugbaton --help'.\n`);
    process.exitCode = error.exitCode ?? 2;
    return;
  }
  const paths = sessionPaths(stateRoot(parsed.options.state_dir));
  if (parsed.topVersion) {
    output("version", { version: VERSION }, parsed.json, (data) => data.version);
    return;
  }
  if (parsed.help) {
    process.stdout.write(`${parsed.command ? COMMAND_HELP[parsed.command] : HELP}\n`);
    return;
  }
  if (parsed.command === "version") {
    output("version", { version: VERSION }, parsed.json, (data) => data.version);
    return;
  }
  const command = parsed.command;
  try {
    const data = command === "verify" ? await commandVerify(parsed) : await executeCommand(command, parsed, paths);
    if (!parsed.json) {
      for (const warning of [...(data.warnings ?? []), ...(data.warning ? [data.warning] : [])]) process.stderr.write(`warning: ${warning}\n`);
    }
    output(command, data, parsed.json, FORMATTERS[command]);
  } catch (error) {
    if (parsed.json) process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: false, command, data: null, error: errorPayload(error) })}\n`);
    else process.stderr.write(`bugbaton: ${safeSingleLine(error.message)}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
