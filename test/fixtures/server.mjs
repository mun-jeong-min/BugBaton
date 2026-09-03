#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureRoot = resolve(fileURLToPath(new URL('./app/', import.meta.url)));
const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

const host = option('--host', '127.0.0.1');
const port = Number.parseInt(option('--port', '4173'), 10);

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('Usage: node test/fixtures/server.mjs [--host 127.0.0.1] [--port 4173]');
  process.exit(2);
}

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
]);

function json(response, statusCode, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  const rawPath = (request.url ?? '/').split('?', 1)[0];
  let decodedRawPath;
  try {
    decodedRawPath = decodeURIComponent(rawPath);
  } catch {
    json(response, 400, { error: 'invalid-path-encoding' });
    return;
  }
  if (decodedRawPath.split('/').includes('..')) {
    json(response, 403, { error: 'forbidden' });
    return;
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? host}`);

  if (url.pathname === '/api/ok') {
    json(response, 200, { message: 'Fixture request succeeded', ok: true });
    return;
  }

  if (url.pathname === '/api/http-error') {
    json(response, 503, { error: 'fixture:deliberate-http-error', ok: false });
    return;
  }

  if (url.pathname === '/api/disconnect') {
    request.socket.destroy();
    return;
  }

  const relativePath = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const filePath = resolve(fixtureRoot, relativePath);
  if (filePath !== fixtureRoot && !filePath.startsWith(`${fixtureRoot}${sep}`)) {
    json(response, 403, { error: 'forbidden' });
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      json(response, 404, { error: 'not-found' });
      return;
    }
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-length': fileStat.size,
      'content-type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream',
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      json(response, 404, { error: 'not-found' });
      return;
    }
    console.error(error);
    json(response, 500, { error: 'fixture-server-error' });
  }
});

server.on('error', (error) => {
  console.error(`fixture server failed: ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = `http://${host}:${actualPort}`;
  console.log(JSON.stringify({ fixture: 'bugbaton', pid: process.pid, url }));
});

function close() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
