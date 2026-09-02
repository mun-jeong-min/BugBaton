# Chroma diagnostic report

Status: **complete**  
Generated: 2026-09-02T12:18:54.402Z

Page: **Chroma CDP fixture**  
URL: `http://127.0.0.1:4173/`

- Observed errors/warnings: 3
- Failed/HTTP-error requests: 1
- Recorded reproduction actions: 4
- Accessibility nodes: 21
- Screenshot: screenshot.png
- Evidence boundary: 16877668cf84c36a7ecd
- Observation monitor: running since 2026-09-02T12:17:20.541Z

## Reproduction timeline

- `2026-09-02T12:18:43.146Z` **click** on `button #7 type=button`
- `2026-09-02T12:18:43.153Z` **error** Failed to load resource: the server responded with a status of 503 (Service Unavailable)
- `2026-09-02T12:18:43.153Z` **HTTP 503** `GET http://127.0.0.1:4173/api/http-error`
- `2026-09-02T12:18:43.154Z` **error** fixture:request-failed Error: HTTP 503 Service Unavailable     at request (http://127.0.0.1:4173/app.js:51:13)
- `2026-09-02T12:18:43.649Z` **click** on `button #9 type=button`
- `2026-09-02T12:18:43.650Z` **error** fixture:deliberate-console-error Object
- `2026-09-02T12:18:44.404Z` **input** on `input #4` (length=14)
- `2026-09-02T12:18:44.658Z` **submit** on `form`

> Observation is best effort and starts after `chroma launch`, `chroma connect`, or `chroma capture`. Temporal proximity does not prove causality. Screenshots and accessible names may contain sensitive page content; review before sharing.
