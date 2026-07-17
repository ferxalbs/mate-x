# Design System — MaTE X

## Product Context

MaTE X is a local-first desktop security review agent for developers working across arbitrary repositories. The interface should make powerful automation feel controlled, legible, and fast.

## Aesthetic Direction

- Refined utility: quiet, exact, and compact, with the calm of a native macOS tool.
- Flat surfaces defined by borders and subtle translucency, never heavy shadows.
- Color is rare and semantic. Structure comes from typography, spacing, and alignment.

## Typography

- Use the platform UI stack for native rendering speed and familiarity.
- Use tabular numerals for metrics and monospace only for code, hashes, and commands.
- Headings use tight tracking and restrained weight rather than oversized scale.

## Color

- Theme variables are the source of truth: `background`, `panel`, `panel-border`, `foreground`, and `muted-foreground`.
- Accent colors communicate action categories or state, not decoration.
- Dark mode uses layered near-black surfaces with low-contrast borders.

## Spacing and Shape

- Base unit: 4px. Default density: compact-comfortable.
- Main command panels: 32px radius. Cards and popovers: 16px. Buttons: full or 12px radius.
- Primary content column: 820px maximum width.

## Motion

- Motion is functional and interruptible.
- Interactive transitions: 150–250ms with `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- Prefer transform and opacity. Avoid layout animation and persistent decorative motion.
- Never animate `backdrop-filter`.
- Respect reduced-motion preferences (including lower glass blur radii).

## Glass and materials

- CSS-only glass. No native mica, acrylic, or vibrancy.
- **Default canvas:** light `#ffffff`, dark `#111111` for all layout chrome (sidebar, main, titlebar, panel).
- **Elevated exception:** inputs, selects, composer, menus, dialogs use `--control` (`#f2f3f5` / `#1a1a1a`) and optional stronger Interface blur.
- Opaque Electron window backing matches canvas; ambient mesh only when layout glass modes are on.
- Single-layer `backdrop-filter` only — never on main content ancestors of form controls.
- Settings: **Interface blur** (`blurEnabled`) for controls/overlays; **Transparency Mode** (`vibrancyMode`) for layout chrome. Independent switches.
- Tokens: `--control`, `--control-glass-blur`, `--overlay-glass-blur`, `--glass-*` in theme CSS; utilities in `src/index.css`.

## Layout

- Preserve one desktop shell across product areas.
- Keep prompt guidance, action shortcuts, and composer in one visual command workspace.
- Maintain clear hierarchy at small window sizes without horizontal overflow.

## Decisions Log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-07-10 | Refined utility system | Matches a security tool where speed, trust, and clarity matter more than decoration. |
| 2026-07-16 | CSS-only glass; no mica/vibrancy | Nested native + CSS blur washed out inputs; single-layer CSS glass is stable and portable. |
| 2026-07-16 | Independent Interface blur setting | Control/overlay glass is opt-in and separate from layout transparency mode. |
| 2026-07-16 | Flat #fff / #111 canvas | Matches product screenshot: full-app pure canvas; only controls elevate. |
