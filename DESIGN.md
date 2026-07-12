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
- Interactive transitions: 200–250ms with `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- Prefer transform and opacity. Avoid layout animation and persistent decorative motion.
- Respect reduced-motion preferences through the application animation utilities.

## Layout

- Preserve one desktop shell across product areas.
- Keep prompt guidance, action shortcuts, and composer in one visual command workspace.
- Maintain clear hierarchy at small window sizes without horizontal overflow.

## Decisions Log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-07-10 | Refined utility system | Matches a security tool where speed, trust, and clarity matter more than decoration. |
