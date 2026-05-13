---
name: browser-prober
description: >
  Teach the model how to use the `browser_prober` tool — an enhanced headless Electron browser
  for security analysis of live web pages. Use when the task involves DOM XSS testing,
  CSP/header inspection, cookie audits, third-party tracker detection, redirect tracing,
  or any live frontend security probe. Triggers on: "probe a URL", "check headers",
  "test XSS", "audit cookies", "browser tool", "intercept requests", "screenshot page",
  "network idle", "browser_prober".
---

## Tool: `browser_prober`

Headless Electron browser running in an isolated, ephemeral session. Every probe spins a fresh
`session.fromPartition()` — no cookies, cache, or state bleed between runs.

---

## Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `url` | string | ✅ | — | Fully-qualified URL (`http`/`https`) to load |
| `script` | string | ❌ | none | JS to execute in page context after load. Must return a value. |
| `wait_for` | string | ❌ | `"load"` | When to consider the page ready — see strategies below |
| `timeout_ms` | number | ❌ | `15000` | Hard timeout in ms. Min 1000, max 60000 |
| `capture_screenshot` | boolean | ❌ | `false` | Capture a PNG screenshot (returned as base64) |
| `intercept_requests` | boolean | ❌ | `false` | Log all outbound network requests (URL, method, resource type) |
| `extract_cookies` | boolean | ❌ | `false` | Dump all cookies with security flag analysis |

---

## Wait Strategies

| `wait_for` | Behaviour | Best for |
|---|---|---|
| `"load"` | Waits for the `window load` event (default) | SPAs, resource-heavy pages |
| `"domcontentloaded"` | Stops at `DOMContentLoaded` — faster | Static pages, initial HTML audit |
| `"networkidle"` | Waits until ≤2 in-flight requests remain (max 5s) | Pages with lazy-loaded assets or XHR on mount |

---

## What the Report Always Contains

Even with no optional flags, every probe returns:

- **HTTP status code** and final URL (follows redirects)
- **Response headers** — security-relevant ones first (`Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, CORP, COEP)
- **Missing security headers** — explicit ⚠️ list of any expected headers that are absent
- **Browser console output** — all `verbose`/`info`/`warning`/`error` entries with icons
- **Elapsed time** in ms

---

## Usage Recipes

### 1 — Basic security header audit (no script needed)

```json
{
  "url": "https://example.com"
}
```

### 2 — Full cookie security audit

```json
{
  "url": "https://example.com",
  "extract_cookies": true
}
```
Report flags cookies missing `Secure`, `HttpOnly`, or `SameSite`.

### 3 — Third-party tracker / request detection

```json
{
  "url": "https://example.com",
  "intercept_requests": true,
  "wait_for": "networkidle"
}
```
Report groups requests by resource type and lists all third-party origins contacted.

### 4 — DOM XSS probe with custom script

```json
{
  "url": "https://example.com/search?q=<script>alert(1)</script>",
  "script": "return document.querySelector('title')?.textContent ?? document.body.innerHTML.slice(0, 500);"
}
```

### 5 — Extract CSP from a page that sets it via meta tag

```json
{
  "url": "https://example.com",
  "script": "return document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]')?.content ?? 'No meta CSP';"
}
```

### 6 — Full probe with screenshot

```json
{
  "url": "https://example.com",
  "capture_screenshot": true,
  "intercept_requests": true,
  "extract_cookies": true,
  "wait_for": "networkidle",
  "timeout_ms": 20000
}
```

### 7 — Redirect chain audit

```json
{
  "url": "http://example.com"
}
```
`final_url` in the report shows where the navigation ended. Compare against `url` to detect unencrypted redirects or open redirectors.

---

## Script Writing Rules

- The script runs inside the page's renderer context (sandboxed, `contextIsolation: true`).
- **Must return a value** — bare statements won't return anything. Use `return` explicitly or wrap in an IIFE.
- Async is supported: `return await fetch('/api/data').then(r => r.text());`
- Errors inside the script are caught and returned as `{ __error: "..." }`.
- No access to Node.js APIs or Electron internals — pure browser JS only.

**Good:**
```js
return document.querySelectorAll('form').length;
```

**Good (async):**
```js
const r = await fetch('/api/me', { credentials: 'include' });
return { status: r.status, body: await r.text() };
```

**Bad (no return):**
```js
document.title;  // returns undefined
```

---

## Security Architecture

- Window: `sandbox: true`, `webSecurity: true`, `nodeIntegration: false`, `contextIsolation: true`, `allowRunningInsecureContent: false`
- Session: fresh `session.fromPartition()` per probe — no shared cookies, cache, or storage
- `did-fail-load` code `-3` (redirect cancellation) is silently ignored to prevent false errors
- `offscreen: true` — no visible window is created

---

## Output Format Reference

```
═══ Browser Probe Report ═══
URL        : https://example.com → https://www.example.com
Status     : 200
Elapsed    : 1234ms

── Response Headers ──
  [Security-Relevant]
    strict-transport-security: max-age=31536000; includeSubDomains
    x-frame-options: DENY
    ...
  [Other]
    content-type: text/html; charset=utf-8
    ...

── Missing Security Headers ──
  ⚠️  content-security-policy
  ⚠️  referrer-policy

── Script Result ──
{ ... }

── Console (N entries) ──
  🔴 [error] Uncaught TypeError: ...
  🟡 [warning] ...

── Outbound Requests (N) ──
  [script]
    GET https://cdn.example.com/app.js
  [image]
    GET https://tracker.ads.com/pixel.gif

  Third-party origins contacted (2):
    • https://cdn.example.com
    • https://tracker.ads.com

── Cookies (N) ──
  session_id [.example.com/] Secure, HttpOnly, SameSite=strict
  _ga [.example.com/] NO FLAGS ⚠️

  ⚠️  Cookies missing security flags:
    _ga: missing Secure, HttpOnly

── Screenshot ──
  Captured (42KB PNG, base64-encoded)
  data:image/png;base64,iVBORw0KGgo…
```

---

## When to Use Which Flags

| Security task | Flags to enable |
|---|---|
| CSP / header review | *(none — always captured)* |
| Cookie `Secure`/`HttpOnly`/`SameSite` audit | `extract_cookies: true` |
| Third-party tracker inventory | `intercept_requests: true`, `wait_for: "networkidle"` |
| DOM XSS testing | `script` with payload + DOM inspection |
| Redirect chain / HTTPS enforcement | *(none — `final_url` always tracked)* |
| Visual page capture | `capture_screenshot: true` |
| SPA / lazy-load content | `wait_for: "networkidle"` |
| Fast static page check | `wait_for: "domcontentloaded"` |
