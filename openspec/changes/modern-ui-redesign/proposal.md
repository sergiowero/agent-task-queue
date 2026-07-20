## Why

The current web portal uses a basic, utilitarian design that lacks visual polish and modern UX patterns. Users interacting with the Kanban board, task drawer, and navigation elements experience a flat, unstyled interface that doesn't leverage contemporary design principles like depth, motion, and theming. This creates friction in daily usage and makes the tool feel dated compared to modern project management interfaces.

## What Changes

- Add light and dark mode toggle with system preference detection and persistent user preference
- Redesign all interactive controls (buttons, inputs, badges, toggles) with modern styling, hover states, and focus rings
- Add smooth CSS transitions and animations for card movements, drawer open/close, modal appearance, and theme switching
- Implement a cohesive design system with consistent spacing, typography, and color palette across all views
- Improve visual hierarchy through depth (shadows, elevation), contrast, and whitespace

## Capabilities

### New Capabilities

- `ui-theme`: Light/dark mode system with CSS variables, theme toggle, and system preference detection
- `ui-animations`: CSS transitions and animations for board interactions, drawer, modals, and theme switching
- `ui-controls`: Redesigned buttons, inputs, badges, and interactive elements with modern styling and states

### Modified Capabilities

- `web-portal`: Updated layout, navigation, and component styling to use new design system

## Impact

- `packages/web-ui/src/`: All React components will receive styling updates
- `packages/web-ui/src/App.tsx`: Theme provider integration
- `packages/web-ui/src/components/Layout.tsx`: Navigation and sidebar redesign
- `packages/web-ui/src/components/TaskCard.tsx`: Card styling and animation
- `packages/web-ui/src/components/TaskDrawer.tsx`: Drawer transitions
- `packages/web-ui/src/components/CreateTaskModal.tsx`: Modal animations
- `packages/web-ui/src/pages/BoardPage.tsx`: Board layout refinements
- CSS/Tailwind configuration for design tokens and theme variables
