/**
 * Bridge entrypoint.
 *
 * Loads configuration from the environment and starts the HTTP server. A
 * missing or too-short `BRIDGE_SECRET` is a hard startup failure. A missing
 * `FULCRUM_HOST` is not: the bridge starts and reports `upstreamConfigured:
 * false` on `/health`, and every read returns `not_configured` until an
 * operator supplies one.
 */

import { loadConfig, ConfigError } from "./config.js";
import { createServer } from "./server.js";

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`bridge: configuration error: ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const server = createServer({ config });
  server.listen(config.port, config.listenHost, () => {
    process.stdout.write(
      `bridge: listening on port ${config.port} (upstream ${config.fulcrumHost ? "configured" : "not configured"})\n`,
    );
  });

  const shutdown = () => {
    setTimeout(() => process.exit(1), 10_000).unref();
    server.close(() => {
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
