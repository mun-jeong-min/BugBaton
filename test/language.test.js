import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BINARY_EXTENSIONS = new Set([".gif", ".ico", ".jpeg", ".jpg", ".png", ".webp"]);
const IGNORED_DIRECTORIES = new Set([".git", "node_modules"]);
const CJK_PATTERN = /[\u1100-\u11ff\u2e80-\u2eff\u3040-\u30ff\u3130-\u318f\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/u;

async function collectFiles(relativePath) {
  const absolutePath = path.join(REPOSITORY_ROOT, relativePath);
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const childPath = path.join(relativePath, entry.name);
    if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
      files.push(...await collectFiles(childPath));
    } else if (entry.isFile() && !BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(childPath);
    }
  }

  return files;
}

test("repository-owned text and paths contain no CJK writing", async () => {
  const files = (await collectFiles(".")).sort();
  const violations = [];

  for (const relativePath of files) {
    if (CJK_PATTERN.test(relativePath)) {
      violations.push(`${relativePath}: path`);
    }

    const contents = await readFile(path.join(REPOSITORY_ROOT, relativePath), "utf8");
    const lines = contents.split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      if (CJK_PATTERN.test(line)) {
        violations.push(`${relativePath}:${index + 1}`);
      }
    }
  }

  assert.deepEqual(violations, [], `CJK writing found:\n${violations.join("\n")}`);
});
