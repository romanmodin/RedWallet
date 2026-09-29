/**
 * Bridge configuration.
 *
 * Every value comes from the process environment. There are deliberately NO
 * defaults for the upstream host or the deployment secret: the bridge starts
 * with no upstream and refuses to serve reads until an operator configures
 * one. There is no bundled, default, or public upstream anywhere in this
 * package.
 */

import { isIP } from "node:net";

export interface BridgeConfig {
  /** Operator opt-in; signed-transaction broadcast is disabled by default. */
  readonly enableBroadcast?: boolean;
  readonly listenHost: string;
  readonly checkpoint: { height: number; headerHex: string; hash: string } | null;
  readonly maxConcurrent: number;
  readonly cacheTtlMs: number;
  /** TCP port the bridge HTTP server listens on. */
  readonly port: number;
  /** Bearer secret every request must present. Never logged or echoed. */
  readonly secret: string;
  /** Upstream Fulcrum host. Empty string means "not configured". */
  readonly fulcrumHost: string;
  /** Upstream Fulcrum TCP port. */
  readonly fulcrumPort: number;
  /** Whether to wrap the upstream socket in TLS. */
  readonly fulcrumTls: boolean;
  /** Per-request upstream timeout in milliseconds. */
  readonly requestTimeoutMs: number;
  /** Maximum accepted HTTP request body size in bytes. */
  readonly maxRequestBytes: number;
  /** Rate limit: maximum requests per window per client. */
  readonly rateLimitMax: number;
  /** Rate limit window in milliseconds. */
  readonly rateLimitWindowMs: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function readInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ConfigError(
      `${name} must be an integer between ${min} and ${max}.`,
    );
  }
  return parsed;
}

function readBool(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean,
): boolean {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  throw new ConfigError(`${name} must be "true" or "false".`);
}

/**
 * Parse configuration from the environment.
 *
 * `FULCRUM_HOST` and `BRIDGE_SECRET` have no defaults. A missing secret is a
 * hard startup error — the bridge must never run unauthenticated. A missing
 * host is allowed: the bridge starts in the "not configured" state and every
 * read returns an explicit not-configured error until an operator sets it.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const secret = env.BRIDGE_SECRET?.trim() ?? "";
  if (secret.length < 16) {
    throw new ConfigError(
      "BRIDGE_SECRET must be set to at least 16 characters. The bridge refuses to start without a deployment secret.",
    );
  }

  const fulcrumHost = env.FULCRUM_HOST?.trim() ?? "";
  const fulcrumPort = readInt(env, "FULCRUM_PORT", 50002, 1, 65535);
  const fulcrumTls = readBool(env, "FULCRUM_TLS", true);
  if (!fulcrumTls && fulcrumHost !== "" && fulcrumHost !== "127.0.0.1" && fulcrumHost !== "::1") {
    throw new ConfigError("Plaintext Fulcrum is permitted only on literal loopback addresses.");
  }
  const listenHost = env.LISTEN_HOST?.trim() || "127.0.0.1";
  if (!isIP(listenHost)) throw new ConfigError("LISTEN_HOST must be a literal IPv4 or IPv6 address.");
  const headerHex = env.CHECKPOINT_HEADER_HEX?.trim().toLowerCase() ?? "";
  const hash = env.CHECKPOINT_HASH?.trim().toLowerCase() ?? "";
  const heightText = env.CHECKPOINT_HEIGHT?.trim() ?? "";
  let checkpoint: BridgeConfig["checkpoint"] = null;
  if (headerHex !== "" || hash !== "" || heightText !== "") {
    if (!/^(?:[a-f0-9]{2}){80,2048}$/.test(headerHex) || !/^[a-f0-9]{64}$/.test(hash) || heightText === "") {
      throw new ConfigError("Checkpoint height, trusted header hex and trusted block hash must be configured together.");
    }
    checkpoint = { height: readInt(env, "CHECKPOINT_HEIGHT", 0, 0, 100_000_000), headerHex, hash };
  }

  return {
    enableBroadcast: readBool(env, "ENABLE_BROADCAST", false),
    listenHost,
    checkpoint,
    maxConcurrent: readInt(env, "MAX_CONCURRENT", 8, 1, 64),
    cacheTtlMs: readInt(env, "CACHE_TTL_MS", 15_000, 1000, 60_000),
    port: readInt(env, "PORT", 8080, 1, 65535),
    secret,
    fulcrumHost,
    fulcrumPort,
    fulcrumTls,
    requestTimeoutMs: readInt(env, "REQUEST_TIMEOUT_MS", 10_000, 100, 120_000),
    maxRequestBytes: readInt(env, "MAX_REQUEST_BYTES", 16_384, 64, 1_048_576),
    rateLimitMax: readInt(env, "RATE_LIMIT_MAX", 600, 1, 100_000),
    rateLimitWindowMs: readInt(env, "RATE_LIMIT_WINDOW_MS", 60_000, 100, 3_600_000),
  };
}

/** True when an operator has supplied an upstream host. */
export function isUpstreamConfigured(config: BridgeConfig): boolean {
  return config.fulcrumHost.length > 0;
}
