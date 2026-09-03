import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readJson, sessionPaths, snapshotFile, writeJson } from "../src/state.js";
import { snapshotIdentityMatches } from "../src/operations.js";

test("writes private JSON state atomically", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bugbaton-state-test-"));
  const file = sessionPaths(root).session;
  await writeJson(file, { endpoint: "http://127.0.0.1:9222" });
  assert.deepEqual(await readJson(file), { endpoint: "http://127.0.0.1:9222" });
  assert.match(await readFile(file, "utf8"), /127\.0\.0\.1/);
});

test("snapshot state filenames do not expose target IDs", () => {
  const file = snapshotFile(sessionPaths("/tmp/bugbaton"), "sensitive-target-id");
  assert.equal(file.includes("sensitive-target-id"), false);
  assert.match(path.basename(file), /^[a-f0-9]{20}\.json$/);
});

test("snapshot refs are bound to endpoint and browser instance", () => {
  const snapshot = { endpoint: "http://127.0.0.1:9222", browserInstanceId: "browser-a" };
  const session = { endpoint: "http://127.0.0.1:9222", browserInstanceId: "browser-a" };
  const cdpUrl = "ws://127.0.0.1:9222/devtools/page/1";
  assert.equal(snapshotIdentityMatches(snapshot, session, cdpUrl), true);
  assert.equal(snapshotIdentityMatches(snapshot, { ...session, browserInstanceId: "browser-b" }, cdpUrl), false);
  assert.equal(snapshotIdentityMatches({ ...snapshot, endpoint: "http://127.0.0.1:9333" }, session, cdpUrl), false);
  assert.equal(snapshotIdentityMatches({}, session, cdpUrl), false);
  assert.equal(snapshotIdentityMatches(snapshot, session, "file:///not-cdp"), false);
});

test("invalid JSON state exposes a typed recovery error", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bugbaton-invalid-state-"));
  const file = sessionPaths(root).session;
  await writeFile(file, "{broken", { mode: 0o600 });
  await assert.rejects(
    readJson(file),
    (error) => error.code === "STATE_INVALID_JSON" && error.hint.includes("bugbaton doctor") && error.details.path === file,
  );
});
