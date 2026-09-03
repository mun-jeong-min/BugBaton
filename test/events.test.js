import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readEventLog, readEvents } from "../src/operations.js";
import { sessionPaths } from "../src/state.js";

test("clear markers affect only the selected target and event kinds", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bugbaton-events-test-"));
  const paths = sessionPaths(root);
  const rows = [
    { kind: "error", targetId: "a", message: "old a", observedAt: "2026-01-01T00:00:00Z" },
    { kind: "error", targetId: "b", message: "old b", observedAt: "2026-01-01T00:00:00Z" },
    { kind: "network-failed", targetId: "a", message: "network a", observedAt: "2026-01-01T00:00:00Z" },
  ];
  await appendFile(paths.events, `${rows.map(JSON.stringify).join("\n")}\n`);
  assert.equal((await readEvents(paths, { kinds: ["error"], tabId: "a", clear: true })).events.length, 1);
  assert.equal((await readEvents(paths, { kinds: ["error"], tabId: "a" })).events.length, 0);
  assert.equal((await readEvents(paths, { kinds: ["error"], tabId: "b" })).events.length, 1);
  assert.equal((await readEvents(paths, { kinds: ["network-failed"], tabId: "a" })).events.length, 1);
});

test("event-log corruption and read failure are visible in its cursor", async () => {
  const corruptRoot = await mkdtemp(path.join(os.tmpdir(), "bugbaton-events-corrupt-"));
  const corruptPaths = sessionPaths(corruptRoot);
  await appendFile(corruptPaths.events, `${JSON.stringify({ kind: "error", observedAt: "2026-01-01T00:00:00Z" })}\nnot-json\n`);
  const corrupt = await readEventLog(corruptPaths);
  assert.equal(corrupt.records.length, 1);
  assert.equal(corrupt.cursor.corruptLines, 1);

  const failedRoot = await mkdtemp(path.join(os.tmpdir(), "bugbaton-events-failed-"));
  const failedPaths = sessionPaths(failedRoot);
  await mkdir(failedPaths.events);
  const failed = await readEventLog(failedPaths);
  assert.equal(failed.records.length, 0);
  assert.equal(failed.cursor.readError.code, "EISDIR");
});
