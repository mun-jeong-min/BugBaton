#!/usr/bin/env node

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
const configuredMaxBytes = Number(process.env.CHROMA_EVENT_MAX_BYTES ?? 5 * 1024 * 1024);
const maxEventBytes = Number.isFinite(configuredMaxBytes) && configuredMaxBytes >= 64 * 1024 ? configuredMaxBytes : 5 * 1024 * 1024;

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
      return record({ kind: entry.level, source: entry.source, targetId: tab.id, url: entry.url || tab.url, sourceTimestamp: entry.timestamp ? new Date(entry.timestamp * 1_000).toISOString() : null, message: entry.text });
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
    targets[tab.id] ??= { observedAt: new Date().toISOString(), url: redactEvent({ url: tab.url }).url };
    cdp.socket.addEventListener("close", () => connections.delete(tab.id), { once: true });
    await record({ kind: "target-observed", targetId: tab.id, url: tab.url });
  } catch (error) {
    await record({ kind: "monitor-error", targetId: tab.id, message: error.message });
  }
}

async function poll() {
  try {
    const latestSession = JSON.parse(await readFile(paths.session, "utf8"));
    if (latestSession.sessionId !== session.sessionId || latestSession.endpoint !== session.endpoint || latestSession.browserInstanceId !== session.browserInstanceId) process.exit(0);
    const liveVersion = await browserVersion(session.endpoint);
    if (session.browserInstanceId && browserInstanceId(liveVersion) !== session.browserInstanceId) {
      await record({ kind: "monitor-discontinuity", code: "BROWSER_INSTANCE_CHANGED", message: "The browser process at the endpoint changed; run chroma connect again." });
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
