# BugBaton diagnostic report

- Bundle status: **complete**
- Demo evidence requirement: **met** (At least one recorded action, browser error, and failed or HTTP-error request.)
- Observation coverage: **best effort**
- Complete since navigation: **no**
- Generated: 2026-09-03T02:01:26.339Z

## Bug claim

**The request fails after one click**

- Expected: The request completes successfully.
- Actual: The endpoint returns HTTP 503 and the page logs an error.

Page: **BugBaton capture demo**

URL: `http://127.0.0.1:63484/`

- Observed errors/warnings: 3
- Failed/HTTP-error requests: 1
- Recorded reproduction actions: 4
- Accessibility nodes: 7
- Screenshot: screenshot.png
- Evidence boundary: 7ea5ed073f0192a6b893
- Observation monitor at report boundary: running since 2026-09-03T02:01:21.728Z

## Verify this bundle

From this directory, run `bugbaton verify .`. This checks the compatible report header, safe attachment paths, declared file sizes and SHA-256 hashes, and capture-receipt consistency. It does not prove who created the bundle.

## Reproduction timeline

- `2026-09-03T02:01:22.443Z` **click** on `button #1 type=button`
- `2026-09-03T02:01:22.447Z` **error** Failed to load resource: the server responded with a status of 503 (Service Unavailable)
- `2026-09-03T02:01:22.447Z` **HTTP 503** `GET http://127.0.0.1:63484/api/failure`
- `2026-09-03T02:01:22.450Z` **error** demo: request failed Error: HTTP 503 Service Unavailable     at HTMLButtonElement.\<anonymous\> (http://127.0.0.1:63484/app.js:5:29)
- `2026-09-03T02:01:22.847Z` **click** on `button #2 type=button`
- `2026-09-03T02:01:22.847Z` **error** demo: deliberate console error
- `2026-09-03T02:01:23.054Z` **submit** on `form`
- `2026-09-03T02:01:23.301Z` **input** on `input #3` (length=14)

> Observation starts after `bugbaton launch`, `bugbaton connect`, or `bugbaton capture`, so the bundle can be structurally complete without claiming gap-free browser history. A `capture-receipt.json` file records verified shutdown for one-command captures. Temporal proximity does not prove causality. Screenshots and accessible names may contain sensitive page content; review before sharing.
