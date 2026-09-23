/** @type {import('tailwindcss').Config} */

// Every color is an RGB channel triple in index.css so opacity modifiers
// (`bg-primary/10`, `border-danger/30`) work in both themes.
const c = (name) => `rgb(var(--${name}) / <alpha-value>)`;

const tone = (name) => ({
  DEFAULT: c(name),
  hover: c(`${name}-hover`),
  fg: c(`${name}-fg`),
  text: c(`${name}-text`),
  subtle: `rgb(var(--${name}) / 0.1)`,
  ring: `rgb(var(--${name}) / 0.35)`,
});

// `text-primary`, `text-danger`, ... resolve to the readable text shade of the
// tone (lighter in dark mode), while `bg-*` / `border-*` keep the solid shade.
const toneText = (name) => ({ ...tone(name), DEFAULT: c(`${name}-text`) });

const TONES = ["primary", "danger", "success", "warning", "info", "accent"];

export default {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          '"Helvetica Neue"',
          "Arial",
          "sans-serif",
        ],
        mono: [
          '"JetBrains Mono"',
          "ui-monospace",
          "SFMono-Regular",
          '"SF Mono"',
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        canvas: c("canvas"),
        surface: {
          DEFAULT: c("surface"),
          secondary: c("surface-secondary"),
          tertiary: c("surface-tertiary"),
          elevated: c("surface-elevated"),
        },
        border: {
          DEFAULT: c("border"),
          light: c("border-light"),
          strong: c("border-strong"),
        },
        text: {
          DEFAULT: c("text"),
          secondary: c("text-secondary"),
          muted: c("text-muted"),
        },
        ...Object.fromEntries(TONES.map((t) => [t, tone(t)])),
      },
      textColor: Object.fromEntries(TONES.map((t) => [t, toneText(t)])),
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        glow: "0 0 0 1px rgb(var(--primary) / 0.4), 0 4px 16px -4px rgb(var(--primary) / 0.45)",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      transitionProperty: {
        theme: "background-color, color, border-color, box-shadow, fill, stroke",
        size: "width, height, max-width, max-height",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
        "theme-ease": "ease-in-out",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "fade-out": { from: { opacity: "1" }, to: { opacity: "0" } },
        "scale-in": {
          from: { opacity: "0", transform: "translateY(8px) scale(0.96)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "scale-out": {
          from: { opacity: "1", transform: "translateY(0) scale(1)" },
          to: { opacity: "0", transform: "translateY(4px) scale(0.97)" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "slide-out-right": {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(100%)" },
        },
        "page-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        rise: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-down": {
          from: { opacity: "0", transform: "translateY(-6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "tooltip-in": {
          from: { opacity: "0", transform: "scale(0.94)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        pop: {
          "0%": { transform: "scale(0.6)", opacity: "0" },
          "60%": { transform: "scale(1.12)", opacity: "1" },
          "100%": { transform: "scale(1)" },
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(1)", opacity: "0.6" },
          "100%": { transform: "scale(2.4)", opacity: "0" },
        },
        // Legacy name kept for existing markup.
        slideUp: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out backwards",
        "fade-out": "fade-out 160ms ease-in both",
        "scale-in": "scale-in 260ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
        "scale-out": "scale-out 160ms ease-in both",
        "slide-in-right": "slide-in-right 320ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
        "slide-out-right": "slide-out-right 200ms ease-in both",
        "page-in": "page-in 320ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
        rise: "rise 360ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
        "slide-down": "slide-down 220ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
        "slide-up": "slideUp 300ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
        "tooltip-in": "tooltip-in 140ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
        pop: "pop 260ms cubic-bezier(0.34, 1.56, 0.64, 1) backwards",
        shimmer: "shimmer 1.6s linear infinite",
        "pulse-ring": "pulse-ring 1.6s cubic-bezier(0, 0, 0.2, 1) infinite",
      },
    },
  },
  plugins: [],
};
