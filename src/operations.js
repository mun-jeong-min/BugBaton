import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { withCdp } from "./cdp.js";
import { browserInstanceId, browserVersion, listTabs, selectTab } from "./chrome.js";
import { readJson, snapshotFile, writeJson } from "./state.js";
import { redactEvent, redactUrl } from "./redact.js";
import { codedError } from "./errors.js";

export async function tabContext(endpoint, selector, { requireExplicit = false } = {}) {
  const tabs = await listTabs(endpoint);
  if (requireExplicit && !selector && tabs.length > 1) {
    throw codedError("TAB_REQUIRED", "Multiple page tabs are open", { exitCode: 2, hint: "Pass --tab with an exact target ID before capturing page content." });
  }
  const tab = selectTab(tabs, selector);
  return { tab, tabs };
}

function axValue(value) {
  return value?.value === undefined ? undefined : String(value.value);
}

export async function captureSnapshot(endpoint, paths, tabSelector, includeAll = false) {
  const identityBefore = browserInstanceId(await browserVersion(endpoint));
  const { tab } = await tabContext(endpoint, tabSelector, { requireExplicit: true });
  const result = await withCdp(tab.webSocketDebuggerUrl, async (cdp) => {
    await cdp.send("Accessibility.enable");
    const [tree, frameTree] = await Promise.all([cdp.send("Accessibility.getFullAXTree"), cdp.send("Page.getFrameTree")]);
    return { ...tree, loaderId: frameTree.frameTree?.frame?.loaderId ?? null };
  });
  let refIndex = 0;
  const nodes = result.nodes
    .filter((node) => !node.ignored && node.role?.value !== "none")
    .map((node) => {
      const role = axValue(node.role) ?? "unknown";
      const name = axValue(node.name) ?? "";
      const interactive = Boolean(node.backendDOMNodeId) && ["button", "checkbox", "combobox", "link", "menuitem", "radio", "searchbox", "slider", "spinbutton", "switch", "tab", "textbox"].includes(role);
      const reference = interactive ? `@e${++refIndex}` : null;
      const rawValue = axValue(node.value);
      const value = ["textbox", "searchbox", "combobox"].includes(role) && rawValue ? "[redacted]" : rawValue;
      return { ref: reference, role, name, value, description: axValue(node.description), backendDOMNodeId: node.backendDOMNodeId ?? null };
    })
    .filter((node) => includeAll || node.ref || ["heading", "main", "navigation", "alert", "status"].includes(node.role));
  const snapshot = { capturedAt: new Date().toISOString(), targetId: tab.id, url: redactUrl(tab.url), urlFingerprint: createHash("sha256").update(tab.url).digest("hex"), loaderId: result.loaderId, title: tab.title, nodes };
  const identityAfter = browserInstanceId(await browserVersion(endpoint));
  if (!identityBefore || identityBefore !== identityAfter) {
    throw codedError("BROWSER_CHANGED_DURING_SNAPSHOT", "Chrome changed while the snapshot was being captured", { retryable: true, hint: "Reconnect to Chrome and run `bugbaton snapshot` again." });
  }
  const binding = {
    capturedAt: snapshot.capturedAt,
    targetId: snapshot.targetId,
    endpoint,
    browserInstanceId: identityBefore,
    url: snapshot.url,
    urlFingerprint: snapshot.urlFingerprint,
    loaderId: snapshot.loaderId,
    nodes: snapshot.nodes.filter((node) => node.ref).map(({ ref, backendDOMNodeId }) => ({ ref, backendDOMNodeId })),
  };
  await writeJson(snapshotFile(paths, tab.id), binding);
  const publicSnapshot = { ...snapshot };
  delete publicSnapshot.urlFingerprint;
  return publicSnapshot;
}

async function resolveElement(cdp, paths, tab, reference, selector) {
  if (selector) {
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
    const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector });
    if (!nodeIds.length) throw codedError("ELEMENT_NOT_FOUND", `No element matches selector ${JSON.stringify(selector)}`, { hint: "Run `bugbaton snapshot` or correct --selector." });
    if (nodeIds.length > 1) throw codedError("ELEMENT_AMBIGUOUS", `Selector ${JSON.stringify(selector)} matches ${nodeIds.length} elements`, { exitCode: 2, hint: "Use a selector that matches exactly one element.", details: { matches: nodeIds.length } });
    return cdp.send("DOM.resolveNode", { nodeId: nodeIds[0] });
  }
  if (!reference?.startsWith("@e")) throw codedError("INVALID_ELEMENT_REF", "Expected a snapshot reference such as @e1, or pass --selector", { exitCode: 2, hint: "Run `bugbaton snapshot` to obtain current refs." });
  const snapshot = await readJson(snapshotFile(paths, tab.id));
  if (!snapshot) throw codedError("SNAPSHOT_REQUIRED", "No snapshot exists for this tab", { hint: "Run `bugbaton snapshot` first." });
  const liveIdentity = { endpoint: snapshot.endpoint, browserInstanceId: browserInstanceId(await browserVersion(snapshot.endpoint)) };
  if (!snapshotIdentityMatches(snapshot, liveIdentity, cdp.url)) throw codedError("STALE_SNAPSHOT", "Snapshot reference belongs to a different Chrome session", { hint: "Run `bugbaton snapshot` again." });
  const currentFingerprint = createHash("sha256").update(tab.url).digest("hex");
  if (snapshot.targetId !== tab.id || snapshot.urlFingerprint !== currentFingerprint) throw codedError("STALE_SNAPSHOT", "Snapshot reference is stale because the selected tab navigated", { hint: "Run `bugbaton snapshot` again." });
  const { frameTree } = await cdp.send("Page.getFrameTree");
  if (snapshot.loaderId && snapshot.loaderId !== frameTree.frame?.loaderId) throw codedError("STALE_SNAPSHOT", "Snapshot reference is stale because the selected document reloaded", { hint: "Run `bugbaton snapshot` again." });
  const node = snapshot.nodes.find((entry) => entry.ref === reference);
  if (!node?.backendDOMNodeId) throw codedError("ELEMENT_REF_NOT_FOUND", `Unknown snapshot reference ${reference}`, { hint: "Run `bugbaton snapshot` again." });
  return cdp.send("DOM.resolveNode", { backendNodeId: node.backendDOMNodeId });
}

export function snapshotIdentityMatches(snapshot, session, cdpUrl) {
  const currentEndpoint = session?.endpoint;
  if (!snapshot?.endpoint || !currentEndpoint || !cdpUrl) return false;
  let cdpEndpoint;
  try {
    const url = new URL(cdpUrl);
    if (!["ws:", "wss:"].includes(url.protocol)) return false;
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = "";
    url.search = "";
    url.hash = "";
    cdpEndpoint = url.origin;
  } catch {
    return false;
  }
  if (snapshot.endpoint !== currentEndpoint || currentEndpoint !== cdpEndpoint) return false;
  if (!snapshot.browserInstanceId || !session.browserInstanceId) return false;
  return snapshot.browserInstanceId === session.browserInstanceId;
}

export async function interact(endpoint, paths, action, { tabSelector, reference, selector, text, key }) {
  const { tab, tabs } = await tabContext(endpoint, tabSelector);
  if (!tabSelector && tabs.length > 1) throw codedError("TAB_REQUIRED", "Multiple page tabs are open", { exitCode: 2, hint: "Pass --tab with an exact target ID before mutating the page." });
  const startedAt = new Date().toISOString();
  const result = await withCdp(tab.webSocketDebuggerUrl, async (cdp) => {
    await Promise.all([cdp.send("DOM.enable"), cdp.send("Runtime.enable")]);
    if (action === "press" && !reference && !selector) {
      await suppressBrowserActionCapture(cdp);
      await dispatchKey(cdp, key);
      return { action, targetId: tab.id, url: redactUrl(tab.url), key };
    }
    const { object } = await resolveElement(cdp, paths, tab, reference, selector);
    if (!object?.objectId) throw codedError("ELEMENT_DETACHED", "The target element is not available in the current document", { retryable: true, hint: "Run `bugbaton snapshot` and retry with a new ref." });
    let inputMode;
    if (action === "click") {
      const invocation = await cdp.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: "function(){ this.scrollIntoView({block:'center', inline:'center'}); }", awaitPromise: true });
      assertRuntimeInvocation(invocation, "ELEMENT_CLICK_FAILED", "The selected element could not be clicked");
      let box;
      try {
        box = await cdp.send("DOM.getBoxModel", { objectId: object.objectId });
      } catch {
        throw codedError("ELEMENT_NOT_INTERACTABLE", "The selected element has no clickable layout box", { hint: "Choose a visible element from a fresh `bugbaton snapshot`." });
      }
      const quad = box.model?.border;
      if (!Array.isArray(quad) || quad.length !== 8) throw codedError("ELEMENT_NOT_INTERACTABLE", "The selected element has no valid clickable bounds", { hint: "Choose a visible element from a fresh `bugbaton snapshot`." });
      const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
      const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
      const hitTest = await cdp.send("Runtime.callFunctionOn", {
        objectId: object.objectId,
        functionDeclaration: "function(x,y){ if ('disabled' in this && this.disabled) return 'disabled'; const hit = document.elementFromPoint(x,y); return hit && (hit === this || this.contains(hit)) ? 'ok' : 'obscured'; }",
        arguments: [{ value: x }, { value: y }],
        returnByValue: true,
      });
      assertRuntimeInvocation(hitTest, "ELEMENT_NOT_INTERACTABLE", "The selected element could not be hit-tested");
      if (hitTest.result?.value === "disabled") throw codedError("ELEMENT_DISABLED", "The selected element is disabled", { hint: "Choose an enabled element or fix the page state before retrying." });
      if (hitTest.result?.value !== "ok") throw codedError("ELEMENT_OBSCURED", "Another element covers the selected click point", { retryable: true, hint: "Dismiss the overlay, scroll the page, or choose a different visible element." });
      await suppressBrowserActionCapture(cdp);
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
      inputMode = "cdp-mouse";
    } else if (action === "fill") {
      await suppressBrowserActionCapture(cdp);
      const invocation = await cdp.send("Runtime.callFunctionOn", {
        objectId: object.objectId,
        functionDeclaration: "function(value){ const proto = this instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set; if (!setter) throw new Error('Element is not fillable'); this.focus(); setter.call(this, value); this.dispatchEvent(new Event('input', {bubbles:true})); this.dispatchEvent(new Event('change', {bubbles:true})); }",
        arguments: [{ value: text }],
        awaitPromise: true,
      });
      assertRuntimeInvocation(invocation, "ELEMENT_NOT_FILLABLE", "The selected element does not support input/textarea value semantics");
    } else if (action === "press") {
      const invocation = await cdp.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: "function(){ this.focus(); }" });
      assertRuntimeInvocation(invocation, "ELEMENT_FOCUS_FAILED", "The selected element could not be focused");
      await suppressBrowserActionCapture(cdp);
      await dispatchKey(cdp, key);
    }
    return { action, targetId: tab.id, url: redactUrl(tab.url), ref: reference ?? null, selector: selector ?? null, ...(inputMode ? { inputMode } : {}), ...(text === undefined ? {} : { textLength: text.length }), ...(key ? { key } : {}) };
  });
  const observedAt = new Date().toISOString();
  const actionId = createHash("sha256").update(`${process.pid}:${tab.id}:${action}:${startedAt}`).digest("hex").slice(0, 16);
  const outcome = { ...result, actionId, startedAt };
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  await appendFile(paths.actions, `${JSON.stringify({ ...outcome, observedAt })}\n`, { mode: 0o600 });
  return outcome;
}

function suppressBrowserActionCapture(cdp) {
  return cdp.send("Runtime.evaluate", { expression: "globalThis.__bugbatonSuppressActionUntil = Date.now() + 500" });
}

function assertRuntimeInvocation(invocation, code, message) {
  if (!invocation?.exceptionDetails) return;
  throw codedError(code, message, { hint: "Run `bugbaton snapshot` and choose an element whose role matches the action." });
}

const KEY_CODES = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Space: 32 };

async function dispatchKey(cdp, key) {
  if (!key) throw codedError("KEY_REQUIRED", "press requires a key", { exitCode: 2 });
  const text = key.length === 1 ? key : key === "Space" ? " " : key === "Enter" ? "\r" : undefined;
  const windowsVirtualKeyCode = KEY_CODES[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : undefined);
  if (!windowsVirtualKeyCode) throw codedError("UNSUPPORTED_KEY", `Unsupported key ${JSON.stringify(key)}`, { exitCode: 2, hint: "Use a single character or Enter, Tab, Escape, Backspace, Delete, arrow key, or Space." });
  const code = key.length === 1 ? `Key${key.toUpperCase()}` : key === "Space" ? "Space" : key;
  await cdp.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key, code, text, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode });
}

export async function captureScreenshot(endpoint, tabSelector, output, fullPage = false) {
  const { tab } = await tabContext(endpoint, tabSelector, { requireExplicit: true });
  return withCdp(tab.webSocketDebuggerUrl, async (cdp) => {
    await cdp.send("Page.enable");
    let clip;
    if (fullPage) {
      const { contentSize } = await cdp.send("Page.getLayoutMetrics");
      clip = { x: 0, y: 0, width: contentSize.width, height: contentSize.height, scale: 1 };
    }
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: fullPage, ...(clip ? { clip } : {}) });
    const buffer = Buffer.from(data, "base64");
    const absolute = path.resolve(output);
    await mkdir(path.dirname(absolute), { recursive: true });
    try {
      await writeFile(absolute, buffer, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error.code === "EEXIST") throw codedError("OUTPUT_EXISTS", `Screenshot output already exists: ${absolute}`, { exitCode: 2, hint: "Choose a new --output path." });
      throw error;
    }
    return { path: absolute, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex"), capturedAt: new Date().toISOString(), targetId: tab.id, url: redactUrl(tab.url), fullPage, warning: "Screenshots may contain sensitive page content; review before sharing." };
  });
}

export async function readEvents(paths, { kinds, tabId, limit = 100, since, clear = false, eventLog: fixedEventLog }) {
  const eventLog = fixedEventLog ?? await readEventLog(paths);
  const cursors = await readJson(paths.cursors, {});
  const cursorKey = `${tabId}:${[...kinds].sort().join(",")}`;
  const clearedAt = cursors[cursorKey]?.clearedAt;
  const sinceMs = since ? Date.parse(since) : null;
  const clearedMs = clearedAt ? Date.parse(clearedAt) : null;
  const events = eventLog.records
    .filter((event) => kinds.includes(event.kind))
    .filter((event) => !tabId || event.targetId === tabId)
    .filter((event) => !sinceMs || Date.parse(event.observedAt) >= sinceMs)
    .filter((event) => !clearedMs || Date.parse(event.observedAt) > clearedMs)
    .slice(-Number(limit))
    .map(redactEvent);
  if (clear) {
    cursors[cursorKey] = { clearedAt: new Date().toISOString(), boundaryId: eventLog.cursor.id };
    await writeJson(paths.cursors, cursors);
  }
  return { events, cursor: eventLog.cursor };
}

export async function readEventLog(paths) {
  let text = "";
  let readError = null;
  try { text = await readFile(paths.events, "utf8"); } catch (error) {
    if (error.code !== "ENOENT") readError = { code: error.code ?? "EVENT_STORE_READ_FAILED", message: error.message };
  }
  let corruptLines = 0;
  const records = text.split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { corruptLines += 1; return []; }
  });
  return {
    records,
    cursor: {
      id: createHash("sha256").update(text).digest("hex").slice(0, 20),
      capturedAt: new Date().toISOString(),
      bytes: Buffer.byteLength(text),
      records: records.length,
      corruptLines,
      readError,
      lastObservedAt: records.at(-1)?.observedAt ?? null,
    },
  };
}

export async function readActions(paths, tabId, limit = 100) {
  let text = "";
  try { text = await readFile(paths.actions, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  return text.split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  }).filter((action) => !tabId || action.targetId === tabId).slice(-limit);
}
