# Contributing to BugBaton

Thanks for helping make local web diagnosis faster and more trustworthy.

BugBaton's promise is simple: pass the bug, not the browser.
It is a local flight recorder for a browser bug a developer can reproduce but has
not automated, preserving ordinary evidence files that can move between a person,
shell, issue, or agent.

## Start with the product boundary

BugBaton is an observation-first diagnostics CLI with a few reproduction actions.
It is not a general browser automation framework. A strong contribution improves
one of these properties:

- causal setup diagnosis;
- observation completeness and honest provenance;
- normalization of errors or failed requests;
- safe, deterministic target/ref selection;
- redaction, bounded retention, or artifact integrity; or
- a shorter path from a local failure to a reviewable evidence packet.

Before adding a broad automation verb, explain why `click`, `fill`, and `press`
cannot reproduce the diagnostic case and why an existing automation tool is not
the better layer.

## Local setup

Requirements are Node.js 22+ and Chrome/Chromium. There are no runtime npm
dependencies.

```sh
npm install
npm run check
npm run test:e2e
```

`npm run check` is the fast gate. `npm run test:e2e` launches an isolated,
headless Chrome profile and a loopback-only fixture. It never uses the default
Chrome profile. Set `CHROME_PATH` when automatic discovery does not find your
browser.

## Change and evidence expectations

1. Add the smallest fixture behavior that reproduces the case.
2. Write a focused unit or fixture test when the contract is deterministic.
3. For CDP, monitor, lifecycle, or artifact changes, run the real-Chrome lane.
4. Record any platform-specific limitation instead of hiding a partial result.
5. Keep human stdout concise and update the versioned JSON result at the same time.

Bug reports are most useful with the BugBaton version, Node/Chrome versions, exact
command and exit code, the relevant JSON error code, and a minimal local page.
Review reports before attaching them: screenshots, accessible names, titles, and
console prose can contain secrets even though known credentials are redacted.

## Invariants reviewers protect

- CDP launch stays loopback-only; remote endpoints require explicit opt-in.
- Default launch profiles stay isolated from everyday Chrome data.
- Mutation never guesses after an ambiguous tab, selector, or stale ref.
- Redaction happens before durable append, and data loss degrades health.
- Evidence from different browser instances or endpoints never mixes.
- Existing screenshot/report outputs are never silently overwritten.
- The package stays zero-runtime-dependency unless a measured need justifies a
  new supply-chain and install cost.

Do not add publish, deployment, telemetry, tunnel, or upload behavior as part of
an unrelated change.
