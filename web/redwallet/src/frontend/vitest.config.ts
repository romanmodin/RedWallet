import { fileURLToPath, URL } from "url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for the RedWallet frontend suite.
 *
 * Mirrors the `@` and `declarations` aliases from `vite.config.js` so tests
 * import production modules exactly as the app does. The DOM environment is
 * supplied by the `test` script (`--environment jsdom`); this file only wires
 * aliases and the shared setup module.
 */
export default defineConfig({
  plugins: [react()],
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
  },
  test: {
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    restoreMocks: true,
    // The default `forks` pool conflicts with this sandbox's thread limits
    // (tinypool rejects minThreads/maxThreads). Threads with explicit bounds
    // are sufficient here.
    pool: "threads",
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 1,
      },
    },
  },
});
