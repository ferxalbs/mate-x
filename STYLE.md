# STYLE.md — MaTE X Design System Guidelines

1. **Brand Palette (Veridian Steel)**: Never use standard AI blue/violet gradients. The primary brand accents must remain deep, tactical greens: Deep Veridian (#2B6043 / oklch(0.48 0.07 145)) for light backgrounds, and Luminous Sage (#5FB382 / oklch(0.68 0.09 145)) for dark backgrounds. All layout backdrops must remain flat (#ffffff or #111111).
2. **Unified Iconography (Phosphor Icons)**: Lucide, Heroicons, Font Awesome, and generic emojis are strictly prohibited. Standardize exclusively on Phosphor Icons. Use `weight="regular"` at 16px (size-4) for general UI commands, 14px (size-3.5) for secondary status tags, and `weight="fill"` only for active/toggled states.
3. **Flat Canvas Architecture**: Product chrome must remain flat and minimal. Avoid heavy drop shadows (use border-border/70 for boundaries instead) and excessive glassmorphism. Layout containers must never receive a backdrop-filter, keeping inputs and composer elements crisp and legible.
4. **Organic Curvature (Rounded Corners)**: Containers must follow the absolute rounded token hierarchy:
   - Primary panels & modal screens: rounded-[32px]
   - Content cards & composer container: rounded-2xl
   - Standard inputs, buttons, and settings items: rounded-xl
   - Never use capsule-shaped inputs.
5. **Monospace & High-Density Typography**: Prioritize typographic hierarchy over visual decoration. Use tracking-wider, uppercase monospace labels (text-[10px]) for metadata, status tags, and section headers to maintain a focused, developer-centric terminal aesthetic.
