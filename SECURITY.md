# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| Latest release | Yes |
| Previous minor release | Yes (critical fixes only) |
| Older versions | No |

---

## Reporting a Vulnerability

**Do not disclose security vulnerabilities through public GitHub issues, pull requests, or discussions.**

Report vulnerabilities by emailing [security@enosis.dev](mailto:security@enosis.dev) with the subject line:

```
[MaTE X Security] Brief description
```

Include in your report:

- A clear description of the vulnerability and its potential impact.
- Steps to reproduce, or a proof-of-concept if available.
- The version of MaTE X you tested against.
- Your contact information for follow-up.

We will acknowledge your report within **48 hours** and provide a resolution timeline within **7 business days**. We will credit reporters who responsibly disclose valid findings unless you prefer to remain anonymous.

---

## Scope

**In scope:**

- Vulnerabilities in the main process that allow renderer-side code to execute arbitrary system commands or read arbitrary files outside the intended IPC surface.
- Vulnerabilities in IPC input validation that could lead to path traversal, command injection, or privilege escalation.
- Vulnerabilities in the MaTE X Privacy layer that result in raw secrets being transmitted to cloud endpoints.
- Vulnerabilities in local database access or key storage that expose user credentials.

**Out of scope:**

- Vulnerabilities in third-party repositories that MaTE X is used to analyze — MaTE X is the tool, not the target.
- Electron itself, Chromium, or Node.js vulnerabilities not specific to MaTE X's implementation.
- Social engineering or phishing attacks.
- Findings from automated scanners submitted without manual validation.
- Rate limiting or denial-of-service against local processes.

---

## Security Architecture

MaTE X enforces a strict process boundary:

- All file system access, Git commands, and API key resolution occur in the Electron **main process**.
- The renderer has no direct access to system resources and must communicate through **validated IPC channels**.
- The **MaTE X Privacy** subsystem scans all outbound payloads locally before transmission — secrets are replaced with typed placeholders and stored in an encrypted local vault.

---

## Disclosure Policy

Enosis Labs follows coordinated disclosure. We ask reporters to:

1. Give us a reasonable time (typically 90 days) to develop and release a fix before public disclosure.
2. Avoid accessing or modifying user data beyond what is necessary to demonstrate the vulnerability.
3. Not disrupt production services or other users' sessions.

We will not take legal action against researchers who act in good faith and follow this policy.
