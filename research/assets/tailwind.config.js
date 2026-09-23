/** @type {import('tailwindcss').Config} */

// Research reports reuse the AgentQ portal tokens (packages/web-ui/tailwind.config.js):
// every color is an RGB channel triple defined in report.src.css, so opacity
// modifiers (`bg-primary/10`, `border-danger/30`) work in both themes.
const c = (name) => `rgb(var(--${name}) / <alpha-value>)`;

const tone = (name) => ({
  DEFAULT: c(name),
  fg: c(`${name}-fg`),
  text: c(`${name}-text`),
});

// `text-primary`, `text-danger`, ... resolve to the readable text shade of the tone.
const toneText = (name) => ({ ...tone(name), DEFAULT: c(`${name}-text`) });

const TONES = ["primary", "danger", "success", "warning", "info", "accent"];

export default {
  // Paths are relative to this file: every report under research/ is scanned.
  // The inlined <style>/<script> blocks are stripped first, so a class stays in
  // the build only while some report's markup still uses it.
  content: {
    relative: true,
    files: ["../**/*.html", "./report.js"],
    transform: {
      html: (content) =>
        content.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<script>[\s\S]*?<\/script>/g, ""),
    },
  },
  // Utilities new reports reach for often, kept even when the current reports
  // do not use them, so a new report rarely needs a CSS rebuild.
  safelist: [
    { pattern: /^(grid-cols|col-span)-(1|2|3|4|6|12)$/, variants: ["sm", "md", "lg"] },
    { pattern: /^(gap|gap-x|gap-y)-(1|2|3|4|5|6|8)$/ },
    { pattern: /^(mt|mb|my|pt|pb|py|px|p)-(0|1|2|3|4|6|8|10|12)$/ },
    { pattern: /^(flex|inline-flex|grid|hidden|block|inline-block)$/, variants: ["sm", "md", "lg"] },
    { pattern: /^(items|justify)-(start|center|end|between)$/ },
    { pattern: /^(bg|text|border)-(primary|danger|success|warning|info|accent)$/ },
    { pattern: /^bg-(primary|danger|success|warning|info|accent)\/(5|10|15|20)$/ },
    { pattern: /^text-(xs|sm|base|lg|xl|2xl|3xl)$/ },
    { pattern: /^font-(normal|medium|semibold|bold|mono)$/ },
    { pattern: /^w-(full|1\/2|1\/3|2\/3)$/ },
  ],
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
      },
      maxWidth: {
        prose: "68ch",
      },
    },
  },
  plugins: [],
};
