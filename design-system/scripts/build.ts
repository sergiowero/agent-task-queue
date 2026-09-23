/**
 * Rebuilds design-system/components/bundle.js and bundle.css from packages/web-ui, and checks that
 * tokens.json still matches the colors declared in packages/web-ui/src/index.css.
 *
 *   bun run design-system:build
 */
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import type { BunPlugin } from "bun";

const root = resolve(import.meta.dir, "../..");
const webUi = join(root, "packages/web-ui");
const out = join(root, "design-system/components");
// Dependencies are installed for packages/web-ui, so resolve them from there.
const requireWebUi = createRequire(join(webUi, "package.json"));

/** Bundle order; each name gets a card in the design system. */
const COMPONENTS = [
  "Button",
  "IconButton",
  "CopyButton",
  "Input",
  "Textarea",
  "Select",
  "Field",
  "Checkbox",
  "Toggle",
  "SegmentedControl",
  "Tabs",
  "Badge",
  "StatusBadge",
  "CountPill",
  "Alert",
  "Spinner",
  "Skeleton",
  "EmptyState",
  "Tooltip",
  "Modal",
  "ConfirmDialog",
  "PageHeader",
  "TaskCard",
  "ConversationEntryCard",
];

// ---------- bundle.js ----------

const jsx = `
  var R = window.React;
  function jsx(type, props, key) {
    return R.createElement(type, key === undefined ? props : Object.assign({}, props, { key: key }));
  }
  exports.Fragment = R.Fragment;
  exports.jsx = exports.jsxs = exports.jsxDEV = jsx;`;

/** The page provides React 18 as globals; the bundle reads them instead of shipping its own. */
const SHIMS: Record<string, string> = {
  react: "module.exports = window.React;",
  "react-dom": "module.exports = window.ReactDOM;",
  "react-dom/client": "module.exports = window.ReactDOM;",
  "react/jsx-runtime": jsx,
  "react/jsx-dev-runtime": jsx,
  // PageHeader only needs navigate() for its back button; outside a router it follows the link.
  "react-router-dom": `exports.useNavigate = function () {
    return function (to) { if (typeof to === "string") window.location.assign(to); };
  };`,
};

const globals: BunPlugin = {
  name: "react-globals",
  setup(build) {
    const filter = new RegExp(
      `^(${Object.keys(SHIMS)
        .map((k) => k.replace("/", "\\/"))
        .join("|")})$`,
    );
    build.onResolve({ filter }, (args) => ({ path: args.path, namespace: "shim" }));
    build.onLoad({ filter: /.*/, namespace: "shim" }, (args) => ({
      contents: SHIMS[args.path],
      loader: "js",
    }));
  },
};

const result = await Bun.build({
  entrypoints: [join(import.meta.dir, "global.ts")],
  format: "iife",
  minify: true,
  target: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [globals],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
let js = (await result.outputs[0].text()).trim();
// Consumers inline the bundle in a <script>, so it may not contain an end tag or comment opener.
js = js.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
const header = { format: 4, namespace: "AgentQ", components: COMPONENTS.map((name) => ({ name })) };
writeFileSync(join(out, "bundle.js"), `/* @ds-bundle: ${JSON.stringify(header)} */\n${js}\n`);
console.log(`bundle.js  ${(js.length / 1024).toFixed(0)} KB`);

// ---------- bundle.css ----------

// The app declares colors as channel triples (`--primary: 79 70 229`) read as `rgb(var(--primary) / a)`.
// The design system's tokens.css declares full colors, so drop the declarations (tokens.css owns them,
// except the --ease-out curve) and rewrite every read to use the full color.
const indexCss = readFileSync(join(webUi, "src/index.css"), "utf8");
const input = indexCss.replace(/^\s*--(?!ease-out)[\w-]+:[^;]*;\s*\n/gm, "");

const postcss = requireWebUi("postcss");
const tailwindcss = requireWebUi("tailwindcss");
const autoprefixer = requireWebUi("autoprefixer");
const baseConfig = (await import(pathToFileURL(join(webUi, "tailwind.config.js")).href)).default;
const config = {
  ...baseConfig,
  content: [
    join(webUi, "src/**/*.{ts,tsx}").replaceAll("\\", "/"),
    join(root, "design-system/components/**/preview.html").replaceAll("\\", "/"),
  ],
  safelist: ["card", "card-interactive", "eyebrow", "stagger", "skeleton"],
};
const compiled: string = (
  await postcss([tailwindcss(config), autoprefixer]).process(input, { from: undefined })
).css;

/** `rgb(var(--x))` → `var(--x)`; `rgb(var(--x) / a)` → `color-mix(in srgb, var(--x) calc(a * 100%), transparent)`. */
function readFullColors(css: string): string {
  const open = /rgb\(\s*var\(--([\w-]+)\)/g;
  let result = "";
  let last = 0;
  for (let m = open.exec(css); m; m = open.exec(css)) {
    let i = open.lastIndex;
    for (let depth = 1; depth > 0; i++) depth += css[i] === "(" ? 1 : css[i] === ")" ? -1 : 0;
    const alpha = css.slice(open.lastIndex, i - 1).trim();
    result += css.slice(last, m.index);
    result += alpha
      ? `color-mix(in srgb, var(--${m[1]}) calc(${alpha.replace(/^\//, "").trim()} * 100%), transparent)`
      : `var(--${m[1]})`;
    last = open.lastIndex = i;
  }
  return result + css.slice(last);
}

let css = readFullColors(compiled);
// Bun's CSS minifier would try to fetch the remote font @import, so set it aside while minifying.
const fontImport = css.match(/^@import url\([^)]*\);\s*/)?.[0] ?? "";
css = css.slice(fontImport.length);
const tmp = mkdtempSync(join(tmpdir(), "agentq-ds-"));
try {
  writeFileSync(join(tmp, "bundle.css"), css);
  const min = await Bun.build({ entrypoints: [join(tmp, "bundle.css")], minify: true });
  if (!min.success) {
    for (const log of min.logs) console.error(log);
    process.exit(1);
  }
  css = fontImport.trim() + (await min.outputs[0].text()).trim() + "\n";
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
if (/<\/style/i.test(css)) throw new Error("bundle.css may not contain </style");
writeFileSync(join(out, "bundle.css"), css);
console.log(`bundle.css ${(css.length / 1024).toFixed(0)} KB`);

// ---------- tokens.json drift check ----------

type ColorToken = { name: string; value: string | Record<string, string> };
const tokens = JSON.parse(readFileSync(join(root, "design-system/tokens.json"), "utf8"));
const byName = new Map<string, ColorToken>(
  tokens.color.tokens.map((t: ColorToken) => [t.name, t] as const),
);

function declarations(selector: string): Map<string, string> {
  const vars = new Map<string, string>();
  const blocks = indexCss.matchAll(
    new RegExp(`${selector.replace(/[[\]"]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g"),
  );
  for (const [, body] of blocks) {
    for (const [, name, value] of body.matchAll(/--([\w-]+):\s*(\d+ \d+ \d+);/g))
      vars.set(name, value);
  }
  return vars;
}

const hex = (triple: string) =>
  "#" +
  triple
    .split(" ")
    .map((n) => Number(n).toString(16).padStart(2, "0"))
    .join("");

const drift: string[] = [];
for (const [theme, selector] of [
  ["light", ":root"],
  ["dark", '[data-theme="dark"]'],
] as const) {
  for (const [name, triple] of declarations(selector)) {
    const token = byName.get(name);
    const value = typeof token?.value === "string" ? token.value : token?.value[theme];
    if (!token) drift.push(`${name}: in index.css but not in tokens.json`);
    else if (value !== hex(triple))
      drift.push(`${name} (${theme}): tokens.json ${value}, index.css ${hex(triple)}`);
  }
}
if (drift.length) {
  console.warn(`\ntokens.json is out of date with index.css:\n  ${drift.join("\n  ")}`);
  process.exitCode = 1;
} else {
  console.log("tokens.json matches index.css");
}
