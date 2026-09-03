# Security Policy

BugBaton connects through the Chrome DevTools Protocol, which grants broad control
over the attached browser profile. Treat the endpoint and every captured artifact
as sensitive.

## Reporting a Vulnerability

Use [GitHub private vulnerability reporting](https://github.com/mun-jeong-min/BugBaton/security/advisories/new).
Do not open a public issue for a vulnerability, and do not attach a real BugBaton
report until the maintainer confirms a private transfer method.

Include the affected revision or version, operating system, Node and Chrome
versions, the smallest safe reproduction, and the security impact. Remove tokens,
cookies, private URLs, screenshots, page text, and user data.

## Supported Versions

Until the first npm release, the latest commit on `main` is the only supported
revision. Security fixes will be documented in GitHub releases once versioned
packages are published.

## Security Boundary

- BugBaton is not a sandbox and does not authenticate a CDP endpoint.
- Managed launches bind CDP to loopback and use an isolated profile by default.
- Non-loopback endpoints require explicit `--allow-remote` opt-in.
- Known credentials and sensitive query values are redacted before event persistence.
- Cookies, authorization headers, storage values, request and response bodies, and fill values are not collected by default.
- Manual action capture records element category and input length, never input text.
- Screenshots, page titles, accessible names, URLs, and console prose can still contain private information.
- Reports remain local. BugBaton does not upload artifacts, expose a tunnel, or send telemetry.

Always review the complete report directory before sharing it.
