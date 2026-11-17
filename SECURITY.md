# Security policy

## Supported versions

SS14 Studio is alpha software. Security fixes are applied to the latest `0.2.x`
release and the `main` branch. Older versions may not receive fixes.

## Reporting a vulnerability

Do **not** open a public issue for a security problem.

Report it privately through GitHub's security advisory form:

<https://github.com/CrazyPhantom779/ss14-studio/security/advisories/new>

Include:

- a description of the issue and its impact;
- affected component: VS Code extension, shared UI, core parser, Rider sidecar,
  Kotlin host, Gradle build or packaging;
- reproduction steps or a minimal proof of concept;
- the SS14 Studio version and IDE version;
- whether the issue requires opening an untrusted workspace or file.

Please remove secrets, access tokens and private repository contents from the
report. You will receive an acknowledgement when a maintainer is available. This
is a volunteer project, so response times are not guaranteed.

## Scope

In scope:

- The VS Code extension host and webview bridge.
- The Rider Kotlin host, JCEF bridge and Node sidecar.
- Parsing, editing and file-write paths for YAML, XAML, RSI metadata and PNGs.
- The loopback HTTP/SSE server, token handling and path containment.
- Build, packaging and release workflows.

Out of scope:

- Vulnerabilities in Space Station 14, RobustToolbox, Rider, VS Code, Node.js or
  third-party dependencies that are already reported upstream. Report those to
  the respective project.
- Malicious content that requires the user to run arbitrary code or disable
  workspace trust.
- Issues caused by installing a modified plugin or VSIX from an untrusted
  source.

## Security design

- The Rider sidecar binds to `127.0.0.1` and requires a per-launch token for
  API calls, SSE and bootstrap.
- File operations are checked against the configured project roots where
  applicable, and the static server refuses paths outside its web root.
- Untrusted VS Code workspaces run read-only.
- The project has no telemetry, accounts or hidden network calls.
- Writes are explicit user actions; XAML changes show a diff first.
- No AI watermark or remote service is injected into user files.

## AI-generated code

This project is AI-generated and human-reviewed. See
[`AI-GENERATED.md`](./AI-GENERATED.md) for the review policy and limitations.
AI assistance does not change the security reporting process above.
