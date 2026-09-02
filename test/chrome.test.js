import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeEndpoint, normalizeEndpoint, selectTab } from "../src/chrome.js";
import { errorPayload, safeSingleLine } from "../src/errors.js";
import { belongsToLiveBrowser } from "../src/cli.js";

test("remote endpoints fail closed with a typed recovery hint", () => {
  assert.throws(
    () => assertSafeEndpoint("http://example.test:9222"),
    (error) => error.code === "REMOTE_ENDPOINT_BLOCKED" && error.exitCode === 2 && /--allow-remote/.test(error.hint),
  );
  assert.doesNotThrow(() => assertSafeEndpoint("http://127.0.0.1:9222"));
});

test("endpoint normalization accepts HTTP origins and rejects other schemes", () => {
  assert.equal(normalizeEndpoint("127.0.0.1:9333/json/version?x=1"), "http://127.0.0.1:9333");
  assert.equal(normalizeEndpoint("https://localhost:9443/path"), "https://localhost:9443");
  assert.throws(() => normalizeEndpoint("file:///tmp/socket"), (error) => error.code === "INVALID_ENDPOINT" && error.exitCode === 2);
  assert.throws(() => normalizeEndpoint("http://[bad"), (error) => error.code === "INVALID_ENDPOINT" && Boolean(error.hint));
});

test("tab selection exposes stable not-found and ambiguity errors", () => {
  const tabs = [
    { id: "abc111", title: "App one", url: "http://127.0.0.1:3000/one" },
    { id: "abc222", title: "App two", url: "http://127.0.0.1:3000/two" },
  ];
  assert.throws(() => selectTab([], null), (error) => error.code === "NO_PAGE_TABS");
  assert.throws(() => selectTab(tabs, "missing"), (error) => error.code === "TAB_NOT_FOUND");
  assert.throws(() => selectTab(tabs, "abc"), (error) => error.code === "TAB_AMBIGUOUS" && error.details.matches === 2);
  assert.equal(selectTab(tabs, "abc222").title, "App two");
});

test("error payload preserves agent-facing retry and detail fields", () => {
  const error = new Error("temporary failure");
  error.code = "TEMPORARY";
  error.hint = "retry later";
  error.retryable = true;
  error.details = { target: "fixture" };
  assert.deepEqual(errorPayload(error), {
    code: "TEMPORARY",
    message: "temporary failure",
    hint: "retry later",
    retryable: true,
    details: { target: "fixture" },
  });
});

test("observation provenance requires endpoint and browser identity", () => {
  const record = { endpoint: "http://127.0.0.1:9222", browserInstanceId: "browser-a" };
  assert.equal(belongsToLiveBrowser(record, record.endpoint, "browser-a"), true);
  assert.equal(belongsToLiveBrowser(record, "http://127.0.0.1:9333", "browser-a"), false);
  assert.equal(belongsToLiveBrowser(record, record.endpoint, "browser-b"), false);
  assert.equal(belongsToLiveBrowser(null, record.endpoint, "browser-a"), false);
  assert.equal(belongsToLiveBrowser({ ...record, sessionId: "old" }, record.endpoint, "browser-a", "new"), false);
});

test("human-facing dynamic text cannot inject terminal control sequences", () => {
  assert.equal(safeSingleLine("title\n\u001b[31mred\u0000"), "title  [31mred ");
});
