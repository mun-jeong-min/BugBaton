import assert from "node:assert/strict";
import test from "node:test";
import { boundEventStrings } from "../src/event-bounds.js";

test("event strings are bounded by UTF-8 bytes and visibly marked", () => {
  const source = { message: "\u{1F642}".repeat(100), nested: { url: `https://example.test/?q=${"x".repeat(100)}` }, count: 3 };
  const result = boundEventStrings(source, 48);
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(result.event.message) <= 48);
  assert.ok(Buffer.byteLength(result.event.nested.url) <= 48);
  assert.match(result.event.message, /\[truncated\]$/);
  assert.equal(result.event.count, 3);
  assert.notEqual(result.event, source);
});
