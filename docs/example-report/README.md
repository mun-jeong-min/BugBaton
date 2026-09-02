# Chroma diagnostic report

- Bundle status: **complete**
- Observation coverage: **best effort**
- Complete since navigation: **no**
- Generated: 2026-09-02T12:59:56.058Z

## Bug claim

**The request fails after one click**

- Expected: The request completes successfully.
- Actual: The endpoint returns HTTP 503 and the page logs an error.

Page: **Chroma CDP fixture**

URL: `http://127.0.0.1:4173/`

- Observed errors/warnings: 3
- Failed/HTTP-error requests: 1
- Recorded reproduction actions: 4
- Accessibility nodes: 21
- Screenshot: screenshot.png
- Evidence boundary: 8145bc941cbec91009a0
- Observation monitor at report boundary: running since 2026-09-02T12:57:55.491Z

## Reproduction timeline

- `2026-09-02T12:58:13.700Z` **click** on `button #7 type=button`
- `2026-09-02T12:58:13.704Z` **error** Failed to load resource: the server responded with a status of 503 (Service Unavailable)
- `2026-09-02T12:58:13.704Z` **HTTP 503** `GET http://127.0.0.1:4173/api/http-error`
- `2026-09-02T12:58:13.706Z` **error** fixture:request-failed Error: HTTP 503 Service Unavailable     at request (http://127.0.0.1:4173/app.js:51:13)
- `2026-09-02T12:58:14.204Z` **click** on `button #9 type=button`
- `2026-09-02T12:58:14.204Z` **error** fixture:deliberate-console-error Object
- `2026-09-02T12:58:14.959Z` **input** on `input #4` (length=14)
- `2026-09-02T12:58:15.317Z` **submit** on `form`

> Observation starts after `chroma launch`, `chroma connect`, or `chroma capture`, so the bundle can be structurally complete without claiming gap-free browser history. A `capture-receipt.json` file records verified shutdown for one-command captures. Temporal proximity does not prove causality. Screenshots and accessible names may contain sensitive page content; review before sharing.
