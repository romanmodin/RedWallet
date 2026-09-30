import { sha256 } from "@noble/hashes/sha2";
import { Transaction, address, networks } from "bitcoinjs-lib";
/** Bounded Electrum WebSocket transport. Public data and signed bytes only. */
import type {
  ProviderActor,
  ProviderConnection,
  ProviderInfo,
} from "./providerService";
import {
  XBT_CHECKPOINT_HASH,
  XBT_CHECKPOINT_HEADER,
  XBT_CHECKPOINT_HEIGHT,
  validateWebsocketProvider,
} from "./websocketConfig";

const TXID = /^[0-9a-f]{64}$/;
const HEX = /^(?:[0-9a-f]{2})+$/;
const MAX_MONEY = 2_100_000_000_000_000;
export type DirectMethod = keyof ProviderActor | "info";
export const DIRECT_METHODS: readonly DirectMethod[] = [
  "info",
  "getBridgeStatus",
  "getServerStatus",
  "getAddressBalance",
  "getAddressHistory",
  "getAddressUtxos",
  "getFeeEstimate",
  "getRawTransaction",
  "broadcastSignedTransaction",
];
function malformed(): never {
  throw Error("Fulcrum returned invalid or oversized data.");
}
function integer(value: unknown, min = 0, max = MAX_MONEY): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    malformed();
  return value;
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !TXID.test(value)) malformed();
  return value;
}
function rawHex(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 200_000 ||
    !HEX.test(value)
  )
    malformed();
  return value;
}
function scriptHash(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 90)
    throw Error("Invalid public address.");
  let script: Uint8Array;
  try {
    script = address.toOutputScript(value, networks.bitcoin);
  } catch {
    throw Error("Invalid public address.");
  }
  return Array.from(sha256(script).reverse(), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
}
function signedTransaction(raw: unknown, expected: unknown): string {
  const hex = rawHex(raw);
  const txid = hash(expected);
  const tx = Transaction.fromHex(hex);
  if (
    tx.getId() !== txid ||
    tx.toHex() !== hex ||
    tx.version !== 2 ||
    tx.locktime !== 0 ||
    tx.ins.length < 1 ||
    tx.ins.length > 100 ||
    tx.outs.length < 1 ||
    tx.outs.length > 2
  )
    throw Error("Signed transaction does not match the supported XBT format.");
  const outpoints = new Set<string>();
  for (const input of tx.ins) {
    const key = `${Array.from(input.hash).join(",")}:${input.index}`;
    if (
      outpoints.has(key) ||
      input.hash.every((v) => v === 0) ||
      input.index === 0xffffffff ||
      input.script.length ||
      input.sequence !== 0xfffffffd ||
      input.witness.length !== 2 ||
      input.witness[0].length < 9 ||
      input.witness[0].length > 73 ||
      input.witness[0].at(-1) !== 0x21 ||
      input.witness[1].length !== 33 ||
      ![2, 3].includes(input.witness[1][0])
    )
      throw Error(
        "Signed transaction does not match the supported XBT format.",
      );
    outpoints.add(key);
    const sig = input.witness[0];
    const r = sig[3];
    const s = sig[5 + r];
    if (
      sig[0] !== 0x30 ||
      sig[1] !== sig.length - 3 ||
      sig[2] !== 2 ||
      r < 1 ||
      r > 33 ||
      5 + r >= sig.length ||
      sig[4] & 0x80 ||
      (r > 1 && sig[4] === 0 && !(sig[5] & 0x80)) ||
      sig[4 + r] !== 2 ||
      s < 1 ||
      s > 33 ||
      r + s + 7 !== sig.length ||
      sig[6 + r] & 0x80 ||
      (s > 1 && sig[6 + r] === 0 && !(sig[7 + r] & 0x80))
    )
      throw Error(
        "Signed transaction does not match the supported XBT format.",
      );
  }
  let total = 0n;
  for (const output of tx.outs) {
    total += output.value;
    if (
      output.value < 294n ||
      total > BigInt(MAX_MONEY) ||
      output.script.length !== 22 ||
      output.script[0] !== 0 ||
      output.script[1] !== 20
    )
      throw Error(
        "Signed transaction does not match the supported XBT format.",
      );
  }
  return hex;
}

export class DirectFulcrum {
  readonly endpoint: string;
  private socket: WebSocket | null = null;
  private opening: Promise<void> | null = null;
  private handshake: Promise<unknown> | null = null;
  private pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private nextId = 0;
  private stopped = false;
  private version: string[] = [];
  constructor(
    endpoint: string,
    private makeSocket = (url: string) => new WebSocket(url),
    private clock = () => Date.now(),
  ) {
    this.endpoint = validateWebsocketProvider({ endpoint }).endpoint;
  }
  close() {
    this.stopped = true;
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(
        Error("Direct Fulcrum connection closed; no relay fallback was used."),
      );
    }
    this.pending.clear();
    this.socket?.close();
  }
  private open(): Promise<void> {
    if (this.stopped)
      return Promise.reject(Error("Direct Fulcrum connection closed."));
    if (this.opening) return this.opening;
    this.opening = new Promise<void>((resolve, reject) => {
      const socket = this.makeSocket(this.endpoint);
      this.socket = socket;
      let opened = false;
      const timer = setTimeout(() => {
        reject(
          Error(
            "Home WebSocket unreachable. Check WSS, its certificate, and network access.",
          ),
        );
        this.close();
      }, 15000);
      socket.onopen = () => {
        clearTimeout(timer);
        opened = true;
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(
          Error(
            "Home WebSocket unavailable. Check WSS, its certificate, and network access.",
          ),
        );
        this.close();
      };
      socket.onclose = () => {
        clearTimeout(timer);
        if (!opened) reject(Error("Home WebSocket closed before connecting."));
        this.close();
      };
      socket.onmessage = (event) => {
        try {
          if (
            typeof event.data !== "string" ||
            event.data.length > 1_000_000 ||
            new TextEncoder().encode(event.data).length > 1_000_000
          )
            malformed();
          const data = JSON.parse(event.data);
          if (!data || typeof data !== "object" || Array.isArray(data))
            malformed();
          // Subscription notifications are not replies and never resolve an outstanding call.
          if (data.id === undefined && typeof data.method === "string") return;
          if (!Number.isSafeInteger(data.id)) malformed();
          const item = this.pending.get(data.id);
          if (!item) return;
          this.pending.delete(data.id);
          clearTimeout(item.timer);
          if (data.error != null)
            item.reject(
              Error(
                "Fulcrum rejected the request; transaction submission may be unknown.",
              ),
            );
          else if (!("result" in data)) {
            item.reject(Error("Invalid Fulcrum reply."));
            this.close();
          } else item.resolve(data.result);
        } catch {
          this.close();
        }
      };
    });
    return this.opening;
  }
  private async rpc(method: string, params: unknown[]): Promise<unknown> {
    await this.open();
    if (this.stopped || this.pending.size >= 16)
      throw Error("Direct Fulcrum is unavailable or busy.");
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          Error(
            "Direct Fulcrum timed out; any submission outcome remains unknown.",
          ),
        );
        this.close();
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket!.send(
          JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        );
      } catch {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(Error("Direct Fulcrum disconnected."));
        this.close();
      }
    });
  }
  private async ready() {
    this.handshake ??= this.rpc("server.version", [
      "RedWallet-Web",
      "1.4",
    ]).then((v) => {
      if (
        !Array.isArray(v) ||
        v.length !== 2 ||
        v.some((x) => typeof x !== "string" || x.length > 256)
      )
        malformed();
      this.version = v;
    });
    await this.handshake;
  }
  private async status() {
    await this.ready();
    const header = await this.rpc("blockchain.block.header", [
      Number(XBT_CHECKPOINT_HEIGHT),
    ]);
    if (
      typeof header !== "string" ||
      header.toLowerCase() !== XBT_CHECKPOINT_HEADER
    )
      throw Error(
        "XBT checkpoint verification failed; this Fulcrum was rejected.",
      );
    const tip = (await this.rpc("blockchain.headers.subscribe", [])) as {
      height?: unknown;
      hex?: unknown;
    };
    if (
      !tip ||
      typeof tip !== "object" ||
      typeof tip.hex !== "string" ||
      !/^(?:[a-f0-9]{2}){80,2048}$/i.test(tip.hex)
    )
      malformed();
    const height = integer(
      tip.height,
      Number(XBT_CHECKPOINT_HEIGHT),
      100_000_000,
    );
    const bytes = Uint8Array.from(tip.hex.match(/../g)!, (b) =>
      Number.parseInt(b, 16),
    );
    const tipTimestamp = new DataView(bytes.buffer).getUint32(68, true);
    const delta = this.clock() - tipTimestamp * 1000;
    if (tipTimestamp === 0 || Math.abs(delta) > 7_200_000)
      throw Error("Fulcrum chain tip is stale or has an invalid time.");
    return {
      height: BigInt(height),
      tipTimestamp: BigInt(tipTimestamp),
      serverVersion: this.version[0],
      protocolVersion: this.version[1],
      checkpointConfigured: true,
      checkpointHeight: XBT_CHECKPOINT_HEIGHT,
      checkpointHash: XBT_CHECKPOINT_HASH,
      broadcastEnabled: true,
    };
  }
  async call(method: DirectMethod, args: unknown[]): Promise<unknown> {
    const counts: Record<DirectMethod, number> = {
      info: 0,
      getBridgeStatus: 0,
      getServerStatus: 0,
      getAddressBalance: 1,
      getAddressHistory: 1,
      getAddressUtxos: 1,
      getFeeEstimate: 0,
      getRawTransaction: 1,
      broadcastSignedTransaction: 2,
    };
    if (
      !DIRECT_METHODS.includes(method) ||
      !Array.isArray(args) ||
      args.length !== counts[method]
    )
      throw Error("Unsupported direct Fulcrum request.");
    if (method === "info") {
      const s = await this.status();
      const url = new URL(this.endpoint);
      return {
        host: url.hostname,
        port: BigInt(url.port || 443),
        tls: true,
        endpoint: this.endpoint,
        height: s.height,
        tipTimestamp: s.tipTimestamp,
        checkpointHeight: s.checkpointHeight,
        checkpointHash: s.checkpointHash,
      } satisfies ProviderInfo;
    }
    if (method === "getBridgeStatus") {
      await this.status();
      return { configured: true, checkpointConfigured: true };
    }
    if (method === "getServerStatus")
      return { __kind__: "ok", ok: await this.status() };
    // Validate public arguments before opening a socket. No arbitrary RPC or key material is accepted.
    const scripthash = [
      "getAddressBalance",
      "getAddressHistory",
      "getAddressUtxos",
    ].includes(method)
      ? scriptHash(args[0])
      : "";
    const txid = method === "getRawTransaction" ? hash(args[0]) : "";
    const signed =
      method === "broadcastSignedTransaction"
        ? signedTransaction(args[0], args[1])
        : "";
    await this.ready();
    let result: unknown;
    if (method === "getAddressBalance") {
      const balance = (await this.rpc("blockchain.scripthash.get_balance", [
        scripthash,
      ])) as { confirmed: unknown; unconfirmed: unknown };
      if (!balance || typeof balance !== "object") malformed();
      result = {
        confirmed: BigInt(integer(balance.confirmed)),
        unconfirmed: BigInt(integer(balance.unconfirmed, -MAX_MONEY)),
      };
    } else if (method === "getAddressHistory") {
      const history = await this.rpc("blockchain.scripthash.get_history", [
        scripthash,
      ]);
      if (!Array.isArray(history) || history.length > 1000) malformed();
      const seen = new Set<string>();
      result = {
        entries: history.map((row) => {
          if (!row || typeof row !== "object") malformed();
          const id = hash(row.tx_hash);
          if (seen.has(id)) malformed();
          seen.add(id);
          return {
            txid: id,
            height: BigInt(integer(row.height, -1, 100_000_000)),
          };
        }),
      };
    } else if (method === "getAddressUtxos") {
      const coins = await this.rpc("blockchain.scripthash.listunspent", [
        scripthash,
      ]);
      if (!Array.isArray(coins) || coins.length > 1000) malformed();
      const seen = new Set<string>();
      result = {
        utxos: coins.map((row) => {
          if (!row || typeof row !== "object") malformed();
          const txid = hash(row.tx_hash);
          const vout = integer(row.tx_pos, 0, 0xffffffff);
          const key = `${txid}:${vout}`;
          if (seen.has(key)) malformed();
          seen.add(key);
          return {
            txid,
            vout,
            height: BigInt(integer(row.height, 0, 100_000_000)),
            value: BigInt(integer(row.value)),
          };
        }),
      };
    } else if (method === "getRawTransaction") {
      const hex = rawHex(
        await this.rpc("blockchain.transaction.get", [txid, false]),
      );
      if (Transaction.fromHex(hex).getId() !== txid) malformed();
      result = { hex };
    } else if (method === "getFeeEstimate") {
      const fee = await this.rpc("blockchain.estimatefee", [2]);
      if (
        typeof fee !== "number" ||
        !Number.isFinite(fee) ||
        fee < 0 ||
        fee > 0.01
      )
        throw Error("Fulcrum fee estimate unavailable or outside limits.");
      // Convert the received decimal exactly and round fractional satoshis up.
      const [decimal, exponent = "0"] = String(fee).split("e");
      const [whole, fraction = ""] = decimal.split(".");
      const digits = BigInt(whole + fraction);
      const scale = Number(exponent) - fraction.length + 8;
      const divisor = 10n ** BigInt(Math.max(0, -scale));
      result = {
        satoshisPerKb:
          scale >= 0
            ? digits * 10n ** BigInt(scale)
            : (digits + divisor - 1n) / divisor,
      };
    } else {
      await this.status();
      const submitted = await this.rpc("blockchain.transaction.broadcast", [
        signed,
      ]);
      if (submitted !== args[1])
        throw Error(
          "Transaction reply did not match; submission outcome is unknown.",
        );
      result = { txid: submitted, outcome: "acknowledged" };
    }
    return { __kind__: "ok", ok: result };
  }
}

/** Worker-side implementation is exposed separately for real protocol tests. */
export function directConnection(
  endpoint: string,
  call: (method: DirectMethod, args: unknown[]) => Promise<unknown>,
  close: () => void,
): ProviderConnection {
  const actor = Object.fromEntries(
    DIRECT_METHODS.filter((m) => m !== "info").map((method) => [
      method,
      (...args: unknown[]) => call(method, args),
    ]),
  ) as unknown as ProviderActor;
  return {
    id: `wss:${endpoint}`,
    actor,
    info: () => call("info", []) as Promise<ProviderInfo>,
    close,
  };
}
