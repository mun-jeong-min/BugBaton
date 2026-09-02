import assert from "node:assert/strict";
import test from "node:test";
import { eventStoreHealth } from "../src/event-health.js";

const healthy = { status: "healthy", writeFailures: 0, droppedEvents: 0, unknownGapCount: 0 };

test("event-store health is sticky across successful appends after a restart gap", () => {
  assert.deepEqual(eventStoreHealth(healthy, { corruptLines: 0 }), { status: "healthy", reasons: [] });
  const restarted = { ...healthy, status: "degraded", unknownGapCount: 1, recordsWritten: 10 };
  assert.deepEqual(eventStoreHealth(restarted, { corruptLines: 0 }), { status: "degraded", reasons: ["UNKNOWN_RESTART_GAP"] });
});

test("event-store health exposes write, drop, and corruption reasons", () => {
  const result = eventStoreHealth({ ...healthy, status: "failed", writeFailures: 1, droppedEvents: 2 }, { corruptLines: 1, readError: { code: "EISDIR" } });
  assert.equal(result.status, "failed");
  assert.deepEqual(result.reasons, ["WRITE_FAILURE", "DROPPED_EVENTS", "CORRUPT_LINES", "READ_FAILURE"]);
});

test("an unreadable log is failed even before the monitor records a write failure", () => {
  const result = eventStoreHealth(healthy, { corruptLines: 0, readError: { code: "EISDIR" } });
  assert.deepEqual(result, { status: "failed", reasons: ["READ_FAILURE"] });
});

test("per-event truncation remains visible as degraded health", () => {
  const result = eventStoreHealth({ ...healthy, truncatedEvents: 1 }, { corruptLines: 0 });
  assert.deepEqual(result, { status: "degraded", reasons: ["TRUNCATED_EVENTS"] });
});

test("cursor failures remain visible without monitor state", () => {
  assert.deepEqual(
    eventStoreHealth(null, { readError: { code: "EISDIR" }, corruptLines: 1 }),
    { status: "failed", reasons: ["NO_EVENT_STORE_STATE", "CORRUPT_LINES", "READ_FAILURE"] },
  );
});
