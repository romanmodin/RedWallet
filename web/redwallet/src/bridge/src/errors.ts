/**
 * Safe error mapping.
 *
 * Every failure the bridge can produce is represented by a stable code and a
 * fixed, non-leaking message. Upstream error text, hostnames, ports, and
 * credentials are never forwarded to the caller.
 */

export type BridgeErrorCode =
  | "not_configured"
  | "unauthorized"
  | "invalid_request"
  | "method_not_allowed"
  | "rate_limited"
  | "payload_too_large"
  | "upstream_unavailable"
  | "upstream_tls_error"
  | "upstream_timeout"
  | "upstream_malformed"
  | "internal_error";

export interface BridgeErrorBody {
  readonly error: {
    readonly code: BridgeErrorCode;
    readonly message: string;
  };
}

const MESSAGES: Record<BridgeErrorCode, string> = {
  not_configured:
    "The bridge has no upstream Fulcrum server configured. An operator must set FULCRUM_HOST before reads are served.",
  unauthorized: "Missing or invalid bridge credentials.",
  invalid_request: "The request body is not a valid bridge request.",
  method_not_allowed: "The requested bridge method is not allowlisted.",
  rate_limited: "Too many requests. Retry later.",
  payload_too_large: "The request body exceeds the configured size limit.",
  upstream_unavailable: "The upstream Fulcrum server is unavailable.",
  upstream_tls_error: "The upstream TLS connection could not be verified.",
  upstream_timeout: "The upstream Fulcrum server did not respond in time.",
  upstream_malformed: "The upstream Fulcrum server returned an unusable response.",
  internal_error: "The bridge encountered an internal error.",
};

/** HTTP status associated with each error code. */
const STATUS: Record<BridgeErrorCode, number> = {
  not_configured: 503,
  unauthorized: 401,
  invalid_request: 400,
  method_not_allowed: 400,
  rate_limited: 429,
  payload_too_large: 413,
  upstream_unavailable: 502,
  upstream_tls_error: 502,
  upstream_timeout: 504,
  upstream_malformed: 502,
  internal_error: 500,
};

export class BridgeError extends Error {
  readonly code: BridgeErrorCode;
  readonly status: number;

  constructor(code: BridgeErrorCode) {
    super(MESSAGES[code]);
    this.name = "BridgeError";
    this.code = code;
    this.status = STATUS[code];
  }

  toBody(): BridgeErrorBody {
    return { error: { code: this.code, message: MESSAGES[this.code] } };
  }
}

/** Build the JSON body for an error code without throwing. */
export function errorBody(code: BridgeErrorCode): BridgeErrorBody {
  return { error: { code, message: MESSAGES[code] } };
}

/** HTTP status for an error code. */
export function errorStatus(code: BridgeErrorCode): number {
  return STATUS[code];
}
