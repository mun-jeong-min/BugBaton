# Validation record

Date: 2026-09-03<br>
Environment: macOS (arm64), Node.js v26.0.0, npm 11.12.1<br>
Browser: Google Chrome 152.0.7977.75, CDP protocol 1.3

This record captures the release evidence for the BugBaton 0.1.0 MVP, including
the public package and matching GitHub release.

## Outcome

The complete named MVP workflow passed against a real, locally installed Chrome and the dependency-free fixture app:

```text
launch -> doctor -> tabs -> snapshot -> click -> fill -> press
       -> errors -> network --failed -> screenshot -> report -> stop

capture -> manual click/input/submit trail -> report -> verified shutdown

report directory -> verify schema/path/hash/receipt consistency without Chrome
```

All CLI invocations in the E2E lane ran as separate processes and returned one schema-versioned JSON envelope. The background monitor therefore had to preserve evidence across invocations rather than relying on one in-memory test connection.

## Commands and results

### Static, parser, unit, and fixture gate

```console
$ npm run check
eslint bin src test
tests 54; pass 54; fail 0
```

The gate includes ESLint with a complexity rule, syntax probes,
help/version/JSON/parser contracts, read-only doctor behavior, scoped clear
cursors, event-store sticky health, redaction, private atomic state, fixture
HTTP/transport behavior, the packaged demo server, committed-sample integrity,
report tamper/path/symlink rejection, and a repository-wide guard against CJK
writing in owned text and paths.

### Real Chrome E2E

```console
$ npm run test:e2e
✔ real Chrome completes the diagnosis and report workflow (13113.410959ms)
✔ capture records manual actions, writes evidence, and stops its session (8685.406417ms)
✔ demo refuses an empty success claim and accepts a captured failure (7256.495417ms)
tests 3; pass 3; fail 0
```

End-to-end assertions include:

- isolated headless Chrome launch on a reserved loopback CDP port;
- monitor readiness and `page`-only target discovery;
- nine causal `doctor` checks with a healthy event store;
- accessibility refs selected by role/name;
- refs bound to endpoint/browser/document, with injected browser-ID mismatch,
  hash navigation, and same-URL reload each rejected as stale;
- CDP mouse press/release hit-testing, including an overlay that must fail with
  `ELEMENT_OBSCURED` instead of reporting a false click;
- actual counter click, fill, and Enter form submission state;
- stdin fill with one trailing line ending removed and no value in argv, output, state, or report;
- console error, uncaught exception, HTTP 503, and transport disconnect collected by later CLI processes;
- failed-request URL/method correlation and event-store cursor shape;
- PNG signature and full-page screenshot output;
- independently recomputed SHA-256 matching screenshot command/report metadata;
- offline `verify` success for advanced, capture, evidence-incomplete demo, and
  evidence-complete demo bundles, plus receipt/evidence-requirement consistency;
- `report.json`, Markdown summary, and PNG from an atomic staging workflow;
- one shared high-water boundary for report errors and failed-network sections;
- sensitive query values and temporary fill text absent from state and textual report artifacts;
- report status `complete`, mandatory-v1 redaction metadata, and no leftover staging directory;
- cleanup of fixture, monitor, Chrome process group, temporary state/profile, and artifacts in `finally`.
- fail-closed JSON errors for an occupied CDP port, a five-match selector, and screenshot/report output collisions;
- fault injection that turns `events.jsonl` into an unwritable directory; errors expose `WRITE_FAILURE` + `READ_FAILURE`, doctor becomes `degraded`, and report becomes `partial`;
- explicit `connect` recovery followed by a same-session monitor restart; `MONITOR_RESTART` and `UNKNOWN_RESTART_GAP` remain sticky and the report stays `partial`.
- a 64 KiB real-process retention limit exceeded by 80 browser console errors; rotation, dropped-event degradation, bounded cursor bytes, and partial report are asserted;
- an injected corrupt JSONL line is counted in the shared cursor, degrades health with `CORRUPT_LINES`, and keeps report status honest.
- same browser and endpoint but a different observation `sessionId`; previous
  events/actions are ignored and the resulting report is explicitly partial;
- permissive legacy event/action modes corrected to owner-only on a new session;
- termination followed by asserted process-group/fixture disappearance and
  asserted temporary-root deletion, including failure paths.
- one-command `capture` with privacy-safe manual click, input-length, and submit
  events, a complete report, and browser/monitor shutdown after identity checks;
- browser log timestamps remain in a plausible wall-clock range rather than
  inheriting an incorrect milliseconds conversion.
- automatic capture port selection and a post-report receipt proving monitor and
  owned-browser shutdown; browser completion requires both the CDP endpoint and
  the recorded Chrome process to exit.
- bounded title/expected/actual claim fields rendered above the evidence timeline,
  with oversize claims rejected before session state is created.
- the packaged demo refuses a false-positive success when no action-to-failure
  evidence was recorded, preserves the incomplete report, and still verifies
  shutdown; a captured HTTP 503 action satisfies the explicit demo requirement.

The same diagnostic implementation also passed two instances concurrently
(workflow times 13327.176ms and 13024.821ms) before the positioning-only
README/help edits. This proves dynamic ports, browser/session state, evidence,
artifacts, and cleanup do not cross streams. A listener probe after the
concurrent run found no Chrome/Chromium/BugBaton listener.

The [public GitHub Actions run](https://github.com/mun-jeong-min/BugBaton/actions/runs/33707133322)
passed the complete quality matrix on Ubuntu (Node 22 and 24), macOS (Node 22),
and Windows (Node 22). The real-Chrome E2E lane also passed on Ubuntu, macOS,
and Windows, with no skipped tests.

### Package/install smoke

Final `npm pack --json` succeeded with 29 package entries, an approximately
142 kB tarball, and approximately 328 kB of unpacked content.
The bin entry was executable (`0755`),
CONTRIBUTING/docs/runtime files were included, and `node_modules` was excluded.

A final production-only local install into an isolated `/tmp` prefix succeeded
in 195ms with one package and no runtime dependencies. The installed binary then
passed `bugbaton --version` (`0.1.0`), top-level help, read-only
`bugbaton doctor --json`, and `bugbaton verify` against the committed sample.

The public `bugbaton@0.1.0` registry readback returned the expected version and
tarball metadata. A fresh install by package name into an empty temporary prefix
then passed version, help, doctor, and committed-sample verification without
using the repository checkout as the executable source.

The packaged demo now separates bundle integrity from demonstration success. An
empty `bugbaton demo --headless --deterministic --duration 1` run writes the
JSON/Markdown/PNG bundle plus `capture-receipt.json`, verifies monitor and browser
shutdown, then exits with `DEMO_EVIDENCE_INCOMPLETE`. A second real-Chrome run that
clicked the intentional HTTP 503 control passed with at least one recorded action,
browser error, and failed request.

### Manual dogfood loop

Before the automated lane was fixed, the workflow was run manually against the
fixture. It found three real implementation defects:

1. `press Enter` returned success but did not submit the form. CDP key dispatch
   was corrected to use `keyDown` for text-generating keys (including Enter),
   with code, text, and virtual-key metadata; a fresh snapshot then showed the
   submitted value. Non-text keys continue to use `rawKeyDown`.
2. One-shot CDP commands waited on Node's WebSocket close-handshake timer. The executable now exits explicitly after synchronous output; measured `snapshot` process time fell to about 0.18 seconds.
3. A first CDP mouse implementation sent `mouseMoved` before press/release.
   Headless Chrome 152 delayed that event by about 5 seconds on each diagnostic
   button, taking the lane from ~13 to ~43 seconds. Method-level timing isolated
   the cause; removing the unnecessary hover event restored clicks to ~0.13–0.17
   seconds while retaining hit-tested mouse press/release.

The manual report captured seven browser/runtime/console findings, two failed requests, an accessibility snapshot, and a visually inspected fixture screenshot. It was generated before mandatory-v1 monitor metadata and correctly reported that persistence-redaction provenance as false; all current automated runs start a fresh session and require it to be true.

## Security and integrity checks

- CDP launch is loopback-only; non-loopback endpoints fail closed without `--allow-remote`.
- Manual action capture persists element type and ordinal plus input length, but
  never the entered value or page text used as a label.
- A browser WebSocket identity hash binds the saved session to the actual Chrome instance, preventing silent port reuse.
- Observation evidence additionally requires the exact session ID; same-browser
  reconnect crash windows cannot inherit the previous window's log.
- Monitor readiness is emitted only after a successful target poll; target-level observation time remains separate from process start.
- Known credential/query/token patterns are removed before durable event append.
- Snapshot state stores only URL/document identity and element ref bindings, not form values.
- The event log is capped at 5 MiB. Drops, write failures, corruption, and same-session restart gaps remain sticky degraded health.
- Screenshot and report collision attempts fail instead of overwriting an existing path.
- Dynamic human output strips terminal control characters; report Markdown
  escapes untrusted title/URL syntax.
- Report diagnostics share a recorded event-log boundary and final bundles are renamed from owner-only staging.

## Remaining non-blocking priorities

1. Improve the report's explicitly low-confidence temporal correlation with stronger CDP initiator evidence.
2. Add redirect-chain and duplicate-occurrence normalization; request durations and initiator locations are already recorded.
3. Add contenteditable and select/combobox support only where fixtures prove the semantics; stdin fill is now available for secret values.
4. Expand remote-endpoint coverage; Windows state diagnosis already keeps ACL
   inspection explicitly outside the POSIX-mode privacy check.
5. Measure diagnosis time and report usefulness on representative open-source local apps before expanding automation verbs.
