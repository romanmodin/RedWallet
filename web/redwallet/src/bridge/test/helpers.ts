/**
 * Test helpers: a local mock upstream and a bridge test harness.
 *
 * Nothing here contacts a real network. The mock upstream is a plain TCP
 * server (optionally TLS with a self-signed certificate) that answers
 * newline-delimited JSON-RPC.
 */

import net from "node:net";
import tls from "node:tls";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

export interface MockUpstream {
  readonly port: number;
  readonly requests: Array<{ method: string; params: unknown[] }>;
  close(): Promise<void>;
}

export interface MockUpstreamOptions {
  /** Return value for a method, or throw to simulate an upstream error. */
  readonly handler?: (method: string, params: unknown[]) => unknown;
  /** When true, answer with a non-JSON line. */
  readonly malformed?: boolean;
  /** When true, accept the connection but never answer. */
  readonly silent?: boolean;
  /** Override a JSON-RPC envelope for protocol validation tests. */
  readonly response?: unknown;
}

/** Start a plaintext mock upstream on an ephemeral port. */
export function startMockUpstream(
  options: MockUpstreamOptions = {},
): Promise<MockUpstream> {
  return new Promise((resolve) => {
    const requests: Array<{ method: string; params: unknown[] }> = [];
    const server = net.createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          handleLine(line, socket, requests, options);
          newline = buffer.indexOf("\n");
        }
      });
      socket.on("error", () => {
        /* client teardown */
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        port: address.port,
        requests,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

function handleLine(
  line: string,
  socket: net.Socket,
  requests: Array<{ method: string; params: unknown[] }>,
  options: MockUpstreamOptions,
): void {
  if (options.silent) return;
  if (options.malformed) {
    socket.write("this is not json\n");
    return;
  }
  let parsed: { id?: unknown; method?: string; params?: unknown[] };
  try {
    parsed = JSON.parse(line) as typeof parsed;
  } catch {
    socket.write("not json\n");
    return;
  }
  const method = parsed.method ?? "";
  const params = parsed.params ?? [];
  requests.push({ method, params });
  const handler = options.handler ?? (() => null);
  let result: unknown;
  try {
    result = handler(method, params);
  } catch (error) {
    socket.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: parsed.id ?? 1,
        error: { code: -1, message: String(error) },
      })}\n`,
    );
    return;
  }
  socket.write(
    `${JSON.stringify(options.response ?? { jsonrpc: "2.0", id: parsed.id ?? 1, result })}\n`,
  );
}

export interface TlsUpstream {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Start a TLS mock upstream with a self-signed certificate. Used to prove the
 * bridge rejects an unverifiable certificate.
 */
export function startSelfSignedTlsUpstream(): Promise<TlsUpstream> {
  const dir = mkdtempSync(join(tmpdir(), "bridge-tls-"));
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
  ], { stdio: "ignore" });
  const key = readFileSync(keyPath);
  const cert = readFileSync(certPath);

  return new Promise((resolve) => {
    const server = tls.createServer({ key, cert }, (socket) => {
      socket.on("data", () => {
        socket.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: "ok" })}\n`,
        );
      });
      socket.on("error", () => {
        /* client teardown */
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => {
              rmSync(dir, { recursive: true, force: true });
              done();
            });
          }),
      });
    });
  });
}
