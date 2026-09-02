import assert from "node:assert/strict";
import test from "node:test";
import { startDemoServer } from "../src/demo.js";

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
