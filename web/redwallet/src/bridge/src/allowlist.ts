/**
 * The bridge method allowlist.
 *
 * A request names a *bridge* method. The bridge maps it to a fixed upstream
 * Electrum/Fulcrum method. The upstream method and the upstream host are
 * chosen here and in configuration — never from the request body. There is no
 * route that accepts an arbitrary upstream method or host.
 *
 * Only read-only methods are present. There is deliberately no signing,
 * transaction-construction, or broadcast route.
 */

export type BridgeMethod =
  | "server.version"
  | "server.features"
  | "server.status"
  | "address.balance"
  | "address.history"
  | "fee.estimate"
  | "headers.checkpoint";

export interface MethodSpec {
  /** The fixed upstream Electrum method this bridge method maps to. */
  readonly upstreamMethod: string;
  /** How the bridge validates and forwards the request params. */
  readonly params: "none" | "scripthash" | "target_blocks" | "height";
}

export const ALLOWLIST: Readonly<Record<BridgeMethod, MethodSpec>> = {
  "server.version": {
    upstreamMethod: "server.version",
    params: "none",
  },
  "server.status": {
    upstreamMethod: "blockchain.headers.subscribe",
    params: "none",
  },
  "server.features": {
    upstreamMethod: "server.features",
    params: "none",
  },
  "address.balance": {
    upstreamMethod: "blockchain.scripthash.get_balance",
    params: "scripthash",
  },
  "address.history": {
    upstreamMethod: "blockchain.scripthash.get_history",
    params: "scripthash",
  },
  "fee.estimate": {
    upstreamMethod: "blockchain.estimatefee",
    params: "target_blocks",
  },
  "headers.checkpoint": {
    upstreamMethod: "blockchain.block.header",
    params: "height",
  },
};

const METHOD_NAMES = Object.keys(ALLOWLIST) as BridgeMethod[];

/** True when `name` is an allowlisted bridge method. */
export function isBridgeMethod(name: unknown): name is BridgeMethod {
  return typeof name === "string" && METHOD_NAMES.includes(name as BridgeMethod);
}

/** The allowlisted method names, for documentation and tests. */
export function bridgeMethodNames(): readonly BridgeMethod[] {
  return METHOD_NAMES;
}
