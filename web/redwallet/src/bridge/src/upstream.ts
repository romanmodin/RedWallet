/**
 * Upstream Fulcrum client.
 *
 * Speaks newline-delimited JSON-RPC over a TCP socket, optionally wrapped in
 * TLS. TLS is verified with `rejectUnauthorized: true` and there is no
 * plaintext fallback: when `FULCRUM_TLS` is true the socket is a `tls`
 * socket, and a verification failure surfaces as `upstream_tls_error`.
 *
 * The client never chooses a method or host from request input — the caller
 * passes a method that already came from the allowlist and the host/port that
 * already came from operator configuration.
 */

import net from "node:net";
import { StringDecoder } from "node:string_decoder";
import tls from "node:tls";
import { BridgeError } from "./errors.js";

export interface UpstreamOptions {
  readonly host: string;
  readonly port: number;
  readonly tls: boolean;
  readonly timeoutMs: number;
}

export interface UpstreamClient {
  /** Send one JSON-RPC request and resolve its `result`. */
  call(method: string, params: unknown[]): Promise<unknown>;
}

interface JsonRpcResponse {
  jsonrpc?: unknown;
  id?: unknown;
  result?: unknown;
  error?: unknown;
}

/** Maximum bytes accepted from a single upstream response. */
const MAX_RESPONSE_BYTES = 1_048_576;

/**
 * A single-shot connection per call. Fulcrum is stateless for the read-only
 * methods the bridge exposes, so a fresh connection avoids stale-socket
 * handling and keeps the timeout semantics simple.
 */
export class FulcrumClient implements UpstreamClient {
  private readonly options: UpstreamOptions;
  private nextId = 1;

  constructor(options: UpstreamOptions) {
    this.options = options;
  }

  call(method: string, params: unknown[]): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const id = this.nextId;
      this.nextId += 1;
      const payload = `${JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      })}\n`;

      let settled = false;
      let buffer = "";
      let responseBytes = 0;
      const decoder = new StringDecoder("utf8");
      let socket: net.Socket;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        fn();
      };

      const timer = setTimeout(() => {
        finish(() => reject(new BridgeError("upstream_timeout")));
      }, this.options.timeoutMs);

      const onConnect = () => {
        socket.write(payload);
      };

      const onData = (chunk: Buffer) => {
        responseBytes += chunk.length;
        buffer += decoder.write(chunk);
        if (responseBytes > MAX_RESPONSE_BYTES) {
          finish(() => reject(new BridgeError("upstream_malformed")));
          return;
        }
        const newline = buffer.indexOf("\n");
        if (newline === -1) return;
        const line = buffer.slice(0, newline);
        finish(() => {
          try {
            const parsed = JSON.parse(line) as JsonRpcResponse;
            if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) || parsed.id !== id || (parsed.jsonrpc !== undefined && parsed.jsonrpc !== "2.0")) {
              reject(new BridgeError("upstream_malformed"));
              return;
            }
            if (parsed.error !== undefined && parsed.error !== null) {
              reject(new BridgeError("upstream_unavailable"));
              return;
            }
            if (!("result" in parsed)) {
              reject(new BridgeError("upstream_malformed"));
              return;
            }
            resolve(parsed.result);
          } catch {
            reject(new BridgeError("upstream_malformed"));
          }
        });
      };

      const onError = (error: Error) => {
        const code =
          error.message.includes("certificate") ||
          error.message.includes("CERT") ||
          error.message.includes("self-signed") ||
          error.message.includes("self signed")
            ? "upstream_tls_error"
            : "upstream_unavailable";
        finish(() => reject(new BridgeError(code)));
      };

      const onClose = () => {
        finish(() => reject(new BridgeError("upstream_unavailable")));
      };

      if (this.options.tls) {
        socket = tls.connect({
          host: this.options.host,
          port: this.options.port,
          rejectUnauthorized: true,
          ...(net.isIP(this.options.host) ? {} : { servername: this.options.host }),
        });
        socket.once("secureConnect", onConnect);
      } else {
        socket = net.connect({
          host: this.options.host,
          port: this.options.port,
        });
        socket.once("connect", onConnect);
      }

      socket.on("data", onData);
      socket.on("error", onError);
      socket.on("close", onClose);
    });
  }
}
