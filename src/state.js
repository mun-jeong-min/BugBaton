import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { codedError } from "./errors.js";

export function stateRoot(override) {
  return path.resolve(override ?? process.env.BUGBATON_STATE_DIR ?? path.join(os.homedir(), ".local", "state", "bugbaton"));
}

export function sessionPaths(root) {
  return {
    root,
    session: path.join(root, "session.json"),
    events: path.join(root, "events.jsonl"),
    actions: path.join(root, "actions.jsonl"),
    monitor: path.join(root, "monitor.json"),
    cursors: path.join(root, "cursors.json"),
    snapshots: path.join(root, "snapshots"),
  };
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    if (error instanceof SyntaxError) {
      throw codedError("STATE_INVALID_JSON", `State file is not valid JSON: ${file}`, {
        hint: "Run `bugbaton doctor`; inspect or move the named state file, then reconnect to Chrome.",
        details: { path: file },
      });
    }
    throw error;
  }
}

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

export function snapshotFile(paths, targetId) {
  const safeId = createHash("sha256").update(targetId).digest("hex").slice(0, 20);
  return path.join(paths.snapshots, `${safeId}.json`);
}
