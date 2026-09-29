import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
/** Test runner only: bundle for a browser, then execute without Node globals. */
import { build } from "vite";

const built = await build({
  configFile: false,
  logLevel: "silent",
  build: {
    target: "es2020",
    write: false,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL("./browser-harness.ts", import.meta.url)),
      name: "XbtCoreBrowserSmoke",
      formats: ["iife"],
    },
  },
});
const bundle = Array.isArray(built) ? built[0] : built;
if (!("output" in bundle))
  throw new Error("Vite did not return a browser bundle");
const entry = bundle.output.find(
  (output) => output.type === "chunk" && output.isEntry,
);
if (!entry) throw new Error("Browser entry chunk is missing");
const context = createContext({
  crypto: webcrypto,
  TextEncoder,
  TextDecoder,
  atob,
  btoa,
});
if (
  runInContext(
    "typeof Buffer + ',' + typeof process + ',' + typeof require",
    context,
  ) !== "undefined,undefined,undefined"
) {
  throw new Error("Node globals leaked into the browser context");
}
runInContext(entry.code, context, { timeout: 10_000 });
const result = runInContext(
  "XbtCoreBrowserSmoke.runBrowserCoreChecks()",
  context,
  { timeout: 10_000 },
);
const vault = await runInContext(
  "XbtCoreBrowserSmoke.runBrowserVaultChecks()",
  context,
  { timeout: 10000 },
);
process.stdout.write(JSON.stringify({ ...result, ...vault }));
