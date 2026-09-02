const TRUNCATION_SUFFIX = "…[truncated]";

function truncateUtf8(value, maxBytes) {
  if (Buffer.byteLength(value) <= maxBytes) return { value, truncated: false };
  const suffixBytes = Buffer.byteLength(TRUNCATION_SUFFIX);
  const payloadBytes = Math.max(0, maxBytes - suffixBytes);
  let prefix = Buffer.from(value).subarray(0, payloadBytes).toString("utf8");
  while (Buffer.byteLength(prefix) > payloadBytes) prefix = prefix.slice(0, -1);
  return { value: `${prefix}${TRUNCATION_SUFFIX}`, truncated: true };
}

export function boundEventStrings(event, maxStringBytes = 16 * 1024) {
  let truncated = false;
  function visit(value) {
    if (typeof value === "string") {
      const bounded = truncateUtf8(value, maxStringBytes);
      truncated ||= bounded.truncated;
      return bounded.value;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, visit(entry)]));
    return value;
  }
  return { event: visit(event), truncated };
}
