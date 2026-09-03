# International launch scorecard

Date: 2026-09-03

This is a release gate, not a claim of product-market fit. A category reaches
9 only when a named artifact or repeatable check supports it. Scores below 9
stay visible instead of being rounded up.

| Category | Score | Evidence | Remaining condition |
| --- | ---: | --- | --- |
| Problem resonance | 9.1 | Independent developer surveys, browser bug-report guidance, and community handoff examples in [`research.md`](research.md) | Validate usefulness on representative external projects after launch. |
| Product clarity | 9.4 | “Pass the bug, not the browser,” a narrow use/avoid comparison, and one artifact-centered job | Keep CDP and generic automation language out of the lead. |
| First-use experience | 9.2 | One-command local demo, explicit evidence requirement, automatic port/output choice, and actionable doctor checks | Replace the pre-release GitHub command with the npm command. |
| Functional reliability | 8.8 | 54 automated checks; three local real-Chrome flows; identity, stale-ref, collision, loss, and cleanup fault coverage | Public Windows real-Chrome CI must pass. |
| Trust and privacy | 9.4 | Local-only default, loopback CDP, isolated profile, pre-persistence redaction, bounded loss disclosure, hashes, and safe shutdown | Continue to require manual screenshot/content review. |
| Differentiated handoff | 9.3 | Ordinary JSON/Markdown/PNG bundle, one evidence boundary, value-free action trail, receipt, and offline `verify` | Test the report with maintainers who did not capture it. |
| International distribution | 8.6 | English-only repository, available distinct name, zero runtime dependencies, packed install smoke, and three-OS quality CI | Publish and read back the first npm release; create and verify the matching GitHub release. |

The release threshold is all categories at 9.0 or higher. Reliability remains
below it until the new Windows lane passes, and distribution remains below it
until the public package and release exist and can be installed by name.
