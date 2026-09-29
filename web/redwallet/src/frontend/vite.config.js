import { fileURLToPath, URL } from "url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import environment from "vite-plugin-environment";

const ii_url =
  process.env.DFX_NETWORK === "local"
    ? `http://uqzsh-gqaaa-aaaaq-qaada-cai.localhost:8081/authorize`
    : `https://id.ai/authorize`;

process.env.II_URL = process.env.II_URL || ii_url;

// Build-time guard: the restrictive Content-Security-Policy meta must be the
// first element inside <head> of the emitted dist/index.html, before any
// script, stylesheet, or other resource reference. This asserts only; it never
// rewrites or reorders the policy.
function assertCspFirstInHead() {
  return {
    name: "assert-csp-first-in-head",
    enforce: "post",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
        if (!headMatch) {
          throw new Error(
            "[csp-guard] No <head> element found in emitted index.html.",
          );
        }
        const head = headMatch[1];
        const firstElement = head.match(/<[a-zA-Z][^>]*>/);
        const isCspMeta =
          firstElement !== null &&
          /^<meta\b/i.test(firstElement[0]) &&
          /http-equiv\s*=\s*["']?Content-Security-Policy["']?/i.test(
            firstElement[0],
          );
        if (!isCspMeta) {
          throw new Error(
            "[csp-guard] The Content-Security-Policy meta must be the first " +
              "element inside <head>, before any script, stylesheet, or other " +
              "resource reference. Fix src/frontend/index.html.",
          );
        }
        return html;
      },
    },
  };
}

export default defineConfig({
  logLevel: "error",
  build: {
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4943",
        changeOrigin: true,
      },
    },
  },
  plugins: [
    environment("all", { prefix: "CANISTER_" }),
    environment("all", { prefix: "DFX_" }),
    environment(["II_URL"]),
    react(),
    assertCspFirstInHead(),
  ],
  resolve: {
    alias: [
      {
        find: "declarations",
        replacement: fileURLToPath(new URL("../declarations", import.meta.url)),
      },
      {
        find: "@",
        replacement: fileURLToPath(new URL("./src", import.meta.url)),
      },
    ],
    dedupe: ["@icp-sdk/core"]
  },
});
