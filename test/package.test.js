import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import test from "node:test";
import { COMMAND_OPTIONS } from "../src/args.js";

test("package surface and README stay aligned with the public CLI", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const contributing = await readFile(new URL("../CONTRIBUTING.md", import.meta.url), "utf8");
  const cli = await readFile(new URL("../src/cli.js", import.meta.url), "utf8");
  const bin = new URL("../bin/chroma.js", import.meta.url);
  const binStat = await stat(bin);

  assert.equal(packageJson.bin.chroma, "./bin/chroma.js");
  assert.equal(packageJson.description, "Reproduce a web app bug once; preserve the Chrome evidence for whoever fixes it");
  assert.equal(packageJson.dependencies, undefined, "the MVP must remain zero-runtime-dependency");
  assert.ok(packageJson.files.includes("CONTRIBUTING.md"));
  assert.ok((binStat.mode & 0o111) !== 0, "the packaged bin must be executable");
  await access(bin, constants.X_OK);

  for (const command of Object.keys(COMMAND_OPTIONS)) {
    assert.ok(readme.includes(`| \`${command}`), `README command table should include ${command}`);
  }
  for (const requiredBoundary of ["loopback", "--allow-remote", "isolated profile", "not a sandbox", "does not upload"]) {
    assert.match(readme.toLowerCase(), new RegExp(requiredBoundary.replaceAll("-", "\\-")), `README should retain security boundary: ${requiredBoundary}`);
  }
  assert.match(contributing, /not a general browser automation framework/i);
  assert.match(contributing, /npm run test:e2e/);
  for (const surface of [readme, contributing, cli]) {
    assert.match(surface, /reproduce the web app bug once/i,
      "public surfaces should retain the core product promise");
  }
});
