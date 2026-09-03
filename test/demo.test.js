import assert from "node:assert/strict";
import test from "node:test";
import { assessDemoEvidence, DEMO_EVIDENCE_REQUIREMENT, startDemoServer } from "../src/demo.js";

test("demo evidence requires a visible action-to-failure chain", () => {
  const empty = assessDemoEvidence({ actions: 0, errors: 0, failedNetwork: 0 });
  assert.equal(empty.id, DEMO_EVIDENCE_REQUIREMENT.id);
  assert.equal(empty.status, "not-met");
  assert.equal(empty.checks.actions.met, false);
  assert.equal(empty.checks.errors.met, false);
  assert.equal(empty.checks.failedNetwork.met, false);

  const captured = assessDemoEvidence({ actions: 1, errors: 1, failedNetwork: 1 });
  assert.equal(captured.status, "met");
  assert.ok(Object.values(captured.checks).every((check) => check.met));
});

test("self-contained demo serves one intentional local failure", async () => {
  const demo = await startDemoServer();
  try {
    assert.match(demo.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const page = await fetch(demo.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Make a small browser bug/);

    const script = await fetch(`${demo.url}/app.js`);
    assert.equal(script.status, 200);
    assert.match(await script.text(), /demo: request failed/);

    const failure = await fetch(`${demo.url}/api/failure`);
    assert.equal(failure.status, 503);
    assert.deepEqual(await failure.json(), { error: "intentional demo failure" });

    const missing = await fetch(`${demo.url}/missing`);
    assert.equal(missing.status, 404);
  } finally {
    await demo.close();
  }
});
