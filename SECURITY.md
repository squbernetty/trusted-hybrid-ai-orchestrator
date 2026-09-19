# Security Policy

## Supported status

The Trusted Hybrid AI Orchestrator is currently a public-alpha project.

The alpha is not represented as production-ready and should not be used for unattended consequential autonomy.

Security fixes are handled on a best-effort basis while the runtime contract and trust boundaries continue to mature.

## UI and control-plane boundary

The qualified N16 UI Alpha is a local, read-only, single-operator observation client. The browser is treated as untrusted presentation software and is not part of the trusted transition authority.

The control plane exposes qualified read-only task and event observations. It must not translate browser access into trusted mutation, execution, provider, approval, commit, release, or other consequential authority.

The local deployment model assumes loopback/same-origin use. It does not claim remote multi-user isolation or a browser authorization model for write operations.

A compromised browser or privileged extension may falsify presentation or disclose information visible to that browser. It must not, by itself, be able to create a trusted state transition.

Any future writable control plane is outside the N16 trust model and requires a separately designed, reviewed, and qualified authority architecture.

## Reporting a vulnerability

Do not disclose suspected vulnerabilities, exploit details, credentials, sensitive project data, or affected-system information in a public issue.

For the public repository, use GitHub Private Vulnerability Reporting when it is available:

1. Open the repository Security section.
2. Choose the private vulnerability reporting option.
3. Describe the affected version or commit, impact, reproduction conditions, and any proposed mitigation.

If private vulnerability reporting is not available, open a public issue containing no vulnerability details and request a private reporting channel from the maintainer.

## Scope

Security-relevant reports include, but are not limited to:

- bypass of human approval or authority boundaries;
- external-supervisor authority escalation;
- control-plane exposure of mutation, provider, execution, approval, or other trusted authority;
- browser/UI behavior that can create or alter trusted orchestrator state;
- hostile-origin access, unsafe cross-origin exposure, or security-header regressions affecting the local UI/control-plane boundary;
- UI rendering or observation logic that fabricates trusted events, hides integrity failures, or converts browser-local state into trusted state;
- disclosure of raw task state, sensitive event data, or other information outside the qualified observer projections;
- path traversal or arbitrary file access;
- command or verification-policy bypass;
- provenance or evidence tampering;
- unsafe state-transition acceptance;
- secrets or sensitive data exposed through logs, traces, errors, browser observations, or model context;
- provider output being accepted as trusted state without required validation;
- unintended execution outside configured project or task boundaries.

## Disclosure expectations

Please allow reasonable time for validation and remediation before public disclosure.

Do not test vulnerabilities against systems, repositories, accounts, or data you do not own or have explicit authorization to assess.
