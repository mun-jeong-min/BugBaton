import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createInterface } from 'node:readline';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('./server.mjs', import.meta.url));
let child;
let fixtureUrl;

before(async () => {
  child = spawn(process.execPath, [serverPath, '--port', '0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const lines = createInterface({ input: child.stdout });
  const ready = once(lines, 'line').then(([line]) => JSON.parse(line));
  const exited = once(child, 'exit').then(([code, signal]) => {
    throw new Error(`fixture exited before ready (code=${code}, signal=${signal}): ${stderr}`);
  });
  const message = await Promise.race([ready, exited]);
  fixtureUrl = message.url;
});

after(async () => {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await once(child, 'exit');
});

test('serves the deterministic app without external URLs', async () => {
  const response = await fetch(fixtureUrl);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html;/);

  const body = await response.text();
  assert.match(body, /<title>Chroma CDP fixture<\/title>/);
  assert.match(body, /id="click-target"/);
  assert.doesNotMatch(body, /https?:\/\//);
});

test('provides deterministic success and HTTP failure endpoints', async () => {
  const ok = await fetch(new URL('/api/ok', fixtureUrl));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { message: 'Fixture request succeeded', ok: true });

  const failed = await fetch(new URL('/api/http-error', fixtureUrl));
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), {
    error: 'fixture:deliberate-http-error',
    ok: false,
  });
});

test('drops the transport for a Network.loadingFailed signal', async () => {
  await assert.rejects(fetch(new URL('/api/disconnect', fixtureUrl)), TypeError);
});

test('returns 404 for missing assets and blocks traversal', async () => {
  const missing = await fetch(new URL('/missing.txt', fixtureUrl));
  assert.equal(missing.status, 404);

  const traversalPath = '/%2e%2e/%2e%2e/README.md';
  const traversal = await new Promise((resolve, reject) => {
    const url = new URL(fixtureUrl);
    const request = httpRequest(
      { host: url.hostname, path: traversalPath, port: url.port },
      resolve,
    );
    request.on('error', reject);
    request.end();
  });
  traversal.resume();
  assert.equal(traversal.statusCode, 403);
});
