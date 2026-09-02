export function codedError(code, message, { exitCode = 1, hint, retryable = false, details } = {}) {
  const error = new Error(message);
  error.code = code;
  error.exitCode = exitCode;
  error.hint = hint;
  error.retryable = retryable;
  error.details = details;
  return error;
}

export function errorPayload(error, fallbackCode = "OPERATION_FAILED") {
  return {
    code: error.code ?? fallbackCode,
    message: error.message,
    ...(error.hint ? { hint: error.hint } : {}),
    retryable: Boolean(error.retryable),
    ...(error.details ? { details: error.details } : {}),
  };
}

export function safeSingleLine(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
}
