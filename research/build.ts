// Builds the research stylesheet and inlines it (plus report.js) into every report,
// so each HTML file opens on its own from disk: no server, no sibling files needed.
//
//   bun run research:build
//
// Reports mark the spots to fill with `<!-- report-css:start -->…<!-- report-css:end -->`
// and `<!-- report-js:start -->…<!-- report-js:end -->` (see research/styleguide.md).
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, relative, resolve } from "path";

const RESEARCH_DIR = import.meta.dir;
const ASSETS_DIR = join(RESEARCH_DIR, "assets");
const WEB_UI_DIR = resolve(RESEARCH_DIR, "../packages/web-ui");

/** Compiles report.src.css with the Tailwind CLI installed in packages/web-ui. */
function buildCss(): string {
  const out = join(ASSETS_DIR, "report.css");
  const result = Bun.spawnSync(
    [
      process.execPath,
      "run",
      "--cwd",
      WEB_UI_DIR,
      "tailwindcss",
      "-c",
      join(ASSETS_DIR, "tailwind.config.js"),
      "-i",
      join(ASSETS_DIR, "report.src.css"),
      "-o",
      out,
      "--minify",
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (result.exitCode !== 0) {
    console.error("❌ Tailwind build failed. Run `bun install` at the repo root first.");
    process.exit(result.exitCode ?? 1);
  }
  return readFileSync(out, "utf8");
}

/** Every .html file under research/, recursively. */
function findReports(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "assets" ? [] : findReports(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

/** Replaces what sits between `<!-- name:start -->` and `<!-- name:end -->`. */
function fillBlock(html: string, name: string, content: string): string {
  const pattern = new RegExp(`<!-- ${name}:start -->[\\s\\S]*?<!-- ${name}:end -->`);
  // A replacer function keeps `$` sequences in the CSS from being read as patterns.
  return html.replace(pattern, () => `<!-- ${name}:start -->\n${content}\n<!-- ${name}:end -->`);
}

const css = buildCss();
const js = readFileSync(join(ASSETS_DIR, "report.js"), "utf8");

for (const file of findReports(RESEARCH_DIR)) {
  const before = readFileSync(file, "utf8");
  let html = fillBlock(before, "report-css", `<style>\n${css.trim()}\n</style>`);
  html = fillBlock(html, "report-js", `<script>\n${js.trim()}\n</script>`);
  if (html !== before) writeFileSync(file, html);
  console.log(`✅ ${relative(RESEARCH_DIR, file)}${html === before ? " (unchanged)" : ""}`);
}
