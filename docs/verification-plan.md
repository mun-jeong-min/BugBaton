# Verification plan

This plan defines evidence for the CLI MVP against a real Chrome instance and
the dependency-free app in `test/fixtures`. It is the executable contract used
by `npm run test:e2e`; current results are recorded in `docs/validation.md`.

## Observed local environment

Observed on 2026-09-02 (Asia/Seoul):

- Node.js: `/opt/homebrew/bin/node`, `v26.0.0`
- npm: `11.12.1`
- Chrome: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
  `Google Chrome 152.0.7977.75`
- `google-chrome`, `chromium`, and `chromium-browser` were not present on
  `PATH`.
- No listener owned by Chrome/Chromium was found on common CDP ports 9222,
  9223, 9224, or 9333 at the initial inspection time.
- A follow-up probe launched that exact executable in new headless mode with a
  temporary profile and an ephemeral loopback debugging port. `/json/version`
  succeeded with CDP protocol `1.3` and a browser WebSocket URL; `/json/list`
  included the fixture as a `page` target titled `BugBaton fixture`.
- The same target listing also contained component-extension background pages,
  service workers, and `browser_ui` targets, even with a fresh profile. This is
  direct evidence that `tabs` should default to user-facing `page` targets and
  expose non-page targets only through an explicit option.

That initial probe proved the installed Chrome could expose CDP and load the
fixture. The later automated lane now also proves BugBaton's own launch/connect
and full diagnostic workflow on this environment; see the validation record.

## Test topology

Use three processes and isolate automation from the user's everyday Chrome
profile:

1. Fixture server, bound to `127.0.0.1` on a dynamically allocated port.
2. Chrome, launched with a new temporary `--user-data-dir` and remote
   debugging enabled. Never attach tests to the default user profile.
3. CLI under test, invoked as a separate process so exit status, stdout, and
   stderr are observable exactly as a shell or coding agent sees them.

Each run owns its fixture process, Chrome process, profile directory,
screenshots, and report output. The harness must terminate only processes it
started and clean only paths it created.

For the deterministic lane, launch Chrome with background activity reduced
(`--disable-background-networking`, `--disable-component-update`,
`--disable-default-apps`, and `--disable-extensions`) in addition to the
product's required isolation flags. The initial real-Chrome probe showed that a
fresh profile alone can still start component-extension targets and Google
Updater activity. These flags are a test-harness control; production behavior
must still tolerate extra targets and browser-owned background noise.

## Fixture contract

Start it directly while developing:

```sh
node test/fixtures/server.mjs --port 0
```

The first stdout line is machine-readable JSON with `url` and `pid`. The page
provides stable semantic names and selectors for snapshots, click/fill/press,
an HTTP 503, a dropped connection that produces `Network.loadingFailed`, a
console error, and an uncaught runtime error. It has no external dependencies
or requests.

## Layers and acceptance criteria

### 1. Deterministic fixture checks

- `/`, `/app.js`, and `/styles.css` return 200 with the expected content type.
- `/api/ok` returns 200 and `{ "ok": true }`.
- `/api/http-error` returns 503.
- `/api/disconnect` closes without an HTTP response.
- Unknown files return 404 and traversal outside the fixture root is rejected.

### 2. Chrome/CDP smoke check

- `doctor --json` locates the executable and reports actionable launch/connect
  readiness without modifying the default profile.
- `launch --json --url <fixture-url>` starts an isolated Chrome and returns endpoint,
  browser PID, and selected tab identity.
- Fetching `/json/version` from the returned loopback endpoint succeeds and
  exposes a `webSocketDebuggerUrl`.
- `connect --json <endpoint>` can attach to that already-running browser.
- `tabs --json` includes exactly enough stable identity to target the fixture:
  target id, type, title, URL, and active/selected state if known.
- `tabs` defaults to `type=page`; broader target discovery is deferred until a
  concrete diagnostic use case requires it.

### 3. User-flow E2E

Run commands against an explicit tab id when more than one page exists.

| MVP command | Action | Required evidence |
| --- | --- | --- |
| `snapshot` | Snapshot fixture tab | Output contains headings, button names, form label, status, and stable element references usable by actions. |
| `click` | Click `Increment counter` | Counter becomes 1; command identifies the acted-on element. |
| `fill` | Fill `Message` with `hello bugbaton` | Input value is exact, including spaces. |
| `press` | Press Enter in `Message` | `Submitted: hello bugbaton` appears and status becomes submitted. |
| `errors` | Trigger console and runtime error buttons | Both deliberate messages appear with level/type, timestamp, tab id, and source location when Chrome provides it. |
| `network --failed` | Trigger HTTP 503 and dropped connection | Output distinguishes HTTP failure (503) from transport failure (`loadingFailed`) and includes URL, method, timing, and error/status. |
| `screenshot` | Capture fixture | PNG signature is valid, dimensions are nonzero, and the visible heading/status are present in a human-inspected sample. |
| `report` | After interactions/failures | One bounded artifact summarizes page identity, snapshot, errors, failed requests, and screenshot path without leaking cookies or authorization headers. |
| `verify` | After receiving a report directory | Works without Chrome; rejects incompatible headers, unsafe paths, invalid metadata, changed attachments, and attachment symlinks; reports receipt consistency and does not claim producer authenticity. |

### 4. Shell and JSON contracts

For every MVP command:

- Human mode is concise, sends results to stdout, and sends diagnostics to
  stderr.
- `--json` emits one documented JSON value with no decoration on stdout.
- Wall-clock timestamps are ISO 8601; raw CDP monotonic values are explicitly
  named, durations use integer milliseconds, and ids remain strings.
- Empty results are successful empty arrays/sections, not ambiguous errors.
- Usage and invalid selectors exit nonzero with an actionable message and a
  stable error code in JSON mode.
- A refused endpoint, stale tab, ambiguous match, navigation during action,
  and unwritable output path each have a focused negative test.
- Event retention is exercised with a 64 KiB test cap and enough real console
  events to force rotation; injected write/read failure, corrupt JSONL, and
  same-session monitor restart must each degrade doctor/report provenance.

### 5. Repeatability and cleanup

- Run the complete real-Chrome lane at least three times with dynamic fixture
  and CDP ports; all runs pass without port collisions or leaked processes.
- Run two isolated E2E instances concurrently; tab targeting and artifacts do
  not cross streams.
- After forced CLI and Chrome termination, a new run succeeds without manual
  cleanup.
- Compare `git status --short --untracked-files=all` before and after. Only
  explicitly selected output paths may be added.

## Security boundary checks

- Launch always uses a fresh profile unless the user explicitly supplies one.
- Connect defaults to loopback endpoints. A non-loopback endpoint requires an
  explicit opt-in and a warning because CDP grants browser-equivalent control.
- Logs and reports redact cookie values, `Authorization`, `Proxy-Authorization`,
  and URL userinfo. Query strings are included only under a documented policy.
- Actions never silently fall back from an explicit tab id to another tab.
- Reports and screenshots are written only to the requested local path and are
  never uploaded.
- `verify` accepts only basename attachment paths and regular files, checks
  declared sizes and SHA-256 hashes, and states that those checks do not prove
  who created the bundle.

## Evidence record

Record the exact CLI revision, Node/Chrome versions, commands, exit codes,
stdout/stderr captures, generated artifacts, and cleanup result. Keep a small
checked-in fixture unit test separate from the real-Chrome lane so ordinary CI
can run without Chrome; gate platform-specific Chrome E2E only where the
browser is provisioned.

## First implementation loop

1. Prove the fixture endpoints and process cleanup with Node's built-in test
   runner.
2. Prove `doctor`, isolated `launch`, `/json/version`, `tabs`, and `connect`.
3. Add snapshot and action tests before diagnostics, because stable target
   selection is their prerequisite.
4. Add error/network capture and assert the 503-versus-transport distinction.
5. Add screenshot/report artifact validation and redaction tests.
6. Repeat the full lane three times, then run two lanes concurrently.

When a failure occurs, preserve the failing command, exit code, stderr, Chrome
version, target id, and relevant CDP event sequence; fix the smallest violated
contract and rerun that focused check before the full lane.
