# International launch scorecard

Date: 2026-09-03

This is a release gate, not a claim of product-market fit. A category reaches
9 only when a named artifact or repeatable check supports it. Scores below 9
stay visible instead of being rounded up.

| Category | Score | Evidence | Remaining condition |
| --- | ---: | --- | --- |
| Problem resonance | 9.1 | Independent developer surveys, browser bug-report guidance, and community handoff examples in [`research.md`](research.md) | Validate usefulness on representative external projects after launch. |
| Product clarity | 9.4 | “Pass the bug, not the browser,” a narrow use/avoid comparison, and one artifact-centered job | Keep CDP and generic automation language out of the lead. |
| First-use experience | 9.4 | Short npm demo command, explicit evidence requirement, automatic port/output choice, and actionable doctor checks | Validate the cold-start instructions with developers outside the project. |
| Functional reliability | 9.4 | 54 automated checks; three real-Chrome flows on Linux, macOS, and Windows; identity, stale-ref, collision, loss, and cleanup fault coverage | Expand browser-version coverage as compatibility changes. |
| Trust and privacy | 9.4 | Local-only default, loopback CDP, isolated profile, pre-persistence redaction, bounded loss disclosure, hashes, and safe shutdown | Continue to require manual screenshot/content review. |
| Differentiated handoff | 9.3 | Ordinary JSON/Markdown/PNG bundle, one evidence boundary, value-free action trail, receipt, and offline `verify` | Test the report with maintainers who did not capture it. |
| International distribution | 9.3 | Public `bugbaton` npm package, matching GitHub release, English-only repository, zero runtime dependencies, clean-prefix install smoke, and three-OS quality CI | Add another distribution channel only when demand justifies its maintenance cost. |

The release threshold is all categories at 9.0 or higher. Version 0.1.0 clears
that threshold with a public package and release that can be installed by name.
