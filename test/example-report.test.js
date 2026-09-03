import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SAMPLE_ROOT = fileURLToPath(new URL("../docs/example-report/", import.meta.url));

test("committed example is a private, complete capture with verified shutdown", async () => {
  const [markdown, reportText, receiptText, screenshot] = await Promise.all([
    readFile(`${SAMPLE_ROOT}README.md`, "utf8"),
    readFile(`${SAMPLE_ROOT}report.json`, "utf8"),
    readFile(`${SAMPLE_ROOT}capture-receipt.json`, "utf8"),
    readFile(`${SAMPLE_ROOT}screenshot.png`),
  ]);
  const report = JSON.parse(reportText);
  const receipt = JSON.parse(receiptText);
  const textualBundle = `${markdown}\n${reportText}\n${receiptText}`;

  assert.equal(report.status, "complete");
  assert.equal(report.observation.coverage, "best-effort");
  assert.equal(report.observation.completeSinceNavigation, false);
  assert.equal(report.redaction.appliedBeforePersistence, true);
  assert.deepEqual(report.claim, {
    title: "The request fails after one click",
    expected: "The request completes successfully.",
    actual: "The endpoint returns HTTP 503 and the page logs an error.",
  });
  assert.equal(report.errors.length, 3);
  assert.equal(report.failedNetwork.length, 1);
  assert.equal(report.failedNetwork[0].status, 503);
  assert.equal(report.actionOutcomes.length, 4);
  assert.ok(report.actionOutcomes.every((action) => action.source === "browser"));
  assert.ok(report.actionOutcomes.some((action) => action.action === "input" && action.textLength === 14));
  assert.ok(report.timeline.some((entry) => entry.type === "network" && entry.status === 503));
  assert.deepEqual(receipt.sessionShutdown, {
    complete: true,
    monitorStopped: true,
    browserOwned: true,
    browserClosed: true,
  });
  assert.match(markdown, /Bundle status: \*\*complete\*\*/);
  assert.match(markdown, /Observation coverage: \*\*best effort\*\*/);
  assert.match(markdown, /## Bug claim[\s\S]*Expected:[\s\S]*Actual:/);
  assert.match(markdown, /## Verify this bundle[\s\S]*does not prove who\s+created/i);
  assert.match(markdown, /HTTP 503/);
  assert.doesNotMatch(textualBundle, /sample message|\/Users\/|CAPTURE_INPUT/i);
  assert.deepEqual([...screenshot.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});
