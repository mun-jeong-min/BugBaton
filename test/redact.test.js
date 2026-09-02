import assert from "node:assert/strict";
import test from "node:test";
import { redactEvent, redactText, redactUrl } from "../src/redact.js";

test("redacts URL credentials and sensitive query values", () => {
  const result = redactUrl("https://alice:password@example.test/path?token=secret&view=compact#section");
  assert.equal(result, "https://redacted:redacted@example.test/path?token=%5Bredacted%5D&view=compact#section");
});

test("redacts common authorization-like text before persistence", () => {
  assert.equal(redactText("Authorization: Bearer abc.def-123"), "Authorization: Bearer [redacted]");
  const event = redactEvent({ url: "https://example.test/?api_key=abc", message: "token=very-secret" });
  assert.equal(event.url.includes("abc"), false);
  assert.equal(event.message.includes("very-secret"), false);
});
