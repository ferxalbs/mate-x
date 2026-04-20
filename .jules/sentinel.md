## 2026-04-20 - [Command Injection in Test Runner]
**Vulnerability:** Command injection vulnerability existed in `run_tests.ts` due to unsanitized input appending.
**Learning:** Test runner specificPaths and test suite names can be manipulated to achieve command execution in Node `spawn` environments using `shell: true`.
**Prevention:** Always validate and safely escape/quote variables before combining them into a shell command string, specifically avoid using `shell: true` or carefully sanitize regexes such as blocklists against characters like `|&;<>$`()\n`.
