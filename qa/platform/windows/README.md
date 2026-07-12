# Windows platform QA (deferred)

Windows is a **secondary future platform**. MaTE X remains architecturally
cross-platform, but **v0.1.2 is macOS-first**.

## Policy

- macOS gates are blocking for founder acceptance.
- Windows gates are non-blocking and experimental.
- Do not raise default product or suite timeouts to paper over Windows CI timing.
- Do not reduce fixtures solely to make Windows runners pass.
- Do not publish Windows installers as release-candidate artifacts in this phase.
- Platform-specific Windows qualification lives here (and in
  `.github/workflows/windows-compatibility.yml`), not in the default macOS
  developer path.

## Workflow

Trigger manually:

```
.github/workflows/windows-compatibility.yml  (workflow_dispatch)
```

## Future work

- Full Windows install/lifecycle qualification
- Windows-scoped timeouts only inside this layer when justified by product defects
- Installer generation and checksums when Windows enters a dedicated RC phase
