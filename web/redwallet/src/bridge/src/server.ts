/**
 * Bridge HTTP server.
 *
 * Routes:
 *   GET  /health  -> { status, upstreamConfigured }   (no secrets)
 *   POST /rpc     -> { method, params } + Bearer auth  (allowlisted reads)
 *
 * Everything else is 404. There is no signing, transaction-construction, or
 * broadcast route, and no route that accepts an upstream method or host from
 * the request.
 */

import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  type BridgeConfig,
  isUpstreamConfigured,
} from "./config.js";
import { BridgeError, errorBody } from "./errors.js";
import { ALLOWLIST } from "./allowlist.js";
import { validateRequest } from "./validation.js";
import { FulcrumClient, type UpstreamClient } from "./upstream.js";
import { RateLimiter } from "./rateLimit.js";

export interface ServerDeps {
  readonly config: BridgeConfig;
  /** Injectable for tests; defaults to a real Fulcrum client. */
  readonly upstream?: UpstreamClient;
  /** Injectable clock for deterministic rate-limit tests. */
  readonly now?: () => number;
}

/** Constant-time bearer comparison that never throws on length mismatch. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function extractBearer(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function sendError(res: http.ServerResponse, error: BridgeError): void {
  sendJson(res, error.status, error.toBody());
}

/** Read the request body with a hard byte ceiling. */
function readBody(
  req: http.IncomingMessage,
  maxBytes: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      if (total > maxBytes) return; // already rejected; drain the rest
      total += chunk.length;
      if (total > maxBytes) {
        // Reject without destroying the socket so the 413 response can be
        // written. Remaining chunks are drained and discarded.
        reject(new BridgeError("payload_too_large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", () => {
      reject(new BridgeError("invalid_request"));
    });
  });
}

export function createServer(deps: ServerDeps): http.Server {
  const { config } = deps;
  const now = deps.now ?? (() => Date.now());
  const limiter = new RateLimiter({
    max: config.rateLimitMax,
    windowMs: config.rateLimitWindowMs,
  });
  // IC replicas repeat one HTTPS request. Coalesce concurrent requests and
  // retain the exact JSON result briefly so every replica sees the same data.
  const cache = new Map<string, { expiresAt: number; result: unknown; bytes: number }>();
  let cacheBytes = 0;
  const pending = new Map<string, Promise<unknown>>();
  let checkpointPromise: Promise<void> | undefined;
  let checkpointVerifiedUntil = 0;
  const upstream: UpstreamClient =
    deps.upstream ??
    new FulcrumClient({
      host: config.fulcrumHost,
      port: config.fulcrumPort,
      tls: config.fulcrumTls,
      timeoutMs: config.requestTimeoutMs,
    });

  const server = http.createServer({ maxHeaderSize: 8192 }, (req, res) => {
    void handle(req, res);
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.timeout = 20_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  return server;

  async function verifyCheckpoint(): Promise<void> {
    const checkpoint = config.checkpoint;
    if (checkpoint === null || now() < checkpointVerifiedUntil) return;
    if (checkpointPromise) return checkpointPromise;
    checkpointPromise = (async () => {
      const result = await upstream.call("blockchain.block.header", [checkpoint.height]);
      if (typeof result !== "string" || result.toLowerCase() !== checkpoint.headerHex) {
        throw new BridgeError("upstream_malformed");
      }
      checkpointVerifiedUntil = now() + config.cacheTtlMs;
    })();
    try { await checkpointPromise; } finally { checkpointPromise = undefined; }
  }

  async function query(method: string, params: unknown[], upstreamMethod: string): Promise<unknown> {
    await verifyCheckpoint();
    if (method === "server.status") {
      const [tip, version] = await Promise.all([
        upstream.call("blockchain.headers.subscribe", []),
        upstream.call("server.version", []),
      ]);
      if (tip === null || typeof tip !== "object" || !("height" in tip) || !Number.isSafeInteger(tip.height) || (tip.height as number) < 0 || !Array.isArray(version) || version.length !== 2 || version.some(v => typeof v !== "string")) {
        throw new BridgeError("upstream_malformed");
      }
      return {
        height: tip.height,
        serverVersion: version[0], protocolVersion: version[1],
        checkpointVerified: config.checkpoint !== null,
        checkpointHeight: config.checkpoint?.height ?? null,
        checkpointHash: config.checkpoint?.hash ?? null,
      };
    }
    const result = await upstream.call(upstreamMethod, params);
    if (method === "headers.checkpoint") {
      if (typeof result !== "string" || !/^(?:[a-f0-9]{2}){80,2048}$/i.test(result)) throw new BridgeError("upstream_malformed");
      const verified = config.checkpoint !== null && params[0] === config.checkpoint.height && result.toLowerCase() === config.checkpoint.headerHex;
      return { height: params[0], hex: result.toLowerCase(), verified, hash: verified ? config.checkpoint?.hash : null };
    }
    if (method === "address.balance" && (result === null || typeof result !== "object" || !("confirmed" in result) || !("unconfirmed" in result) || !Number.isSafeInteger(result.confirmed) || !Number.isSafeInteger(result.unconfirmed) || (result.confirmed as number) < 0)) throw new BridgeError("upstream_malformed");
    if (method === "address.history" && (!Array.isArray(result) || result.some(tx => tx === null || typeof tx !== "object" || !/^[a-f0-9]{64}$/i.test(tx.tx_hash) || !Number.isSafeInteger(tx.height) || tx.height < -1))) throw new BridgeError("upstream_malformed");
    if (method === "fee.estimate" && (typeof result !== "number" || !Number.isFinite(result) || (result < 0 && result !== -1))) throw new BridgeError("upstream_malformed");
    return result;
  }

  async function handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;

      if (req.method === "GET" && path === "/health") {
        sendJson(res, 200, {
          status: "ok",
          upstreamConfigured: isUpstreamConfigured(config),
        });
        return;
      }

      if (path === "/rpc") {
        if (req.method !== "POST") {
          sendJson(res, 405, errorBody("invalid_request"));
          return;
        }
        await handleRpc(req, res);
        return;
      }

      sendJson(res, 404, errorBody("invalid_request"));
    } catch (error) {
      if (error instanceof BridgeError) {
        sendError(res, error);
        return;
      }
      sendError(res, new BridgeError("internal_error"));
    }
  }

  async function handleRpc(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    // Authentication happens before any upstream contact and before parsing.
    const provided = extractBearer(req.headers.authorization);
    if (provided === null || !secretMatches(provided, config.secret)) {
      sendError(res, new BridgeError("unauthorized"));
      return;
    }

    if (!isUpstreamConfigured(config)) {
      sendError(res, new BridgeError("not_configured"));
      return;
    }

    if (req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new BridgeError("invalid_request");
    const contentLength = req.headers["content-length"];
    if (contentLength !== undefined && Number(contentLength) > config.maxRequestBytes) throw new BridgeError("payload_too_large");
    const raw = await readBody(req, config.maxRequestBytes);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      sendError(res, new BridgeError("invalid_request"));
      return;
    }

    const request = validateRequest(parsed);
    const spec = ALLOWLIST[request.method];

    const key = JSON.stringify([request.method, request.upstreamParams]);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) {
      sendJson(res, 200, { result: cached.result });
      return;
    }
    let work = pending.get(key);
    if (!work) {
      limiter.prune(now());
      // One shared deployment secret: rate-limit total logical work, rather
      // than each replica or the reverse proxy's loopback address separately.
      if (pending.size >= config.maxConcurrent || !limiter.allow("deployment", now())) {
        throw new BridgeError("rate_limited");
      }
      work = query(request.method, request.upstreamParams, spec.upstreamMethod);
      pending.set(key, work);
    }
    let result: unknown;
    try {
      result = await work;
      const bytes = Buffer.byteLength(JSON.stringify(result));
      const previous = cache.get(key);
      if (previous) { cacheBytes -= previous.bytes; cache.delete(key); }
      while (cache.size > 0 && (cache.size >= 256 || cacheBytes + bytes > 16_777_216)) {
        const oldestKey = cache.keys().next().value!;
        cacheBytes -= cache.get(oldestKey)!.bytes;
        cache.delete(oldestKey);
      }
      cache.set(key, { expiresAt: now() + config.cacheTtlMs, result, bytes });
      cacheBytes += bytes;
    } catch (error) {
      if (error instanceof BridgeError) {
        sendError(res, error);
        return;
      }
      sendError(res, new BridgeError("upstream_unavailable"));
      return;
    } finally {
      pending.delete(key);
    }

    sendJson(res, 200, { result });
  }
}
