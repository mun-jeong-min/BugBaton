import { codedError } from "./errors.js";

export class CdpConnection {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async open(timeoutMs = 5_000) {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => this.#onMessage(event.data));
    this.socket.addEventListener("close", () => this.#closePending(codedError("CDP_CONNECTION_CLOSED", "CDP connection closed", { retryable: true, hint: "Verify the tab and Chrome process are still open, then retry." })));
    this.socket.addEventListener("error", () => this.#closePending(codedError("CDP_CONNECTION_FAILED", "CDP connection failed", { retryable: true, hint: "Run `chroma doctor` to inspect endpoint and session health." })));
    let timer;
    try {
      await Promise.race([
        new Promise((resolve, reject) => {
          this.socket.addEventListener("open", resolve, { once: true });
          this.socket.addEventListener("error", () => reject(codedError("CDP_CONNECTION_FAILED", `Could not connect to ${this.url}`, { retryable: true, hint: "Run `chroma doctor` to inspect endpoint and session health." })), { once: true });
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(codedError("CDP_TIMEOUT", `Timed out opening CDP WebSocket after ${timeoutMs}ms`, { retryable: true, hint: "Run `chroma doctor` and retry if the endpoint is healthy." })), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    return this;
  }

  send(method, params = {}, timeoutMs = 10_000) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(codedError("CDP_CONNECTION_CLOSED", "CDP connection is not open", { retryable: true, hint: "Verify Chrome is running and retry the command." }));
    }
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(codedError("CDP_TIMEOUT", `${method}: CDP response timed out after ${timeoutMs}ms`, { retryable: true, hint: "Run `chroma doctor`; retry if the session is healthy.", details: { method, timeoutMs } }));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, method, timer });
    });
  }

  on(method, listener) {
    const entries = this.listeners.get(method) ?? new Set();
    entries.add(listener);
    this.listeners.set(method, entries);
    return () => entries.delete(listener);
  }

  close() {
    this.socket?.close();
  }

  #onMessage(raw) {
    const message = JSON.parse(String(raw));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(codedError("CDP_PROTOCOL_ERROR", `${pending.method}: ${message.error.message}`, {
          hint: "Refresh the snapshot or verify that the selected tab still supports this operation.",
          details: { method: pending.method, protocolCode: message.error.code },
        }));
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
    for (const listener of this.listeners.get("*") ?? []) listener(message.method, message.params ?? {});
  }

  #closePending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export async function withCdp(url, operation) {
  const connection = await new CdpConnection(url).open();
  try {
    return await operation(connection);
  } finally {
    connection.close();
  }
}
