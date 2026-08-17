# Plan: Soften UI Colors for Legacy Builds

The user reports that the current "Amber Gold" theme (enterprise accounting style) appears "very dark" or harsh in Windows 7 builds and wants a softer color combination that is easier on the eyes. We will shift the palette towards a more neutral, low-contrast "Modern Soft" theme using sage greens, warm greys, and cream tones while maintaining the "Busy-style" layout.

## User Review Required

> [!IMPORTANT]
> The current theme is high-contrast "Amber Gold". I am proposing a shift to a "Soft Sage/Cream" palette which is typically easier on the eyes for long accounting sessions, especially on older monitors.

## Proposed Changes

### Styling & Theming
- **Update Semantic Tokens**: Modify `src/styles.css` `:root` variables.
  - **Background**: Shift from bright white/grey to a warm cream (`oklch(0.98 0.01 80)`).
  - **Primary Gold**: Replace the deep amber with a soft, professional sage green or muted slate blue.
  - **Sidebar/Header**: Lighten the background to a pale tint to reduce "visual weight".
  - **Text**: Ensure high legibility without pure black (using deep charcoals).
- **Soften Menus**: Update `.busy-menubar` and `.busy-menu-dropdown` to use the new soft palette (removing harsh dark highlights).

### Component Adjustments
- **KPI Cards**: Update category colors to be more pastel/muted while remaining distinct.
- **Top Bar**: Reduce the intensity of the "Mehtaji" brand mark background.

## Technical Details
- Change `--amber-*` variables in `src/styles.css` to soft-themed equivalents (e.g., `--theme-base`, `--theme-light`).
- Adjust `oklch` values to ensure sufficient contrast (WCAG AA) while reducing peak brightness.
- Update `CloudProviderSetupDialog.tsx` description to reflect the current task status.
