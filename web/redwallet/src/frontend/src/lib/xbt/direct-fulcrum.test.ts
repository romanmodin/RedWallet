import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DirectFulcrum } from "@/services/directFulcrum";
import {
  XBT_CHECKPOINT_HEADER,
  validateWebsocketProvider,
} from "@/services/websocketConfig";
import { Transaction } from "bitcoinjs-lib";
import { describe, expect, it, vi } from "vitest";

// Published, unfunded regtest signatures. Never sign or submit to a real node.
const fixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "src/lib/xbt/compatibility-fixture.json"),
    "utf8",
  ),
);
const now = Date.now();
const tipBytes = new Uint8Array(164);
new DataView(tipBytes.buffer).setUint32(68, Math.floor(now / 1000), true);
const tipHex = Array.from(tipBytes, (v) =>
  v.toString(16).padStart(2, "0"),
).join("");
type Request = { id: number; method: string; params: unknown[] };
class ProtocolSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(private handler: (request: Request) => unknown) {
    queueMicrotask(() => this.onopen?.());
  }
  send(text: string) {
    const request = JSON.parse(text);
    queueMicrotask(() => {
      if (this.closed) return;
      const result = this.handler(request);
      this.onmessage?.({
        data: JSON.stringify({ id: request.id, jsonrpc: "2.0", result }),
      });
    });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
}
function server(overrides: Record<string, unknown> = {}) {
  const calls: Request[] = [];
  const defaults: Record<string, unknown> = {
    "server.version": ["Fulcrum-2.1.2", "1.4"],
    "blockchain.block.header": XBT_CHECKPOINT_HEADER,
    "blockchain.headers.subscribe": { height: 974920, hex: tipHex },
    "blockchain.scripthash.get_balance": { confirmed: 123, unconfirmed: -3 },
    "blockchain.scripthash.get_history": [
      { tx_hash: fixture.txid, height: 974910 },
    ],
    "blockchain.scripthash.listunspent": [
      { tx_hash: fixture.txid, tx_pos: 0, height: 974910, value: 90000 },
    ],
    "blockchain.estimatefee": 0.00001,
    "blockchain.transaction.get": fixture.hex,
    "blockchain.transaction.broadcast": fixture.txid,
  };
  const socket = new ProtocolSocket((request) => {
    calls.push(request);
    return Object.hasOwn(overrides, request.method)
      ? overrides[request.method]
      : defaults[request.method];
  });
  const make = vi.fn(() => socket as unknown as WebSocket);
  const client = new DirectFulcrum(
    "wss://home.example:50004/",
    make,
    () => now,
  );
  return { client, socket, calls, make };
}
describe("direct Fulcrum protocol", () => {
  it("accepts one WSS address and rejects TCP, insecure WS, credentials and malformed URLs", () => {
    expect(
      validateWebsocketProvider({ endpoint: "  wss://home.example:50004  " })
        .endpoint,
    ).toBe("wss://home.example:50004/");
    for (const endpoint of [
      "",
      "not a url",
      "home.example:50002",
      "ws://home.example",
      "https://home.example",
      "wss://user:password@home.example",
      "wss://home.example?token=secret",
      "wss://home.example#fragment",
    ])
      expect(() => validateWebsocketProvider({ endpoint })).toThrow();
  });
  it("negotiates Electrum before verifying the exact extended XBT checkpoint and fresh tip", async () => {
    const f = server();
    const info = await f.client.call("info", []);
    expect(info).toMatchObject({
      host: "home.example",
      port: 50004n,
      height: 974920n,
      checkpointHeight: 961640n,
    });
    expect(f.calls.map((c) => c.method)).toEqual([
      "server.version",
      "blockchain.block.header",
      "blockchain.headers.subscribe",
    ]);
    expect(f.calls[0].params).toEqual(["RedWallet-Web", "1.4"]);
    f.client.close();
  });
  it("rejects a different checkpoint and stale tip", async () => {
    const wrong = server({ "blockchain.block.header": "00".repeat(164) });
    await expect(wrong.client.call("info", [])).rejects.toThrow(/checkpoint/);
    wrong.client.close();
    const stale = server({
      "blockchain.headers.subscribe": { height: 974920, hex: "00".repeat(164) },
    });
    await expect(stale.client.call("info", [])).rejects.toThrow(/stale/);
    stale.client.close();
  });
  it("maps every wallet read to bounded Electrum requests with no shared relay", async () => {
    const f = server();
    expect(
      await f.client.call("getAddressBalance", [fixture.plan.destination]),
    ).toEqual({ __kind__: "ok", ok: { confirmed: 123n, unconfirmed: -3n } });
    expect(
      await f.client.call("getAddressHistory", [fixture.plan.destination]),
    ).toMatchObject({
      ok: { entries: [{ txid: fixture.txid, height: 974910n }] },
    });
    expect(
      await f.client.call("getAddressUtxos", [fixture.plan.destination]),
    ).toMatchObject({ ok: { utxos: [{ value: 90000n, vout: 0 }] } });
    expect(await f.client.call("getFeeEstimate", [])).toMatchObject({
      ok: { satoshisPerKb: 1000n },
    });
    expect(
      await f.client.call("getRawTransaction", [fixture.txid]),
    ).toMatchObject({ ok: { hex: fixture.hex } });
    const query = f.calls.find(
      (c) => c.method === "blockchain.scripthash.get_balance",
    )!;
    expect(query.params[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(query.params).not.toContain(fixture.plan.destination);
    f.client.close();
  });
  it("rejects unsafe amounts, oversized histories, duplicate coins and mismatched raw transaction IDs", async () => {
    for (const [method, overrides, args] of [
      [
        "getAddressBalance",
        {
          "blockchain.scripthash.get_balance": {
            confirmed: 1.5,
            unconfirmed: 0,
          },
        },
        [fixture.plan.destination],
      ],
      [
        "getAddressHistory",
        {
          "blockchain.scripthash.get_history": Array(1001).fill({
            tx_hash: fixture.txid,
            height: 1,
          }),
        },
        [fixture.plan.destination],
      ],
      [
        "getAddressUtxos",
        {
          "blockchain.scripthash.listunspent": Array(2).fill({
            tx_hash: fixture.txid,
            tx_pos: 0,
            height: 1,
            value: 1,
          }),
        },
        [fixture.plan.destination],
      ],
      ["getRawTransaction", {}, ["a".repeat(64)]],
      ["getFeeEstimate", { "blockchain.estimatefee": -1 }, []],
    ] as const) {
      const f = server(overrides);
      await expect(f.client.call(method, [...args])).rejects.toThrow();
      f.client.close();
    }
  });
  it("rejects invalid public inputs and unsupported methods before opening a socket", async () => {
    const f = server();
    await expect(
      f.client.call("getAddressBalance", ["not an address"]),
    ).rejects.toThrow();
    await expect(
      f.client.call("getRawTransaction", ["private material"]),
    ).rejects.toThrow();
    await expect(
      f.client.call("broadcastSignedTransaction", ["00", "a".repeat(64)]),
    ).rejects.toThrow();
    await expect(
      f.client.call("arbitraryMethod" as never, []),
    ).rejects.toThrow();
    expect(f.make).not.toHaveBeenCalled();
    f.client.close();
  });
  it("dispatches the exact public signed fixture once and never retries a mismatched reply", async () => {
    const f = server({ "blockchain.transaction.broadcast": "a".repeat(64) });
    await expect(
      f.client.call("broadcastSignedTransaction", [fixture.hex, fixture.txid]),
    ).rejects.toThrow(/unknown/);
    const broadcasts = f.calls.filter(
      (c) => c.method === "blockchain.transaction.broadcast",
    );
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].params).toEqual([fixture.hex]);
    f.client.close();
  });
  it("rejects BTC SIGHASH_ALL and closes outstanding requests without any reconnect", async () => {
    const f = server();
    const tx = Transaction.fromHex(fixture.hex);
    tx.ins[0].witness[0][tx.ins[0].witness[0].length - 1] = 1;
    await expect(
      f.client.call("broadcastSignedTransaction", [tx.toHex(), tx.getId()]),
    ).rejects.toThrow(/XBT format/);
    expect(f.make).not.toHaveBeenCalled();
    f.client.close();
    await expect(f.client.call("info", [])).rejects.toThrow(/closed/);
    expect(f.make).not.toHaveBeenCalled();
  });
});
