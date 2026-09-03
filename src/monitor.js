#!/usr/bin/env node

import { createHash } from "node:crypto";
import { appendFile, chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { CdpConnection } from "./cdp.js";
import { browserInstanceId, browserVersion, listTabs } from "./chrome.js";
import { readJson, sessionPaths, writeJson } from "./state.js";
import { redactEvent, redactUrl } from "./redact.js";
import { eventStoreHealth } from "./event-health.js";
import { boundEventStrings } from "./event-bounds.js";

const rootIndex = process.argv.indexOf("--state-dir");
if (rootIndex < 0 || !process.argv[rootIndex + 1]) throw new Error("monitor requires --state-dir");
const paths = sessionPaths(process.argv[rootIndex + 1]);
const session = JSON.parse(await readFile(paths.session, "utf8"));
const previousMonitor = await readJson(paths.monitor);
const connections = new Map();
const targets = {};
let stopping = false;
let eventWriteQueue = Promise.resolve();
let stateWriteQueue = Promise.resolve();
const configuredMaxBytes = Number(process.env.BUGBATON_EVENT_MAX_BYTES ?? 5 * 1024 * 1024);
const maxEventBytes = Number.isFinite(configuredMaxBytes) && configuredMaxBytes >= 64 * 1024 ? configuredMaxBytes : 5 * 1024 * 1024;
const ACTION_BINDING = "__bugbatonRecordAction";
const ACTION_SCRIPT = `(() => {
  if (globalThis.__bugbatonRecorderInstalled) return;
  globalThis.__bugbatonRecorderInstalled = true;
  const targetFacts = (target) => {
    const element = target?.closest?.("button,a,input,textarea,select,[role]") ?? target;
    const interactive = [...document.querySelectorAll("button,a,input,textarea,select,[role]")];
    const index = interactive.indexOf(element);
    return {
      tag: element?.tagName?.toLowerCase?.() ?? null,
      role: element?.getAttribute?.("role") ?? null,
      type: element?.getAttribute?.("type") ?? null,
      ordinal: index >= 0 ? index + 1 : null
    };
  };
  const send = (action, target, details = {}) => {
    if (Date.now() < (globalThis.__bugbatonSuppressActionUntil ?? 0)) return;
    const binding = globalThis.${ACTION_BINDING};
    if (typeof binding !== "function") return;
    binding(JSON.stringify({ action, target: targetFacts(target), ...details }));
  };
  let inputTimer;
  document.addEventListener("click", (event) => send("click", event.target), true);
  document.addEventListener("input", (event) => {
    clearTimeout(inputTimer);
    const target = event.target;
    const textLength = typeof target?.value === "string" ? target.value.length : null;
    inputTimer = setTimeout(() => send("input", target, { textLength }), 250);
  }, true);
  document.addEventListener("submit", (event) => send("submit", event.target), true);
  document.addEventListener("keydown", (event) => {
    if (["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      send("key", event.target, { key: event.key });
    }
  }, true);
})()`;

await mkdir(paths.root, { recursive: true, mode: 0o700 });
const continuingSession = previousMonitor?.sessionId === session.sessionId;
if (!continuingSession) {
  await writeFile(paths.events, "", { mode: 0o600 });
  await writeFile(paths.actions, "", { mode: 0o600 });
  await writeJson(paths.cursors, {});
}
for (const privateFile of [paths.events, paths.actions]) {
  try { await chmod(privateFile, 0o600); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
const previousEventStore = continuingSession ? previousMonitor?.eventStore : null;
const monitorState = {
  pid: process.pid,
  startedAt: new Date().toISOString(),
  readyAt: null,
  endpoint: session.endpoint,
  sessionId: session.sessionId,
  browserInstanceId: session.browserInstanceId ?? null,
  redactionPolicy: "mandatory-v1",
  targets,
  activeTargetIds: [],
  eventStore: previousEventStore ? { ...previousEventStore, status: "degraded", maxBytes: maxEventBytes, unknownGapCount: (previousEventStore.unknownGapCount ?? 0) + 1 } : { status: "healthy", maxBytes: maxEventBytes, recordsWritten: 0, droppedEvents: 0, truncatedEvents: 0, rotations: 0, writeFailures: 0, unknownGapCount: 0, lastSuccessfulAppendAt: null, lastError: null },
  discontinuities: continuingSession ? [...(previousMonitor.discontinuities ?? []), { code: "MONITOR_RESTART", detectedAt: new Date().toISOString(), message: "The monitor restarted within the same session; events during the gap are unknown." }] : [],
};
await writeJson(paths.monitor, monitorState);

function persistMonitorState() {
  stateWriteQueue = stateWriteQueue.catch(() => {}).then(() => writeJson(paths.monitor, monitorState));
  return stateWriteQueue;
}

async function trimEventStore(incomingBytes) {
  let currentSize = 0;
  try { currentSize = (await stat(paths.events)).size; } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (currentSize + incomingBytes <= maxEventBytes) return;
  const text = await readFile(paths.events, "utf8");
  const lines = text.split("\n").filter(Boolean);
  const kept = [];
  let keptBytes = incomingBytes;
  const targetBytes = Math.floor(maxEventBytes / 2);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const lineBytes = Buffer.byteLength(lines[index]) + 1;
    if (keptBytes + lineBytes > targetBytes) break;
    kept.push(lines[index]);
    keptBytes += lineBytes;
  }
  kept.reverse();
  const dropped = lines.length - kept.length;
  const temporary = `${paths.events}.${process.pid}.trim`;
  await writeFile(temporary, kept.length ? `${kept.join("\n")}\n` : "", { mode: 0o600 });
  await rename(temporary, paths.events);
  monitorState.eventStore.droppedEvents += dropped;
  monitorState.eventStore.rotations += 1;
  monitorState.eventStore.status = "degraded";
}

function record(event) {
  const redacted = redactEvent({ ...event, observedAt: new Date().toISOString() });
  const bounded = boundEventStrings(redacted, Math.min(16 * 1024, Math.floor(maxEventBytes / 4)));
  const safe = bounded.event;
  const line = `${JSON.stringify(safe)}\n`;
  eventWriteQueue = eventWriteQueue.then(async () => {
    try {
      await trimEventStore(Buffer.byteLength(line));
      await appendFile(paths.events, line, { mode: 0o600 });
      monitorState.eventStore.recordsWritten += 1;
      if (bounded.truncated) {
        monitorState.eventStore.truncatedEvents = (monitorState.eventStore.truncatedEvents ?? 0) + 1;
        monitorState.eventStore.status = "degraded";
      }
      monitorState.eventStore.lastSuccessfulAppendAt = new Date().toISOString();
      monitorState.eventStore.status = eventStoreHealth(monitorState.eventStore).status;
    } catch (error) {
      monitorState.eventStore.status = "failed";
      monitorState.eventStore.writeFailures += 1;
      monitorState.eventStore.droppedEvents += 1;
      monitorState.eventStore.lastError = { code: error.code ?? "EVENT_STORE_WRITE_FAILED", message: redactEvent({ message: error.message }).message };
    }
    try { await persistMonitorState(); } catch {}
  });
  return eventWriteQueue;
}

function remoteValue(argument) {
  if (argument.unserializableValue) return argument.unserializableValue;
  if (argument.value !== undefined) return argument.value;
  return argument.description ?? `[${argument.type}]`;
}

function initiatorFacts(initiator) {
  const frame = initiator?.stack?.callFrames?.[0];
  return { initiatorType: initiator?.type ?? null, initiatorUrl: frame?.url ? redactUrl(frame.url) : null, initiatorLine: frame?.lineNumber ?? null };
}

function recordBrowserAction(tab, rawPayload) {
  if (typeof rawPayload !== "string" || rawPayload.length > 4_096) return;
  try {
    const payload = JSON.parse(rawPayload);
    if (!["click", "input", "key", "submit"].includes(payload.action)) return;
    const target = Object.fromEntries(["tag", "role", "type"].map((key) => [key, typeof payload.target?.[key] === "string" ? payload.target[key].slice(0, 80) : null]));
    if (Number.isInteger(payload.target?.ordinal) && payload.target.ordinal > 0) target.ordinal = payload.target.ordinal;
    const details = {};
    if (Number.isInteger(payload.textLength) && payload.textLength >= 0) details.textLength = payload.textLength;
    if (typeof payload.key === "string" && payload.key.length <= 20) details.key = payload.key;
    const observedAt = new Date().toISOString();
    const actionId = createHash("sha256").update(`${session.sessionId}:${tab.id}:${observedAt}:${rawPayload}`).digest("hex").slice(0, 16);
    return record({ kind: "user-action", source: "browser", targetId: tab.id, url: tab.url, actionId, action: payload.action, target, ...details });
  } catch {}
}

async function enableBrowserActionCapture(cdp, tab) {
  cdp.on("Runtime.bindingCalled", ({ name, payload }) => {
    if (name === ACTION_BINDING) return recordBrowserAction(tab, payload);
  });
  await cdp.send("Runtime.addBinding", { name: ACTION_BINDING });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: ACTION_SCRIPT });
  await cdp.send("Runtime.evaluate", { expression: ACTION_SCRIPT });
}

async function observe(tab) {
  if (connections.has(tab.id) || !tab.webSocketDebuggerUrl) return;
  try {
    const cdp = await new CdpConnection(tab.webSocketDebuggerUrl).open();
    const requests = new Map();
    connections.set(tab.id, cdp);
    cdp.on("Runtime.exceptionThrown", ({ timestamp, exceptionDetails }) => record({
      kind: "error",
      source: "runtime",
      targetId: tab.id,
      url: exceptionDetails?.url || tab.url,
      cdpMonotonicSeconds: timestamp,
      message: exceptionDetails?.exception?.description || exceptionDetails?.text || "Uncaught exception",
      line: exceptionDetails?.lineNumber,
      column: exceptionDetails?.columnNumber,
    }));
    cdp.on("Runtime.consoleAPICalled", ({ type, args, timestamp, stackTrace }) => {
      if (!["error", "assert", "warning"].includes(type)) return;
      return record({ kind: type === "warning" ? "warning" : "error", source: "console", targetId: tab.id, url: stackTrace?.callFrames?.[0]?.url || tab.url, cdpMonotonicSeconds: timestamp, message: args.map(remoteValue).join(" ") });
    });
    cdp.on("Log.entryAdded", ({ entry }) => {
      if (!["error", "warning"].includes(entry.level)) return;
      return record({ kind: entry.level, source: entry.source, targetId: tab.id, url: entry.url || tab.url, sourceTimestamp: entry.timestamp ? new Date(entry.timestamp).toISOString() : null, message: entry.text });
    });
    cdp.on("Network.loadingFailed", (event) => {
      const request = requests.get(event.requestId);
      requests.delete(event.requestId);
      return record({
        kind: "network-failed",
        targetId: tab.id,
        requestId: event.requestId,
        cdpMonotonicSeconds: event.timestamp,
        url: request?.url,
        method: request?.method,
        durationMs: request ? Math.round(Math.max(0, (event.timestamp - request.startedAt) * 1_000)) : null,
        initiatorType: request?.initiatorType ?? null,
        initiatorUrl: request?.initiatorUrl ?? null,
        initiatorLine: request?.initiatorLine ?? null,
        message: event.errorText,
        canceled: Boolean(event.canceled),
        blockedReason: event.blockedReason,
        resourceType: event.type,
      });
    });
    cdp.on("Network.responseReceived", ({ requestId, response, timestamp, type }) => {
      if (response.status < 400) return;
      const request = requests.get(requestId);
      return record({ kind: "network-http-error", targetId: tab.id, requestId, cdpMonotonicSeconds: timestamp, url: response.url, method: request?.method, durationToHeadersMs: request ? Math.round(Math.max(0, (timestamp - request.startedAt) * 1_000)) : null, initiatorType: request?.initiatorType ?? null, initiatorUrl: request?.initiatorUrl ?? null, initiatorLine: request?.initiatorLine ?? null, status: response.status, statusText: response.statusText, resourceType: type });
    });
    cdp.on("Network.requestWillBeSent", ({ requestId, request, timestamp, type, initiator }) => {
      requests.set(requestId, { url: request.url, method: request.method, startedAt: timestamp, ...initiatorFacts(initiator) });
      return record({ kind: "network-request", targetId: tab.id, requestId, cdpMonotonicSeconds: timestamp, url: request.url, method: request.method, resourceType: type });
    });
    cdp.on("Network.loadingFinished", ({ requestId }) => requests.delete(requestId));
    for (const domain of ["Runtime", "Log", "Network"]) await cdp.send(`${domain}.enable`);
    if (session.captureActions) {
      await cdp.send("Page.enable");
      await enableBrowserActionCapture(cdp, tab);
    }
    targets[tab.id] ??= { observedAt: new Date().toISOString(), url: redactEvent({ url: tab.url }).url };
    cdp.socket.addEventListener("close", () => connections.delete(tab.id), { once: true });
    await record({ kind: "target-observed", targetId: tab.id, url: tab.url });
  } catch (error) {
    await record({ kind: "monitor-error", targetId: tab.id, message: error.message });
  }
}

async function poll() {
  try {
    let latestSession;
    try {
      latestSession = JSON.parse(await readFile(paths.session, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") process.exit(0);
      throw error;
    }
    if (latestSession.sessionId !== session.sessionId || latestSession.endpoint !== session.endpoint || latestSession.browserInstanceId !== session.browserInstanceId) process.exit(0);
    const liveVersion = await browserVersion(session.endpoint);
    if (session.browserInstanceId && browserInstanceId(liveVersion) !== session.browserInstanceId) {
      await record({ kind: "monitor-discontinuity", code: "BROWSER_INSTANCE_CHANGED", message: "The browser process at the endpoint changed; run bugbaton connect again." });
      process.exit(0);
    }
    const tabs = await listTabs(session.endpoint);
    monitorState.activeTargetIds = tabs.map((tab) => tab.id);
    const ids = new Set(tabs.map((tab) => tab.id));
    for (const [id, cdp] of connections) {
      if (!ids.has(id)) {
        cdp.close();
        connections.delete(id);
      }
    }
    await Promise.all(tabs.map(observe));
    monitorState.readyAt ??= new Date().toISOString();
    await persistMonitorState();
  } catch (error) {
    await record({ kind: "monitor-error", message: error.message });
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    for (const cdp of connections.values()) cdp.close();
    process.exit(0);
  });
}

while (!stopping) {
  await poll();
  await new Promise((resolve) => setTimeout(resolve, 750));
}
