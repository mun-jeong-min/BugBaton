const SENSITIVE_KEY = /(?:^|[_-])(auth|authorization|bearer|code|cookie|credential|key|password|secret|session|signature|token)(?:$|[_-])/i;

export function redactUrl(value) {
  if (!value || typeof value !== "string") return value;
  try {
    const url = new URL(value);
    if (url.username) url.username = "redacted";
    if (url.password) url.password = "redacted";
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_KEY.test(key)) url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return value;
  }
}

export function redactText(value) {
  if (!value || typeof value !== "string") return value;
  return value
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*([^\s,&]+)/gi, "$1=[redacted]")
    .replace(/https?:\/\/[^\s)'\"]+/gi, (url) => redactUrl(url));
}

export function redactEvent(event) {
  return {
    ...event,
    ...(event.url ? { url: redactUrl(event.url) } : {}),
    ...(event.message ? { message: redactText(event.message) } : {}),
  };
}
