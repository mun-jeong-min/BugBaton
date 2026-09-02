# Implementation Review 1: Final Revalidation

- Review date: 2026-09-02 (Asia/Seoul)
- Scope: `src/**/*.js`, `bin/chroma.js`, `package.json`, `README.md`, and `test/e2e/chrome.test.js`
- Method: read-only code review, unit and fixture tests, and real Chrome 152 E2E with an isolated profile
- Fresh-eye review: findings from independent E2E and competitive-research audits were fixed and revalidated
- References use symbols and test names rather than fragile line numbers. This record describes the final worktree reviewed before its release commit.

## Final Verdict

The highest-risk defects from the initial review are closed. Endpoint identity is
bound to browser-instance identity. The monitor records readiness only after the
first poll and target attachment. URLs and events are redacted before durable
append, and snapshot state retains reference bindings rather than input values.
`--clear` advances a scoped cursor. Launch refuses an occupied CDP port. Artifact
output fails closed on collisions.

The accepted ADR's causal `doctor`, same-boundary report, and same-session restart
continuity are implemented. No known finding blocks the MVP.

## Executed Verification

- `npm run check`: exit 0; lint passed; 44 of 44 tests passed, including the whole-repository language guard.
- `npm run test:e2e`: both real-browser lanes passed: the advanced workflow in 13.305 seconds and one-command capture in 5.570 seconds. Two earlier concurrent advanced-workflow runs also passed in 13.327 and 13.025 seconds.
- Public GitHub Actions passed quality checks on Ubuntu, macOS, and Windows plus real-Chrome E2E on Ubuntu and macOS.
- A real-Chrome smoke run passed the packaged, loopback-only `demo` through report generation and verified shutdown without an existing application.
- Chrome 152 with CDP 1.3 passed `launch -> doctor -> tabs -> snapshot -> click/fill/press -> errors -> network --failed -> screenshot -> report`.
- An early manual trace found about 0.59 seconds between monitor process start and first target attachment. The implementation now distinguishes `monitorStartedAt` from each target's `observationStartedAt`.

## Remaining MVP Blockers: 0

The final fresh-eye audit found two high-severity issues: evidence from a different
session on the same browser and endpoint could be admitted, and a covered element
could report a false-successful click. The session-ID condition in
`belongsToLiveBrowser` plus the ignored-evidence boundary closes the first issue.
A pre-click page hit test and `ELEMENT_OBSCURED` close the second. The real-Chrome
E2E reproduces both paths.

The same audit also closed evidence-read failure without persistence, same-URL
reload and browser binding, and incomplete cleanup proof.

## Critical Finding Disposition

| ID | Final state | Evidence and remaining boundary |
| --- | --- | --- |
| C1: monitor reuse after endpoint or session change | **Resolved** | `startMonitor`, `assertSessionIdentity`, `belongsToLiveBrowser`, and `ignoredEventLog` validate endpoint, browser, and observation-session identity together. Real-browser E2E confirms zero previous events in a different session on the same browser. |
| C2: ready before attachment and a false observation window | **Resolved** | Process start, target observation, and readiness are distinct. Write failures, dropped events, corruption, and restart discontinuity are recorded. Restart degradation stays sticky until an explicit new session. |
| C3: missing redaction in reports or durable state | **Resolved for the declared policy** | Monitor `record` applies redaction and UTF-8 bounding before persistence. Snapshot state stores identity and reference bindings, not values; report generation redacts again. Screenshots and accessibility names or descriptions remain content risks disclosed in the README. |
| C4: launch mistakes an existing Chrome process for its own | **Resolved for identity; explicit profile risk remains** | Launch returns typed `PORT_IN_USE` for an occupied CDP port, terminates its owned child after timeout, and stores a browser WebSocket identity hash. The default state-owned profile satisfies Chrome 136+ isolation. A user-supplied profile triggers a warning, and startup failure returns `CDP_STARTUP_FAILED` with a recovery hint. |
| C5: scoped clear deletes unrelated evidence | **Resolved** | `readEvents` stores per-target and per-kind cursors atomically. Unit and real-Chrome tests verify that other tabs and event kinds remain available. |
| C6: artifact overwrite, symlink, or partial output | **Resolved** | `captureScreenshot` uses exclusive creation. `commandReport` rejects existing output, completes work in private staging, atomically renames it, and removes staging on failure. Attachment integrity uses SHA-256. |
| C7: tab, reference, or selector mutates the wrong node | **Resolved for MVP** | Ambiguous tabs fail closed, and mutations require `--tab` when multiple tabs exist. Selectors must match exactly one element. References are bound to endpoint, browser instance, target, URL fingerprint, loader ID, and backend node. Older unbound references are rejected as stale. |
| C8: an E2E command succeeds with zero executed tests | **Resolved** | The full real-Chrome flow passes alone and concurrently and asserts process termination plus removal of temporary paths. |

## Improvement Finding Disposition

| ID | Final state | Evidence and remaining boundary |
| --- | --- | --- |
| I1: failed-network correlation | **Partial, non-blocking** | A request map attaches URL, method, duration, and initiator summary to transport failures. Real-browser E2E covers HTTP 503 and disconnect failures. Reports label an action within the preceding ten seconds as `basis: temporal`; redirect-chain normalization and stronger causal attribution remain future work. |
| I2: causal doctor checks | **Resolved for MVP** | Doctor helpers independently check Chroma and Node, executable version, writable and private state, corruption, endpoint, instance identity, protocol, monitor readiness, event-store health, and profile isolation. The next action is derived from the causal failure. |
| I3: JSON and exit contract | **Resolved for MVP** | ADR, README, and implementation agree on exit meanings `0` through `3` and `error: null` on success. Stale snapshots, selector or tab ambiguity, output collision, remote policy, endpoint or startup failure, and monitor failure keep stable string codes, retryability, a recovery hint, and bounded details. Numeric CDP codes appear only in `details.protocolCode`. |
| I4: invalid filters and command timeout | **Resolved** | `commandEvents` validates limits and time before execution. `CdpConnection` has typed pending and open timeouts with timer cleanup. |
| I5: unbounded or corrupt event store | **Resolved for MVP** | The implementation has byte-bounded rotation, serialized append, write and drop health, corrupt-line cursors, restart-health inheritance, and sticky degradation. |
| I6: report provenance and partial completion | **Resolved for MVP** | Reports include a shared cursor, overall status, restart discontinuity, atomic output, and value-free action outcomes. JSON and Markdown derive from the same `report.status`. |
| I7: test flags forced in production | **Resolved** | Background and extension flags are applied only with explicit `--deterministic`; E2E uses that mode and reports preserve it. |
| I8: fill input and element coverage | **Partially resolved, deferred remainder** | `fill --stdin` avoids command history and process-list exposure while recording only character count. Contenteditable and select-element semantics remain documented future work. |

## Follow-Up Work

- `stop` now ends observation and closes Chrome only after matching the saved browser-instance identity. An idle timeout remains optional follow-up work.
- Keep Node 22 as the intentional minimum for built-in WebSocket support; a Node 18 compatibility layer is not justified at this stage.
- Continue excluding raw CDP, broad automation, and cross-browser parity. Observation and report integrity remain the product boundary.
- The report-redaction E2E places known markers in a query string and input value, then confirms their absence from the state directory and textual report bundle. Screenshots and accessible names remain a disclosed manual-review boundary.

## Priority Order

1. Extend redirect and duplicate normalization, and improve confidence labels for action-to-failure correlation.
2. Classify Chrome startup and profile failures more precisely by platform.
3. Run the same real-browser lane on Linux and Windows.

## Structured Findings

- No remaining act-before-ship finding exists in this review scope.
- I1 | bin: valid-but-defer | evidence: strong | ref: `src/monitor.js`; `src/cli.js` | action: defer | URL, method, timing, initiator, and explicitly temporal action correlation are present; redirect normalization remains.
- I3 | bin: resolved | evidence: strong | ref: `src/errors.js`; `src/cdp.js`; `src/operations.js`; `src/cli.js` | action: accept | Public failures keep stable string codes, recovery hints, retryability, and bounded details.
- I8 | bin: valid-but-defer | evidence: strong | action: defer | Standard input is supported; contenteditable and select semantics remain documented limits.
