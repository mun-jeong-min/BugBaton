import assert from "node:assert/strict";
import test from "node:test";
import { CdpConnection } from "../src/cdp.js";

class FakeWebSocket {
  static OPEN = 1;
  static behavior = null;
  static openMode = "open";

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = new Map();
    Promise.resolve().then(() => {
      if (FakeWebSocket.openMode === "error") this.emit("error", {});
      else {
        this.readyState = FakeWebSocket.OPEN;
        this.emit("open", {});
      }
    });
  }

  addEventListener(type, listener, options = {}) {
    const entries = this.listeners.get(type) ?? [];
    entries.push({ listener, once: Boolean(options.once) });
    this.listeners.set(type, entries);
  }

  emit(type, event) {
    const entries = [...(this.listeners.get(type) ?? [])];
    this.listeners.set(type, entries.filter((entry) => !entry.once));
    for (const entry of entries) entry.listener(event);
  }

  send(raw) {
    FakeWebSocket.behavior?.(this, JSON.parse(raw));
  }

  close() {
    this.readyState = 3;
    this.emit("close", {});
  }
}

async function withFakeWebSocket(operation) {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  FakeWebSocket.behavior = null;
  FakeWebSocket.openMode = "open";
  try {
    return await operation();
  } finally {
    globalThis.WebSocket = original;
  }
}

test("CDP transport resolves commands and fans out events", () => withFakeWebSocket(async () => {
  FakeWebSocket.behavior = (socket, message) => {
    Promise.resolve().then(() => socket.emit("message", { data: JSON.stringify({ id: message.id, result: { value: 42 } }) }));
  };
  const connection = await new CdpConnection("ws://127.0.0.1:9222/devtools/page/1").open();
  let observed;
  connection.on("Runtime.consoleAPICalled", (payload) => { observed = payload; });
  connection.socket.emit("message", { data: JSON.stringify({ method: "Runtime.consoleAPICalled", params: { type: "error" } }) });
  assert.deepEqual(observed, { type: "error" });
  assert.deepEqual(await connection.send("Runtime.evaluate"), { value: 42 });
  connection.close();
}));

test("CDP protocol numeric errors stay in bounded details", () => withFakeWebSocket(async () => {
  FakeWebSocket.behavior = (socket, message) => {
    Promise.resolve().then(() => socket.emit("message", { data: JSON.stringify({ id: message.id, error: { code: -32000, message: "No node" } }) }));
  };
  const connection = await new CdpConnection("ws://127.0.0.1:9222/devtools/page/1").open();
  await assert.rejects(
    connection.send("DOM.resolveNode"),
    (error) => error.code === "CDP_PROTOCOL_ERROR" && error.details.protocolCode === -32000 && error.details.method === "DOM.resolveNode",
  );
  connection.close();
}));

test("CDP timeout and closed connection errors are typed and retryable", () => withFakeWebSocket(async () => {
  const connection = await new CdpConnection("ws://127.0.0.1:9222/devtools/page/1").open();
  await assert.rejects(
    connection.send("Page.enable", {}, 5),
    (error) => error.code === "CDP_TIMEOUT" && error.retryable && error.details.timeoutMs === 5,
  );
  connection.close();
  await assert.rejects(
    connection.send("Page.enable"),
    (error) => error.code === "CDP_CONNECTION_CLOSED" && error.retryable,
  );
}));

test("CDP open failure has an actionable typed error", () => withFakeWebSocket(async () => {
  FakeWebSocket.openMode = "error";
  await assert.rejects(
    new CdpConnection("ws://127.0.0.1:9222/devtools/page/1").open(),
    (error) => error.code === "CDP_CONNECTION_FAILED" && error.retryable && error.hint.includes("doctor"),
  );
}));
