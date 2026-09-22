import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Vendor groups keyed by package name. Matched against the module path so the
// packages' internal files (e.g. react/cjs/*) land in the same chunk.
const VENDOR_CHUNKS: Array<{ name: string; test: RegExp }> = [
  { name: "react", test: /node_modules\/(react|react-dom|scheduler)\// },
  { name: "react-router", test: /node_modules\/(react-router|react-router-dom)\// },
  { name: "tanstack-query", test: /node_modules\/@tanstack\// },
  {
    name: "markdown",
    test: /node_modules\/(react-markdown|remark-[^/]+|rehype-[^/]+|micromark[^/]*|mdast-[^/]+|hast-[^/]+|unist-[^/]+|unified|vfile[^/]*|lowlight|highlight\.js)\//,
  },
];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          return VENDOR_CHUNKS.find((chunk) => chunk.test.test(id))?.name;
        },
      },
    },
  },
  server: {
    port: 5173,
    hmr: {
      clientPort: 5173,
    },
  },
});
