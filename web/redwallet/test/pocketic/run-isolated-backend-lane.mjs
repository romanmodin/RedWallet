#!/usr/bin/env node
// Explicit workstation verification only. The platform/sidecar runner is unchanged.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { PocketIcServer } from "@dfinity/pic";

const [wasmPath, expectedHash] = process.argv.slice(2);
if (!wasmPath || !/^[0-9a-f]{64}$/.test(expectedHash ?? "")) {
  throw new Error("Usage: node test/pocketic/run-isolated-backend-lane.mjs WASM_PATH EXPECTED_SHA256");
}
const wasm = path.resolve(wasmPath);
const actualHash = createHash("sha256").update(await readFile(wasm)).digest("hex");
if (actualHash !== expectedHash) throw new Error("Compiled backend artifact hash mismatch");
const lane = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(lane, "../..");
const require = createRequire(import.meta.url);
const vitest = path.join(path.dirname(require.resolve("vitest/package.json", {
  paths: [path.join(root, "src/frontend"), root],
})), "vitest.mjs");
process.env.RAYON_NUM_THREADS ??= "2";
process.env.TOKIO_WORKER_THREADS ??= "2";
let server;
let child;
let timer;
try {
  server = await PocketIcServer.start();
  console.log(`Isolated compiled backend SHA256 ${actualHash}`);
  child = spawn(process.execPath, [vitest, "run", "--environment", "node",
    "--fileParallelism=false", "--testTimeout", "30000", "--hookTimeout", "60000"], {
    cwd: lane, stdio: "inherit",
    env: { ...process.env, POCKET_IC_URL: server.getUrl(), BACKEND_WASM: wasm },
  });
  timer = setTimeout(() => child.kill("SIGTERM"), 180_000);
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  clearTimeout(timer);
  if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  if (server) await server.stop();
}
