# Competitive Research and Product Positioning

- Research date: 2026-09-02 (Asia/Seoul)
- Scope: real Chrome and CDP connections, shell UX, coding-agent use, and local web-app diagnosis
- Method: official documentation and repositories were preferred. A community CLI's own repository README is treated as the primary source for claims about that project.
- Freshness: this is a snapshot of the linked sources on the research date. Fast-moving projects should be checked again before a release.

## How to Read This Document

- **Fact** means the linked primary source states the claim.
- **Observation** means the claim was present or absent on the reviewed documentation surface. It does not prove that the underlying code lacks a feature.
- **Inference or recommendation** means a product decision derived from the evidence.

## Executive Conclusion

**Recommended position after the community re-audit:**

> Reproduce once. Close Chrome. Keep the evidence.

Playwright automates a flow and DevTools investigates a browser. Chroma preserves
one real-Chrome reproduction as ordinary files that can move between a person,
shell, issue, and coding agent after the live session ends. Public copy should
lead with the artifact surviving the browser session, not protocol names or a
generic promise that an agent can see Chrome.

The following claims are not differentiators by themselves:

- a lightweight CLI over CDP;
- attachment to an existing Chrome instance;
- accessibility snapshots and element references;
- machine-readable JSON output.

Chrome DevTools MCP includes an experimental CLI. Playwright CLI already supports
existing-browser attachment plus console and network inspection. Community tools
also provide direct CDP access, daemons, JSON output, stable tab aliases, and
buffered console and network events.

Chroma should therefore compete on four narrow outcomes:

1. `doctor` identifies the actual connection failure and gives an executable next step.
2. `errors` and `network --failed` return normalized failures instead of raw event dumps.
3. Every result states its observation boundary, selected target, and known evidence gaps.
4. `report` packages page state, screenshot, errors, failed requests, environment, redaction, and provenance from one evidence boundary.

Commands such as `click`, `fill`, `press`, `snapshot`, and `screenshot` are necessary
for reproduction, but they are supporting capabilities rather than the product's
reason to exist.

## Developer Problem Validation

### Broad Developer Friction

**Fact:** Atlassian's 2025 survey included 3,500 developers and managers across
six countries. Ninety percent of surveyed developers reported losing at least six
hours per week to non-coding inefficiencies. Finding information and switching
between tools were among the leading sources of lost time. [Atlassian Developer
Experience Report 2025](https://www.atlassian.com/blog/developer/developer-experience-report-2025)

**Limit:** This survey did not measure browser-debugging demand or demand for
Chroma. It supports only the broader claim that reducing context collection and
transfer is a meaningful developer-experience problem.

**Fact:** Stack Overflow's analysis of more than 65,000 responses to its 2024
Developer Survey reported that 66% cited distrust of AI output and 63% cited
missing codebase, architecture, or organizational context as concerns. More than
60% reported spending at least 30 minutes per day searching for answers. [Stack
Overflow analysis of AI coding tools](https://stackoverflow.blog/2024/09/23/where-developers-feel-ai-coding-tools-are-working-and-where-they-re-missing-the-mark/)

**Implication:** Agent-friendly JSON is insufficient. Evidence must also explain
which browser, tab, and observation window produced it, along with anything known
to be missing.

**Fact:** MDN recommends a minimal reproduction when discussing a browser bug and
asks reports to include browser version, expected and actual behavior, and
screenshots. [MDN: When and how to file bugs with browsers](https://developer.mozilla.org/en-US/docs/Learn_web_development/Howto/Web_mechanics/File_browser_bugs)

**Fact:** Chromium's network-diagnostic workflow is to start recording, reproduce
the problem in another tab, stop recording, and send the complete log to the
investigator. It also warns that logs can contain sensitive information. [Chromium:
How to capture a NetLog dump](https://www.chromium.org/for-testers/providing-network-details/)

**Fact:** Playwright tracing records DOM snapshots, screenshots, network activity,
console output, and timing together for failure diagnosis and team sharing.
[Playwright CLI tracing](https://playwright.dev/agent-cli/commands/tracing)

**Implication:** The evidence categories are already established. Chroma's useful
claim is narrower: before starting a test suite or broad DevTools investigation,
it turns one local-Chrome reproduction into a small, safe, provenance-bearing
shell artifact.

### Community Language and Counterevidence

The Reddit and Hacker News threads below are qualitative signals, not market-size
evidence. Some are project announcements with small samples. They are useful for
discovering the words developers use, the alternatives they suggest, and the
claims that trigger skepticism.

**Observation:** A developer on r/webdev described spending an hour diagnosing a
user problem and wished DevTools could export the relevant Console and Network
information. Replies immediately suggested HAR export, Chrome Recorder, Sentry,
and application instrumentation. [r/webdev: DevTools exports](https://www.reddit.com/r/webdev/comments/11mzrn5/dev_tools_you_know_whatd_be_really_cool_exports/)

This is evidence for the friction, but also evidence that a generic "export
DevTools" claim is weak. Chroma must explain why a cross-surface local reproduction
bundle is different from a network-only HAR file or production telemetry.

**Observation:** Threads in r/ClaudeAI and r/cursor describe manually pasting
console output and screenshots into coding agents. Some developers combine a
browser MCP with a log pipe to reduce the work. Others point out that direct
browser control removes the handoff entirely. [r/ClaudeAI debugging thread](https://www.reddit.com/r/ClaudeAI/comments/1lxg1ks/this_is_the_way_to_use_claude_code_for_debugging/)
and [r/cursor browser-context thread](https://www.reddit.com/r/cursor/comments/1vmm3yx/how_do_you_send_browser_context_to_cursorclaude/)

**Observation:** A direct competitor named `peek` was announced on r/SideProject
with the same origin story: repeatedly copying console errors, click descriptions,
and failed requests into an agent. It combines a Chrome extension, rrweb recording,
a local MCP server, SQLite, and Playwright reproduction generation. The author
emphasizes local-first operation, no account, no telemetry, and origin-based
permissions. [r/SideProject announcement](https://www.reddit.com/r/SideProject/comments/1tvokj8/after_pasting_console_logs_into_my_ai_coding/)
and [rrweb-stack source](https://github.com/Cubenest/rrweb-stack)

Its launch received little visible engagement and the repository had seven stars
at the September 2026 recheck despite a close problem statement, local-first
architecture, npm packages, GIFs, and stronger session replay. This is important
counterevidence: pain language, privacy, and feature breadth do not produce stars
without a fast first experience and a sharply visible artifact payoff.

**Observation:** ProofShot packages actions, screenshots, video, console output,
and server logs into a reviewable pull-request artifact. Its March 2026 Show HN
launch received 161 points and 106 comments, and the repository had 855 stars at
the September recheck. Discussion repeatedly challenged it to explain why
Playwright CLI was insufficient; positive reactions centered on reviewable proof
and before/after evidence rather than browser control. [Show HN discussion](https://news.ycombinator.com/item?id=47499672)
and [ProofShot source](https://github.com/AmElmo/proofshot)

**Observation:** BrowserTools MCP 2.0 now offers setup diagnosis, console and
failed-network queries, tab identity, credential scrubbing, and local screenshots.
It had about 7,300 stars at the September recheck. Its durable wedge is access to
the already-authenticated Chrome session through an extension, not the individual
diagnostic primitives. [BrowserTools MCP](https://github.com/AgentDeskAI/browser-tools-mcp)

**Observation:** An r/ExperiencedDevs discussion emphasizes combining logs,
traces, breakpoints, hypotheses, and reproductions according to the problem. The
dominant counterpoint is that debugging has no universal method. [r/ExperiencedDevs:
How do you debug?](https://www.reddit.com/r/ExperiencedDevs/comments/1so7x49/how_do_you_debug/)

Chroma should not claim to find a root cause or fix a bug automatically. It
preserves a bounded reproduction for the next diagnostic step.

**Observation:** Browser-MCP discussions on Hacker News and Reddit contain both
complaints about context use, latency, extension telemetry, and installation
complexity, and strong praise for live debugging. [Ask HN: Playwright MCP
Unusable?](https://news.ycombinator.com/item?id=45764043), [Show HN: Browser
MCP](https://news.ycombinator.com/item?id=43613194), and [r/AI_Coders browser-to-agent
thread](https://www.reddit.com/r/AI_Coders/comments/1vn5c5a/whats_the_most_annoying_step_between_your_browser/)

These signals lead to six copy principles:

1. Do not lead with "an AI can see your browser." Strong MCP and CLI tools already do that.
2. Name the specific moment between a human reproducing a bug and someone automating it.
3. Lead with `no account`, `no cloud`, `no extension`, `no MCP server`, and ordinary JSON, Markdown, and PNG files.
4. Say plainly that Chroma is unnecessary when a live agent can reproduce and verify the issue reliably in the same session.
5. Do not promise automatic diagnosis or repair. Chroma preserves and hands off evidence.
6. Acknowledge when HAR, NetLog, Sentry, Playwright, or DevTools is the better tool.

### Validated Job Story and Public Copy

> When a local web app breaks in Chrome, I want to preserve the evidence from one
> reproduction so I do not have to search Console and Network again or reconstruct
> the situation for the next person.

The earlier copy-paste headline accurately described the pain, but `peek` used
nearly identical language first and did not gain meaningful distribution. The
public headline therefore moves to the differentiated artifact outcome:

> **Reproduce once. Close Chrome. Keep the evidence.**

The supporting explanation is concrete about the evidence and output:

> Start Chroma, reproduce the web app bug once, and keep page state, console
> errors, failed requests, browser identity, and a screenshot as ordinary
> evidence files.

The competitive comparison stays to one sentence:

> Use Playwright to automate a known flow. Use DevTools or a browser MCP for live
> investigation. Use Chroma when the evidence must outlive that session and move
> between a human, shell, issue, or coding agent.

## Competitive Landscape

| Tool | Primary shape | Existing Chrome | Observation surface | Shell or machine output | What Chroma should not duplicate |
| --- | --- | --- | --- | --- | --- |
| Chrome DevTools MCP and CLI | Official MCP server and experimental daemon-backed CLI | URL or WebSocket endpoint; Chrome 144+ auto-connect | snapshot, console, network, screenshot, traces, Lighthouse, heap | CLI supports raw JSON | one CLI command per MCP tool |
| Playwright CLI | Stateful CLI for coding agents | CDP URL or channel; extension attachment | snapshots, actions, console, requests, traces, recording, video | file and stdout oriented | a general browser automation and test CLI |
| Playwright MCP | Accessibility-tree MCP server | CDP endpoint or extension | actions, console, network detail, traces | structured MCP results | long, stateful agent loops |
| BrowserTools MCP | Chrome extension plus local MCP | the user's current DevTools-enabled tab | console, failed network, screenshots, audits, tab identity | structured MCP results and local files | the authenticated daily-browser and live-agent use case |
| ProofShot | agent-run browser proof and review artifacts | managed automation flow | actions, screenshots, video, console and server logs | pull-request-oriented artifact | proof of an agent's finished change |
| peek / rrweb-stack | Chrome extension plus local MCP | user activates the extension | DOM and action history, console, failed requests, Playwright reproduction | MCP plus local SQLite | generic "let the agent read the browser" positioning |
| Puppeteer | JavaScript library and browser-management CLIs | `puppeteer.connect()` | broad automation and CDP access through APIs | application-defined | a thin shell around a library API |
| chrome-remote-interface | Low-level CDP library, target CLI, and REPL | localhost:9222 or a supplied endpoint | arbitrary CDP commands and events | raw objects and REPL | a general CDP shell |
| aeroxy/chrome-devtools-cli | Rust direct-CDP CLI and daemon | discovers Chrome or Edge; accepts a WebSocket endpoint | snapshots, actions, buffered console and network events, heap, emulation | JSON and TOON | lightweight direct CDP, daemon, or stable aliases as the entire pitch |
| browser-debugger-cli (`bdg`) | Agent-oriented direct-CDP CLI | persistent session | raw CDP, DOM and network wrappers, HAR, memory tools | JSON by default and semantic exit codes | self-discovery, raw CDP, or token efficiency as the entire pitch |
| chrome-cdp-cli (`cdp`) | Direct-CDP automation CLI | localhost:9222 | evaluation, DOM, actions, and log or network following | text and JSON | a general `eval` and selector-action CLI |

### Limit of the `cdp-shell` Label

**Observation:** This research did not find one widely adopted canonical project
named `cdp-shell`. The bundled `inspect` REPL from `chrome-remote-interface` is
used as the clearest long-running primary example. In this document, "CDP shell"
means the tool category that interactively forwards raw CDP commands and events,
not a specific brand.

## Findings by Tool

### Chrome DevTools MCP and Experimental CLI

The official project controls and inspects live Chrome. It includes performance
insights, network and console inspection, screenshots, accessibility snapshots,
Lighthouse, and heap snapshots. Automation uses Puppeteer. The same package now
contains an experimental `chrome-devtools` CLI whose first command starts a
background MCP daemon and browser; later commands reuse that state. It can emit
raw JSON. [Official README](https://github.com/ChromeDevTools/chrome-devtools-mcp),
[tool reference](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md),
and [CLI documentation](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/cli.md)

Existing browsers can be reached through `--browser-url`, `--ws-endpoint`, or,
for Chrome 144 and later, user-approved auto-connect. The documentation warns
that browser contents become accessible to the client, that an open remote
debugging port is sensitive, and that usage statistics are enabled by default
but can be disabled. [Connection documentation](https://github.com/ChromeDevTools/chrome-devtools-mcp#connecting-to-a-running-chrome-instance)

**Product implication:** This is the strongest direct alternative. "DevTools in
a CLI" is not enough. Chroma must win on small diagnostic answers, provenance,
bounded persistence, and a transferable report.

### Playwright CLI and Playwright MCP

Playwright CLI explicitly targets coding agents and claims lower context overhead
than MCP. It keeps browser state by session and supports persistent profiles. Its
commands cover snapshots, actions, screenshots, console messages, requests,
tracing, recording, video, and network mocking. It can attach through CDP or a
Chrome extension. [Playwright CLI README](https://github.com/microsoft/playwright-cli)

Playwright MCP uses accessibility snapshots for structured browser interaction.
It includes console and network tools and can attach through CDP or an extension.
It offers origin and file-access guardrails but explicitly says the server is not
a security boundary. [Playwright MCP README](https://github.com/microsoft/playwright-mcp)

**Product implication:** Chroma should not compete on command count, locators,
cross-browser automation, or long-lived interactive exploration. Each shell call
should instead produce a compact result that works in a pipe, CI job, or issue.

### Playwright Library CDP Connection

`chromium.connectOverCDP()` attaches to a Chromium browser through an HTTP or
WebSocket endpoint. Playwright warns that this is significantly lower fidelity
than its own protocol and that browsers launched with unexpected flags may lose
functionality. It recommends a separate user-data directory instead of automating
the default Chrome profile. [Playwright `connectOverCDP` API](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)

**Product implication:** Direct CDP gives Chroma tighter control over Chrome's
observation semantics, with the explicit cost of being Chrome-only.

### Puppeteer

Puppeteer is a high-level JavaScript library for Chrome and Firefox through CDP
or WebDriver BiDi. `puppeteer.connect()` attaches to an existing browser.
`@puppeteer/browsers` manages browser binaries, while `@puppeteer/replay` replays
or transforms DevTools Recorder flows. [Puppeteer README](https://github.com/puppeteer/puppeteer),
[`connect()` API](https://pptr.dev/api/puppeteer.puppeteer.connect), and
[`@puppeteer/replay`](https://github.com/puppeteer/replay)

**Product implication:** Puppeteer could be an implementation component, but
exposing the library through shell commands would not create a product boundary.

### chrome-remote-interface and Direct-CDP CLIs

`chrome-remote-interface` is a small JavaScript abstraction over CDP commands and
notifications. Its bundled client manages targets and offers an autocomplete REPL
for arbitrary protocol methods and events. CDP tip-of-tree changes frequently and
does not guarantee backward compatibility; browser and target metadata are exposed
through `/json/version` and `/json/list`. [chrome-remote-interface README](https://github.com/cyrus-and/chrome-remote-interface)
and [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)

Community tools prove that lightweight direct CDP, persistent connections,
machine-readable output, stable aliases, event buffers, semantic exit codes, and
raw-protocol discovery already exist:

- [aeroxy/chrome-devtools-cli](https://github.com/aeroxy/chrome-devtools-cli)
- [browser-debugger-cli](https://github.com/szymdzum/browser-debugger-cli)
- [chrome-cdp-cli](https://github.com/nicoster/chrome-devtools-cli)

**Product implication:** Raw CDP can become an explicit escape hatch later. It
should not be the center of Chroma because it makes the user manage domains,
enable order, event lifetime, and target sessions directly.

## Product Requirements from the Gaps

### `doctor`: Diagnose a Cause

`doctor` should independently check:

- the supported Node version and Chrome executable;
- Chrome version and the relevant Chrome 136 and 144 connection boundaries;
- whether the endpoint is loopback, reachable, and answers `/json/version`;
- protocol and browser identity;
- page-target discovery and attachment;
- separation between a managed profile and the default daily profile;
- stale process or session state;
- state-directory writability, privacy, and corruption;
- monitor readiness and event-store health.

Each check returns `pass`, `warn`, `fail`, or `skipped`. The command derives the
next action from the earliest causal failure instead of dumping generic setup tips.

### `errors`: Normalize Failures

The command combines `Runtime.exceptionThrown`, error-level
`Runtime.consoleAPICalled`, and relevant `Log.entryAdded` records into one temporal
schema. Duplicate messages and stacks should be fingerprinted while retaining
count, first and last occurrence, source, URL, line, and column. Finding page
errors is data; a Chroma execution failure is an exit-status error.

### `network --failed`: Separate Failure Types

At minimum, the output distinguishes:

- HTTP failures that received a 4xx or 5xx response;
- transport failures such as DNS, TLS, CORS, cancellation, or blocking errors.

Records preserve request identity, method, URL, resource type, status or error
text, initiator summary, and timing. Headers, cookies, and bodies stay out of the
default report unless an explicit future policy safely adds them.

### Observation Is the Core Technical Contract

CDP errors and network activity are event streams. A tool sees only events after
it attaches and enables the relevant domains. Chroma therefore records monitor
start, per-target observation start, readiness, navigation boundaries, selected
target, buffer drops, corruption, and restart discontinuities.

Queries use independent cursors so reading `errors`, `network`, or `report` does
not destroy evidence needed by another command. The event store is byte-bounded,
and missing evidence is reported rather than implied away.

### `report`: A Transferable Evidence Packet

A report is a stable manifest and artifact directory, not an unbounded diagnosis:

```text
report/
  manifest.json
  summary.md
  page.json
  snapshot.txt
  screenshot.png
  errors.json
  failed-network.json
```

The manifest includes CLI, schema, browser, and protocol versions; target and
observation identity; collection steps; partial failures; redaction policy; and
missing-evidence reasons. Cookie, authorization, query-secret candidates, and
request or response body data are excluded or redacted by default.

## Shell-Native Contract

- Human-readable output may adapt to a TTY; `--json` writes one JSON value to stdout.
- Progress, warnings, and recovery guidance go to stderr.
- JSON responses share `schemaVersion`, `command`, `ok`, `data`, `warnings`, and `error`.
- Actions require an unambiguous target and a current, browser-bound snapshot reference.
- A closed pipe exits without an internal stack trace.
- Color is TTY-only and respects `NO_COLOR`.
- Timeouts and stable machine error codes are part of the public contract.
- Exit status describes CLI execution. Page findings remain data.

An early research proposal considered many specialized exit codes. The accepted
ADR and implementation intentionally use the smaller stable `0` through `3`
contract documented in the README and validation report.

## Security Boundary

Chrome 136 and later ignore remote-debugging flags against the default data
directory and require a separate `--user-data-dir`. Chrome recommends Chrome for
Testing for automation. [Chrome remote-debugging security change](https://developer.chrome.com/blog/remote-debugging-port)

Chroma's default policy is therefore:

- launch into a managed isolated profile;
- accept loopback CDP endpoints by default and require explicit opt-in for remote endpoints;
- redact credentials from endpoint and WebSocket URLs;
- warn when a user supplies a potentially personal profile;
- omit authentication headers and payload bodies from default reports;
- keep arbitrary JavaScript, file transfer, and raw CDP out of the safe MVP surface;
- make no product telemetry or external service call by default.

Chroma is not a sandbox or a security boundary. CDP access grants broad control
over the attached browser profile, and screenshots or accessibility text can
still contain sensitive page content that requires human review.

## Intentionally Out of Scope

- a cross-browser test runner, assertion language, retries, sharding, or trace viewer;
- complete exposure of hundreds of CDP methods;
- coordinate-based vision automation;
- a long-running autonomous-agent MCP loop;
- replacement of the full performance, Lighthouse, or heap-analysis surface;
- frictionless automation of a signed-in daily browser profile.

These exclusions make the local reproduction and evidence-handoff job legible.

## Tradeoffs

| Choice | Benefit | Cost and response |
| --- | --- | --- |
| Chrome and CDP only | direct control of DevTools event semantics and real Chrome | no Firefox or WebKit; recommend Playwright when those matter |
| small, opinionated commands | a compact learning, output, and testing contract | rare protocol features are unavailable; consider a later explicit escape hatch |
| background observer | preserves console and network evidence between commands | lifecycle complexity; expose health through `doctor` and provide ownership-safe `stop` |
| non-destructive cursors | reports and focused queries can share evidence | bounded storage and drop counters are required |
| default redaction | safer artifact sharing | some diagnostic detail may be hidden; sensitive expansion must be explicit and warned |
| stable JSON schema | reliable use from `jq`, CI, and agents | schema-version and contract-test maintenance |
| read-mostly surface | lower mistake risk and a clear diagnostic purpose | a smaller automation surface; actions remain reproduction aids |

## MVP Priorities and Acceptance

This research originally proposed the following order. The implemented state and
current execution evidence are recorded in [`validation.md`](validation.md).

1. **Connection reliability:** `doctor`, `launch`, `connect`, and `tabs` identify causal failures, use isolated profiles, and select targets safely.
2. **Observation reliability:** `errors` and `network --failed` disclose pre-attach gaps and distinguish HTTP from transport failures.
3. **Evidence transfer:** `report`, `screenshot`, and `snapshot` create bounded, redacted, same-boundary artifacts with provenance.
4. **Lightweight reproduction:** `click`, `fill`, and `press` accept current references and reject stale or ambiguous targets.
5. **Common contract:** JSON shape, stderr separation, exits, timeouts, and broken-pipe behavior are tested across commands.

## Open-Source Adoption

The README should demonstrate value in under 30 seconds with a broken local
fixture and a short workflow:

```sh
chroma doctor
chroma connect
chroma errors
chroma network --failed
chroma report --output .chroma/report
```

The report example should connect an API failure, its nearby user action, a
simultaneous uncaught exception, and a screenshot without overstating causality.
The choice guide should be honest:

- use Playwright for test suites and cross-browser automation;
- use Chrome DevTools MCP for deep live investigation, performance, heap, or Lighthouse work;
- use `bdg` or chrome-remote-interface for arbitrary CDP commands;
- use Chroma to preserve and hand off one local-app reproduction.

## Primary Sources

- [Chrome DevTools MCP README](https://github.com/ChromeDevTools/chrome-devtools-mcp)
- [Chrome DevTools MCP CLI](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/cli.md)
- [Chrome DevTools MCP tool reference](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md)
- [Chrome DevTools CLI skill](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/skills/chrome-devtools-cli/SKILL.md)
- [Playwright CLI README](https://github.com/microsoft/playwright-cli)
- [Playwright MCP README](https://github.com/microsoft/playwright-mcp)
- [Playwright `connectOverCDP` API](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)
- [Puppeteer README](https://github.com/puppeteer/puppeteer)
- [Puppeteer `connect()` API](https://pptr.dev/api/puppeteer.puppeteer.connect)
- [`@puppeteer/browsers` README](https://github.com/puppeteer/puppeteer/blob/main/packages/browsers/README.md)
- [`@puppeteer/replay` README](https://github.com/puppeteer/replay)
- [chrome-remote-interface README](https://github.com/cyrus-and/chrome-remote-interface)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [Chrome remote-debugging security change](https://developer.chrome.com/blog/remote-debugging-port)
- [aeroxy/chrome-devtools-cli README](https://github.com/aeroxy/chrome-devtools-cli)
- [browser-debugger-cli README](https://github.com/szymdzum/browser-debugger-cli)
- [chrome-cdp-cli README](https://github.com/nicoster/chrome-devtools-cli)
- [BrowserTools MCP README](https://github.com/AgentDeskAI/browser-tools-mcp)
- [ProofShot source](https://github.com/AmElmo/proofshot)
- [ProofShot Show HN discussion](https://news.ycombinator.com/item?id=47499672)

## Decisions and Open Questions

The following MVP decisions are accepted in the ADR and implementation:

- a managed isolated profile by default with an explicit `--profile` override;
- a detached observer with bounded JSONL evidence across commands;
- one shared observation boundary for report collection;
- mandatory denylist and key-pattern redaction before persistence;
- query exit `0` regardless of findings, with operation, usage, and capability failures mapped to `1` through `3`;
- `schemaVersion: 1` with additive-compatible field evolution.

Open questions:

- whether to add explicit support for Chrome's user-approved remote-debugging auto-connect alongside port-based attachment;
- how long schema v1 compatibility should be maintained and how a future major migration should work.
