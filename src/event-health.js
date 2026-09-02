export function eventStoreHealth(store, cursor = {}) {
  const reasons = [];
  if (!store) reasons.push("NO_EVENT_STORE_STATE");
  if (store?.writeFailures > 0 || store?.status === "failed") reasons.push("WRITE_FAILURE");
  if (store?.droppedEvents > 0) reasons.push("DROPPED_EVENTS");
  if (store?.truncatedEvents > 0) reasons.push("TRUNCATED_EVENTS");
  if (store?.unknownGapCount > 0) reasons.push("UNKNOWN_RESTART_GAP");
  if (cursor.corruptLines > 0) reasons.push("CORRUPT_LINES");
  if (cursor.readError) reasons.push("READ_FAILURE");
  const failed = store?.status === "failed" || Boolean(cursor.readError);
  if (!store && reasons.length === 1) return { status: "unavailable", reasons };
  return { status: reasons.length ? failed ? "failed" : "degraded" : "healthy", reasons };
}
