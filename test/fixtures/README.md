# CDP E2E fixture

Run the dependency-free server with:

```sh
node test/fixtures/server.mjs --port 4173
```

Pass `--port 0` when a test runner should select a free port. The first stdout
line is JSON and contains the selected `url` and server `pid`.

Run the fixture's focused regression checks with:

```sh
node --test test/fixtures/server.test.mjs
```

The fixture deliberately exposes stable interactions and failures:

| Control or endpoint | Expected signal |
| --- | --- |
| `#click-target` | Counter and live status change; `console.info` |
| `#message` + Enter | Submitted text and live status change |
| `#request-ok` / `/api/ok` | HTTP 200 |
| `#request-http-error` / `/api/http-error` | HTTP 503 and caught console error |
| `#request-network-failure` / `/api/disconnect` | CDP `Network.loadingFailed` and caught console error |
| `#console-error` | Deliberate `console.error` |
| `#runtime-error` | Uncaught JavaScript exception |

The page makes no external requests and the server binds to loopback by
default. This keeps screenshots and network assertions deterministic.
