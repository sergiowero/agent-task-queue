## Context

The ATQ web portal is a React + Vite application using Tailwind CSS for styling. The current UI has minimal styling with basic Tailwind utilities and no design system. The application consists of a Kanban board, task drawer, agent list, and activity feed. All components are functional but lack visual polish, animations, and theming support.

Current stack: React 19, Vite 6, Tailwind CSS 3.4, TypeScript, React Router 7, TanStack Query.

## Goals / Non-Goals

**Goals:**
- Implement light and dark mode with system preference detection and localStorage persistence
- Create a design token system using CSS variables for consistent theming
- Add smooth CSS transitions for theme switching, drawer/modal animations, and interactive states
- Redesign interactive controls (buttons, inputs, badges) with modern styling
- Maintain all existing functionality without breaking changes

**Non-Goals:**
- Complete component library extraction (keep styles component-local)
- Mobile-responsive layout (desktop-first remains)
- Animation complexity beyond CSS transitions (no Framer Motion or JS animations)
- Accessibility audit beyond basic focus states

## Decisions

**Decision 1: Use CSS variables for theming instead of Tailwind's darkMode config**
- Rationale: CSS variables enable runtime theme switching without class manipulation on `<html>`. Tailwind's `darkMode: 'class'` requires toggling a class on the root element, which causes a flash. CSS variables with a `[data-theme]` attribute on `<html>` allows instant theme switching.
- Alternative considered: Tailwind's built-in dark mode with class strategy — rejected due to flash of unstyled content on theme change.

**Decision 2: Implement theme via React context + CSS custom properties**
- Rationale: A `ThemeProvider` context manages the active theme and persists to localStorage. CSS variables defined on `:root` and `[data-theme="dark"]` provide the actual color values. Components consume variables via Tailwind's `theme()` function or direct `var()` references.
- Alternative considered: Styled-components or CSS-in-JS — rejected to avoid adding dependencies and maintain Tailwind consistency.

**Decision 3: Use Tailwind CSS transitions instead of animation libraries**
- Rationale: CSS transitions via `transition-*` utilities cover all needed animations (drawer slide, modal fade, theme switch, hover states). No additional bundle size. Framer Motion would add ~30KB for features we don't need.
- Alternative considered: Framer Motion — rejected for bundle size and overkill for simple transitions.

**Decision 4: Implement design tokens as Tailwind theme extensions**
- Rationale: Extend `tailwind.config.js` with custom colors, spacing, and typography that reference CSS variables. This allows using tokens like `bg-surface` and `text-primary` in Tailwind classes while keeping actual values in CSS variables for theme switching.
- Alternative considered: Hardcoded colors in components — rejected because it prevents theme switching.

**Decision 5: Scope animations to interactive elements only**
- Rationale: Performance. Animating large DOM trees (full board re-renders) causes jank. Limit animations to: theme toggle (0.3s), drawer open/close (0.25s), modal fade (0.2s), button hover/focus (0.15s), and card hover lift (0.15s).

## Risks / Trade-offs

- [Risk] Flash of unstyled theme on initial load → Mitigation: Inline `<script>` in `index.html` reads localStorage and sets `data-theme` before React mounts
- [Risk] CSS variable specificity conflicts → Mitigation: Define all tokens at `:root` level, avoid inline styles
- [Risk] Transition performance on低端 hardware → Mitigation: Use `transform` and `opacity` only (GPU-composited properties), avoid animating `box-shadow` or `background-color` directly
- [Trade-off] More CSS variables to maintain → Acceptable: centralized tokens are easier to update than scattered color values
- [Trade-off] Slightly larger CSS bundle from extended Tailwind config → Acceptable: marginal increase (~2-3KB)

## Migration Plan

1. Add CSS variables to `index.html` and `globals.css` for light/dark themes
2. Add `ThemeProvider` context and hook
3. Extend Tailwind config with design tokens
4. Update components incrementally (one component at a time)
5. Add inline script to prevent theme flash
6. Test theme persistence across page reloads

Rollback: Remove `ThemeProvider`, CSS variables, and Tailwind extensions. Components revert to default Tailwind styling.
