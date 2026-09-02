# ADR 0001: Product position and CLI contract

- Status: Accepted for the MVP
- Date: 2026-09-02
- Decision owners: Chroma maintainers
- Scope: Public CLI and safety contract; implementation details remain replaceable

## Context

Chroma connects to a real Chrome instance over the Chrome DevTools Protocol
(CDP) so a developer or coding agent can observe, diagnose, and make small,
intentional changes to a local web application from a shell.

The useful product is not a second general-purpose browser automation framework.
Playwright and Puppeteer already serve broad automation and test authoring, and
Chrome DevTools MCP/CLI-style tools expose a wide DevTools surface. Merely mapping
CDP methods to subcommands would give users another protocol wrapper without
making local debugging materially easier.

The unresolved developer loop is narrower:

1. establish whether local Chrome can be reached safely;
2. identify the page and capture a compact, referenceable view of it;
3. inspect runtime errors and failed requests in question-shaped commands;
4. perform a small interaction to reproduce or unblock the failure; and
5. emit a bounded, shareable evidence report.

Both humans and coding agents need the same interface. Humans need concise output,
actionable recovery hints, and safe defaults. Agents need deterministic selection,
stable structured output, explicit failure classes, and no terminal-only behavior.

## Decision

The public product promise is: **Reproduce once. Close Chrome. Keep the
evidence.** Chroma is a local flight recorder for a browser bug a developer can
reproduce but has not automated. It preserves the reproduction as ordinary files
that can move between a person, shell, issue, or agent.

Chroma will be an opinionated, read-mostly incident-triage CLI for local web apps.
Its public executable is `chroma`. It will expose a small set of task-level verbs,
not raw CDP domains, and every MVP command will support a stable `--json` mode.

The primary workflow is:

```text
capture -> manual reproduction -> report -> stop

doctor -> launch | connect -> tabs -> snapshot
                                    -> click | fill | press
                                    -> errors + network --failed
                                    -> screenshot + report -> stop
```

Read operations are the center of the product. Mutating operations are deliberately
limited to visible page interactions. Arbitrary JavaScript evaluation, request
interception, cookie editing, browser preference mutation, and general test running
are outside the MVP.

## Differentiation hypothesis

Chroma will earn adoption if it is faster and safer than assembling equivalent
diagnostics from a broad automation API or a one-tool-per-CDP surface. The wedge is
the complete `connect -> diagnose -> minimally reproduce -> report` loop, with one
contract shared by a person, `jq`, CI, and a coding agent.

The hypothesis has five parts:

- `capture` turns the complete first-use path into one command and records a
  value-free manual action trail before producing and closing the evidence session.
- `doctor` turns Chrome discovery, launch flags, endpoint reachability, profile
  isolation, and protocol compatibility into one causal diagnosis rather than a
  connection stack trace.
- `errors` and `network --failed` answer developer questions directly instead of
  requiring users to know Console, Runtime, Log, Network, and Target domain details.
- `report` creates a deterministic evidence packet spanning page identity, snapshot,
  console/page failures, failed requests, Chrome/environment facts, and optional
  screenshot metadata.
- Shell discipline is product behavior: stdout is data, stderr is diagnostics,
  output is finite, schemas and exit meanings are stable, and non-interactive use
  never depends on prompts or a terminal.

This is a hypothesis, not a claim that competitors lack these primitives. In
particular, a Chrome DevTools CLI with a daemon and JSON output means “MCP, but in a
terminal” is not a defensible position. We must validate the hypothesis through
time-to-diagnosis and report usefulness against representative local-app failures.

## Capability contract

### Global invocation rules

The canonical form is:

```text
chroma [--json] [--endpoint <url>] [--state-dir <path>] [--allow-remote]
       [--verbose] <command> [...]
```

Global options may appear before or after the subcommand. Generated documentation
uses the form above.

- `--json` changes serialization only. It must not change the work performed.
- `--endpoint <url>` overrides the endpoint remembered by `launch` or `connect` for
  the current invocation.
- `--state-dir <path>` overrides the local state directory; `CHROMA_STATE_DIR` is
  the environment-variable equivalent.
- `--allow-remote` permits an explicitly supplied non-loopback endpoint for this
  invocation and surfaces a strong warning. It is never persisted as blanket
  permission.
- `--verbose` writes additional diagnostics to stderr without changing stdout data
  or relaxing redaction.
- Commands that accept `--tab <match>` try an exact CDP target ID first. Otherwise
  they accept an ID prefix or a substring of URL/title only when it matches exactly
  one page target; zero or multiple matches fail.
- If `--tab` is omitted and exactly one current `page` target exists, Chroma uses
  it. When multiple page targets exist, diagnostics, captures, and mutations fail
  closed and require explicit selection. Extensions, workers, frames, and DevTools
  targets are never implicit candidates.
- Options and invalid inputs are rejected before a page mutation is attempted.
- `capture` alone waits for Enter or Ctrl+C in an interactive terminal. Scripts
  use `--duration`; all other missing choices return a typed error and recovery hint.

Human output is intentionally concise and may improve without a compatibility
promise. Machine output and exit codes are the compatibility surface.

### `doctor`

```text
chroma doctor [--chrome <path>] [--endpoint <http-url>]
```

Checks the local prerequisites needed by the other commands. At minimum it reports:

- Chroma and supported runtime versions;
- Chrome executable discovery and detected Chrome version;
- whether a proposed debugging endpoint is loopback, reachable, and speaks the
  expected discovery protocol;
- whether launch profile and state directories can be created with safe
  permissions; and
- protocol/version warnings that could make behavior partial.

The top-level status is `ready` or `not_connected`; individual check objects expose
their observed values/booleans, and `nextAction` names the next useful command.
`doctor` returns 0 when it successfully produces this diagnosis, including when a
dependency is unavailable. It is read-only apart from disposable probes removed
before returning.

### `capture`

```text
chroma capture [--url <url>] [--output <directory>] [--duration <seconds>]
               [--chrome <path>] [--port <number>] [--profile <path>]
               [--headless] [--deterministic]
```

`capture` is the first-use product path. It launches an isolated Chrome session,
starts observation with manual action capture enabled, waits while the developer
reproduces the bug, writes the same report contract as `report`, then stops the
monitor and verified Chroma-owned Chrome process. Without `--duration`, Enter or
Ctrl+C ends recording. Progress and the prompt stay on stderr so JSON stdout
remains one document.

Manual action records may include click, submit, control-key, element category,
page ordinal, and input length. They never include input text or page text labels.
These actions are contextual breadcrumbs, not a replay script or proof of cause.

### `launch`

```text
chroma launch [--chrome <path>] [--port <number>] [--profile <path>]
              [--url <url>] [--headless]
```

Starts a separate Chrome process with remote debugging bound to loopback, establishes
a Chroma session, and prints the resulting session and endpoint. It must not modify
the flags of or terminate an already-running Chrome process.

The default profile is a Chroma-managed isolated profile. `--profile` deliberately
permits an explicit alternative, including a personal Chrome profile, but launch
output and reports carry a strong warning because authenticated state can be read or
modified. The MVP has no arbitrary Chrome-flag passthrough, so callers cannot
override Chroma-owned debugging address, port, or profile arguments indirectly.

Successful `launch` returns only after the discovery endpoint is reachable and the
session monitor is ready. Process supervision is an implementation detail, but
subsequent commands must either reach the recorded instance or fail as a connection
error; they must never attach to a different process that happens to reuse a port.
`stop` closes a launched browser through a verified browser-level CDP connection;
it never kills an unverified PID from mutable state.

### `connect`

```text
chroma connect [<http-url>] [--endpoint <http-url>] [--allow-remote]
```

Attaches to an already-debuggable Chrome instance and records enough identity to
detect later endpoint reuse. The default endpoint is a documented loopback default
or an endpoint supplied through configuration; it is never guessed from a public
interface.

Only loopback endpoints are accepted by default. A non-loopback endpoint requires
`--allow-remote`, emits a warning in command/report metadata, and is still subject
to scheme and address validation. `connect` does not launch Chrome,
change its flags, or enable remote debugging on an existing process.

Successful `launch` and `connect` start a local session monitor. The monitor attaches
to current and newly discovered page targets and appends relevant CDP events to a
JSONL event log whose records carry the target ID. Observation for `errors`,
`network`, and `report` begins
when that monitor is ready, not before Chrome was launched or before Chroma attached.
Chroma cannot promise events from before that observation window.

Every affected result includes `observationStartedAt`, `monitorRunning`, and
`bestEffort`. MVP event capture is always `bestEffort: true`: even a healthy monitor
does not claim pre-attachment or gap-free browser history. A stopped, restarted,
detached, or partially attached monitor adds an explicit completeness warning.
Chroma never presents partial history as complete page history.

### `stop`

```text
chroma stop
```

`stop` ends the Chroma observation session. For `connect`, it stops observation
but leaves the externally owned browser running. For `launch` or `capture`, it
closes Chrome only after the live endpoint matches the saved browser-instance
identity. Evidence remains on disk for review. The command is idempotent and does
not create state when no session exists.

### `tabs`

```text
chroma tabs
```

Lists current `page` targets in deterministic CDP discovery order. Human output
contains shortened target ID, title, and URL. JSON contains the complete target ID
and type. A single row is the safe implicit default; content-producing and
mutating commands require `--tab` when more than one page exists.

Because real Chrome instances may contain multiple or sensitive tabs, scripts and
all mutation/report examples should pass an exact target ID obtained from `tabs`.
The single-page default optimizes the isolated local-app path without silently
selecting among several sensitive tabs.

An empty list is a successful query. A command that requires a page target then
fails with exit 1 and suggests opening a tab or passing a
valid target.

### `snapshot`

```text
chroma snapshot [--tab <match>] [--all]
```

Captures a compact accessibility-oriented page tree suitable for inspection and
interaction. Interactive nodes receive opaque references such as `@e1`. Human
output favors role, accessible name, state, and value summaries over a DOM dump.
JSON preserves hierarchy and structured properties.

A reference is scoped to the connected browser, target ID, and URL that produced it.
Chroma records this binding locally. Navigation to another URL, target closure,
reconnection to a different browser instance, or an unresolvable backend node makes
the reference stale or unavailable. Mutating commands must refuse it; they must not
re-find “something similar” and click it.

By default, output includes interactive nodes plus high-signal structural/status
roles. `--all` includes the full non-ignored accessibility tree. If an implementation
limit truncates either mode, truncation is explicit in human and JSON output.

### `click`

```text
chroma click <@ref> [--tab <match>]
chroma click --selector <css> [--tab <match>]
```

Resolves one exact target, scrolls it into view when necessary, performs one click,
and reports the chosen reference or selector plus target identity. Plain unprefixed
text is treated as a snapshot reference only when it matches the reference grammar;
fuzzy visible-text lookup is not part of the MVP. A CSS selector uses the explicit
`--selector` option. Zero matches fail; selectors intended for a unique mutation
should resolve to one element.

### `fill`

```text
chroma fill <@ref> <value> [--tab <match>]
chroma fill --selector <css> <value> [--tab <match>]
chroma fill <@ref> --stdin [--tab <match>]
```

Replaces the current editable value and dispatches the normal input/change path.
It refuses non-editable targets. Values passed as arguments may be retained in shell
history and process listings. `--stdin` reads the value from redirected or piped
stdin and removes one trailing line ending, so callers can avoid argv exposure.
Using `--stdin` with a positional value is a usage error.

The supplied value is never echoed in normal output, JSON, stored action history,
or `report`. Results state only the supplied character count.

### `press`

```text
chroma press [<@ref>] <key> [--tab <match>]
```

Sends one documented key to the resolved element, or to the active page
element when the reference is omitted. Key names are validated against a published
MVP grammar such as `Enter`, `Escape`, arrow keys, or a single character; arbitrary
JavaScript keyboard expressions and modifier chords are rejected.

### `errors`

```text
chroma errors [--tab <match>] [--since <iso-time>] [--limit <n>] [--clear]
```

Returns uncaught page exceptions, console errors, and CDP log entries observed by
Chroma for the selected target. Records include timestamp, kind, message, source
location when known, occurrence count, and observation-window metadata. Repeated
equivalent records may be grouped, but grouping and counts must be explicit.

No findings and one or more findings are both successful queries. `--clear` returns
the selected records and then clears records of that kind for the selected target;
it must not remove another target's or command's records. The result states that
clearing occurred. This separates “the query worked” from “the page is healthy.”

### `network --failed`

```text
chroma network --failed [--tab <match>] [--since <iso-time>] [--limit <n>]
                        [--clear]
```

Returns requests observed by Chroma that failed at the transport layer or completed
with an unsuccessful HTTP status according to the documented status policy. Each
record includes method, sanitized URL, status or CDP failure reason, resource type,
duration when known, initiator summary when known, and timestamp.

Query values, authorization headers, cookies, request bodies, and response bodies
are not emitted by default. The JSON result distinguishes `transport`, `http`, and
`blocked` failure kinds. Empty and `--clear` behavior matches `errors`.

### `screenshot`

```text
chroma screenshot [--output <png-path>] [--full-page] [--tab <match>]
```

Captures the viewport by default or the full page when requested. The image is
always written to a file; stdout contains only a human summary or the JSON envelope,
never binary PNG bytes. If `--output` is omitted, Chroma chooses a collision-safe
path in the current directory and reports it. Existing explicit paths and symlinks
are refused so a diagnostic capture cannot silently replace another artifact.

The result includes path, byte size, target ID, URL, and whether full-page capture
was requested. It warns that screenshots can contain sensitive page content.

### `report`

```text
chroma report [--output <directory>] [--no-screenshot] [--tab <match>]
```

Produces one bounded diagnostic evidence packet for the selected page. It contains:

- Chroma, Chrome, platform, connection mode, and relevant launch facts;
- target ID, title, sanitized URL, and observation window;
- a snapshot or an explicit reason it could not be captured;
- the same normalized records returned by `errors` and `network --failed`;
- action outcomes without input values; and
- a screenshot captured at report time unless `--no-screenshot` is supplied.

`report` always writes a local bundle directory containing a machine-readable
`report.json`, a concise `README.md`, and, by default, `screenshot.png`. Without
`--output`, Chroma chooses a collision-safe timestamped directory. Stdout contains
only the artifact path and summary, or the standard envelope in JSON mode.

`report.json` is the bundle manifest as well as its structured evidence. It records
schema, Chroma/Chrome/protocol identity, target identity, observation cursor/window,
monitor completeness, redaction policy, section provenance, and a typed reason for
every missing or partial section. This is the evidence-packet distinction: the
sections describe one collection boundary rather than an untraceable concatenation
of console, network, and snapshot output. Inability to create a trustworthy manifest
is an operation failure.

Report ordering and normalization are deterministic for the same captured evidence.
Timestamps, generated paths, and live page evidence are the expected volatile
fields. A report with findings is a successful report.

## JSON contract

Every command supports `--json` and writes exactly one UTF-8 JSON document followed
by one newline to stdout. Progress, warnings, and debug logs go to stderr. JSON mode
disables spinners, ANSI color, interactive prompts, and incidental prose.

Success envelope:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "command": "tabs",
  "data": {},
  "error": null
}
```

Failure envelope:

```json
{
  "schemaVersion": 1,
  "ok": false,
  "command": "click",
  "data": null,
  "error": {
    "code": "STALE_REFERENCE",
    "message": "Reference @e3 belongs to a previous document.",
    "retryable": true,
    "hint": "Run `chroma snapshot` and use a new reference.",
    "details": {}
  }
}
```

Rules:

- `schemaVersion`, `ok`, `command`, `data`, and `error` are always present.
- `error` is `null` on success and an object on failure.
- Command-specific target, endpoint, timing, warning, truncation, and observation
  metadata live inside `data`; no undocumented top-level fields are added.
- Machine-readable `error.code` values are stable within schema version 1. Error
  messages and hints may improve without a schema bump.
- `retryable`, `hint`, and `details` are optional error members; consumers must not
  require them for every failure.
- Wall-clock fields such as `observedAt` are UTC RFC 3339 strings and durations
  are integer milliseconds. When retained for ordering/debugging, CDP's raw
  monotonic clock is explicitly named `cdpMonotonicSeconds`; it is not presented
  as a wall-clock timestamp.
- Optional values are either omitted according to that command's schema or emitted
  as `null`; the choice is documented per field and does not vary by circumstance.
- Backward-compatible additive fields may be introduced in schema version 1.
  Removing, renaming, or changing the meaning/type of a field requires a version
  change.
- Human output is not parsed to implement JSON output. Both are rendered from the
  same typed command result.

## Stdout, stderr, and terminal behavior

- stdout contains the requested result or artifact locator only.
- stderr contains warnings, recovery guidance, and opt-in verbose diagnostics.
- A non-zero result still emits its JSON error envelope to stdout in `--json` mode;
  stderr remains safe to show to a person.
- When stdout is not a TTY, human tables use plain, bounded text without color.
- `NO_COLOR` is honored. No command requires cursor control.
- Broken stdout pipes are handled quietly as a normal consumer-close condition.
- Secrets are never intentionally written to diagnostics. `--verbose` does not
  relax redaction.

## Exit code contract

Exit codes describe command execution, not the severity of a page finding.

| Code | Meaning | Examples |
| ---: | --- | --- |
| 0 | Command completed | Doctor produced a diagnosis, empty/non-empty findings, screenshot/report written |
| 1 | Operation failed | No/multiple tab match, stale ref, CDP action failure, artifact write failure |
| 2 | Usage or safety policy rejected the request | Unknown option, malformed port/time, non-loopback endpoint without `--allow-remote` |
| 3 | Required browser capability is unavailable | Chrome not found, CDP endpoint unreachable, monitor cannot start |

`doctor` returns 0 when it successfully diagnoses an unavailable dependency; the
typed checks and top-level status carry that diagnosis. Exit 3 means the requested
non-diagnostic operation could not start because the dependency was unavailable.

Signals and catastrophic runtime failures may follow the platform convention (for
example 128 plus signal number). New normal failure modes map to these four categories
before a new public exit code is considered.

## State and identity

`launch` and `connect` replace the single current local session record and start or
reuse its local monitor. State lives under the platform state directory (for example
`$XDG_STATE_HOME/chroma` when set) and can be relocated with a documented
Chroma-specific option or environment variable.

Session records include only what is needed to reconnect and reject mistaken reuse:
endpoint, browser identity, connection mode, relevant launch facts, process identity
when Chroma launched it, and snapshot bindings. Files are created owner-only (0600)
inside owner-only directories (0700), written atomically, and safe under concurrent
readers.

The command line remains explicit in meaning:

- state supplies the last explicitly established connection; it does not cause implicit
  launch, navigation, tab activation, or mutation;
- `--tab` always overrides first-page selection;
- each result identifies the effective endpoint and target; and
- stale, corrupt, overly permissive, or browser-mismatched state is refused with a
  recovery action rather than silently repaired against a different browser.

The monitor's target-tagged JSONL event log may contain application data even after
redaction. It follows the same owner-only permissions, bounded retention, and
explicit observation-window rules as session state. Mandatory redaction happens
before durable append; render-time redaction alone is insufficient. A truncated,
corrupt, or discontinuous log results in `bestEffort`, not a complete-looking query.

## Security and privacy boundary

CDP access is effectively browser control. A party that can reach the endpoint can
read page content, execute page actions, access authenticated applications, and in
some configurations affect browser data. Chroma is not a sandbox and does not make
an untrusted endpoint safe.

Therefore:

- Chroma-launched debugging endpoints bind to loopback only. Chroma never exposes,
  tunnels, uploads, or publishes an endpoint.
- Remote connections are refused by default and require an explicit per-invocation
  acknowledgement. Chroma does not treat a remote endpoint as authenticated merely
  because it answered the discovery request.
- Launch uses an isolated profile by default. An explicit `--profile` may point at a
  personal profile, which can expose authenticated sessions and modify browsing
  state; Chroma emits a strong warning but cannot make that use safe.
- No telemetry, cloud upload, or external network request is performed by Chroma
  beyond requests needed to the endpoint explicitly in scope.
- URLs are sanitized for credentials and sensitive query values in errors, reports,
  and diagnostics. Cookies, authorization/proxy-authorization headers, request and
  response bodies, storage values, and `fill` contents are excluded by default.
- Screenshots and accessible names can still reveal secrets. Chroma warns at capture
  and report boundaries; users remain responsible for reviewing artifacts before
  sharing them.
- Output paths come only from the caller or Chroma's collision-safe default; page
  content never chooses a local path. Existing output paths and symlinks are refused.
- Page content is untrusted data. It is never interpreted as a shell command, CLI
  option, local path, or permission grant.
- Chroma does not bypass TLS warnings, browser security interstitials, same-origin
  policy, or OS protections by default.

## Fixed decisions

- One binary and task-level verbs form the public API.
- `--json` is available for every command with the versioned envelope above.
- A single `page` target is the safe default; multiple pages require `--tab` for diagnostics, captures, and mutations.
- Snapshot references are opaque and bound to browser, target, and URL.
- Stale references fail closed; no fuzzy re-resolution occurs.
- Stdout carries results, stderr carries diagnostics.
- Findings and execution failure have different exit semantics.
- Local isolated launch and loopback-only connection are the safe defaults.
- Diagnostic capture discloses its observation window and completeness.
- `launch` and `connect` start a local monitor that records target-tagged events as
  bounded JSONL; monitor health is part of diagnostic output.
- `capture` is the one-command first-use loop, records value-free manual action
  breadcrumbs, produces a report, and invokes ownership-safe shutdown.
- `stop` removes the current session, lets its matching monitor exit, and closes
  only a browser whose endpoint identity proves Chroma ownership.
- One current session record is the MVP state model; a new `launch` or `connect`
  replaces it.
- Read-focused diagnosis and bounded evidence reports, not broad automation, define
  the product.

## Probe questions

These remaining questions require measured use or a follow-up ADR before the
affected behavior is called stable:

- What exact accessibility snapshot limits give useful agent context while keeping
  typical output bounded?
- Which URL query keys can be safely retained, if any, and how should user-defined
  redaction rules compose with mandatory redaction?
- Which HTTP statuses count as failures by default, especially redirects, 304, and
  application-specific 4xx responses?
Restart gaps, endpoint reuse, and report cursor identity are no longer probes: the
implementation records sticky restart degradation, hashes the browser WebSocket
identity, binds evidence to a session ID, and gives report sections one event-log
high-water boundary. Future changes must preserve those tested answers.

## Deferred decisions

- Navigation and multi-step scripting: reconsider only after the diagnostic loop is
  reliable and repeated users need reproducible flows beyond one action.
- Raw JavaScript/CDP passthrough: reconsider only with a separate threat model and a
  demonstrated debugging case that task-level verbs cannot cover.
- Windows support and platform-specific Chrome discovery: reopen when CI and a real
  Windows host are available for end-to-end verification.
- Remote/tunneled Chrome as a first-class workflow: reopen only with authentication,
  transport, and endpoint ownership requirements.
- HAR export, trace recording, video, DOM diffing, and full test generation: reopen
  based on measured report gaps, not feature parity.
- A schema version negotiation command: add only when a second schema version or a
  long-lived external consumer makes negotiation necessary.
- Named/concurrent sessions, global command timeouts, and CI-oriented
  `--fail-on-findings`:
  reopen after the core single-session diagnostic loop is verified.

## Non-goals and deliberately not doing

- Replacing Playwright, Puppeteer, Selenium, Chrome DevTools, or their test runners.
- Providing a raw one-to-one CLI for every CDP domain or method.
- Promising access to console/network history from before Chroma began observing.
- Silently launching Chrome when a session is missing.
- Attaching to arbitrary LAN/public endpoints or a personal Chrome profile by
  default. Explicit `--allow-remote` or `--profile` use remains operator risk.
- Fuzzy natural-language element selection in the MVP.
- Hiding partial capture, truncation, stale references, or ambiguous matches behind
  a successful-looking result.
- Uploading reports, screenshots, or telemetry.
- Treating human-formatted output as a stable parsing API.

## Success criteria and acceptance checks

| Success criterion | Acceptance check |
| --- | --- |
| A first-time developer can determine why Chrome cannot be used and see a concrete recovery action. | **e2e:** run `doctor` with Chrome absent, an unreachable endpoint, and a healthy endpoint; assert typed checks, exit categories, and actionable hints. |
| A shell script and coding agent can invoke every MVP command without parsing prose. | **integration:** exercise every command with `--json`; validate exactly one stdout document against schema version 1 and ensure diagnostics do not corrupt it. |
| Tab selection is deterministic and visible. | **e2e:** open two fixture tabs; assert list order, exact `--tab` selection, fail-closed content capture without `--tab`, and failure after selected target closure. |
| Snapshot-driven actions cannot land on a navigated page silently. | **e2e:** snapshot, navigate to another URL, then attempt `click`, `fill`, and targeted `press`; each must return exit 1 with `STALE_REFERENCE` and make no mutation. |
| A developer can distinguish page findings from tool failure. | **e2e:** induce a console exception and failed request; both queries return 0, an action failure returns 1, malformed input/policy refusal returns 2, and unavailable Chrome returns 3. |
| Diagnostic results state what time range they actually cover. | **integration:** start the monitor after one fixture failure and before another; assert `observationStartedAt`, monitor state, and that results never label pre-window history complete. |
| Cross-invocation diagnostics preserve observed events without claiming gaps are complete. | **e2e:** establish a session, trigger console/network failures from a separate interaction command, then query them from later invocations; stop/restart the monitor and assert the next query is `bestEffort` with the discontinuity identified. |
| A report provides one coherent reproduction artifact without leaking known secrets. | **e2e:** fixture emits credentials in URL query, headers, body, console input, and a fill action; generate a report and assert mandatory redactions while retaining useful failure identity. |
| A first-time user can capture and shut down in one command. | **e2e:** run `capture`, produce manual click and input events, assert values are absent from state/report, verify the report, then prove the monitor and owned Chrome process exited. |
| Unsafe remote attachment is fail-closed. | **integration:** try a non-loopback endpoint without `--allow-remote`; assert no connection and exit 2. Verify explicit remote/personal-profile use carries warnings in output/report. |
| Screenshot/report file behavior is automation-safe. | **integration:** verify explicit/default paths, manifest file list, JSON metadata, and no binary/progress bytes on stdout. |
| Human output remains usable in pipelines. | **integration:** run commands with non-TTY stdout and `NO_COLOR`; assert bounded plain output, no cursor control, and quiet broken-pipe handling. |

Tripwires that disprove the differentiation hypothesis:

- users must routinely fall back to raw CDP or an automation library to explain the
  fixture failures the MVP claims to diagnose;
- separate invocations lose enough events that `errors`, `network`, or `report`
  appear healthy after a known failure;
- reports require manual cleanup before they can be shared safely;
- the human and JSON renderers disagree about target, findings, or success; or
- common recovery requires knowing internal session files or CDP domain names.

## Boundary ownership

- CLI parsing owns grammar and rejects invalid input before browser calls.
- The session layer owns endpoint/browser identity, lifecycle metadata, safe
  reconnection, and monitor lifecycle.
- The target layer owns page ordering, exact `--tab` resolution, and fail-closed multi-tab capture.
- Snapshot/action code owns reference binding and stale checks.
- Capture/normalization owns target-tagged JSONL persistence, observation windows,
  monitor health, deduplication, truncation, and mandatory pre-persistence redaction.
- Renderers own human versus JSON serialization from the same typed result.
- Command orchestration owns exit-category mapping and complete artifact manifests.
- README and command help teach the contract but do not redefine it; this ADR and
  executable schemas/tests are canonical when prose conflicts.

## Critique and counterweights

The highest-risk lock-in is pretending that short-lived CLI processes can provide
complete historical console/network evidence. This ADR acts before implementation
by requiring a session monitor, target-tagged JSONL event capture, an explicit
observation window, and visible monitor health. A report cannot silently imply
full-page history, including after a monitor discontinuity.

Cheap concerns bundled into the contract are exact snapshot-ref identity, no fuzzy
action fallback, findings-versus-failure exit behavior, a four-category exit model,
and explicit report provenance. An operational/E2E fresh-eye review also caught and
closed ambiguity around Chrome flag precedence by keeping arbitrary flag passthrough
out of the MVP.

An interface/competitive fresh-eye review identified two additional risks. First,
implicit first-page selection can be unsafe when a daily Chrome has multiple tabs.
The implementation now requires explicit selection before diagnostics, captures,
or mutations when multiple page targets exist. Second, a report that
merely concatenates primitives is not differentiated; the manifest now requires a
shared observation boundary, provenance, redaction state, and partial-step reasons.

Concerns about broad browser automation parity are over-worry for this slice; they
would erase the diagnostic wedge. Rich traces, first-class remote workflows, and
generated tests are valid but deferred until the core loop produces measured
evidence of those gaps.

## Consequences

The small public surface should be learnable and scriptable, and it gives tests a
clear contract. It also means some powerful CDP capabilities remain intentionally
inaccessible. Chroma must maintain schemas and exit semantics with more care than a
human-only debugging script, and historical diagnostics require a long-lived local
monitor plus sensitive local event storage. Safe defaults add explicit friction to
remote and personal-profile workflows; that friction is intentional.

## Canonical artifact and first implementation slice

This ADR is the canonical product and public CLI contract for the MVP. JSON schemas,
help snapshots, tests, and README examples should be derived from and checked against
it.

The implemented slice proves both the explicit diagnostic loop and the one-command
path on a real Chrome fixture. The release gate covers `doctor -> launch -> tabs ->
snapshot -> stale-safe action -> errors + network --failed -> report`, plus
`capture -> manual action evidence -> report -> ownership-safe stop`, JSON contracts,
observation boundaries, and mandatory redaction.
