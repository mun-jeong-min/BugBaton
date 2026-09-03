#!/usr/bin/env node

import { main } from "../src/cli.js";
import { errorPayload, safeSingleLine } from "../src/errors.js";

process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

try {
  await main(process.argv.slice(2));
} catch (error) {
  const json = process.argv.slice(2).includes("--json");
  if (json) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      ok: false,
      command: null,
      data: null,
      error: errorPayload(error, "INTERNAL_ERROR"),
    })}\n`);
  } else {
    process.stderr.write(`bugbaton: ${safeSingleLine(error.message)}\n`);
  }
  process.exitCode = error.exitCode ?? 1;
}

// Node's built-in WebSocket may retain a close-handshake timer after a
// one-shot browser command. All command output is synchronous; exit explicitly so
// the shell does not wait on transport cleanup that cannot affect the result.
process.exit(process.exitCode ?? 0);
