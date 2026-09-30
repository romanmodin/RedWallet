import {
  type createActorFunction,
  createActorWithConfig,
} from "@caffeineai/core-infrastructure";
import { Actor, HttpAgent } from "@icp-sdk/core/agent";
import { IDL } from "@icp-sdk/core/candid";

export const PRICE_CACHE_KEY = "redwallet.neoxex-price.v1";
export const PRICE_INTERVAL = 5 * 60 * 1000;
export interface NeoxexQuote {
  price: number;
  tradeAt: number;
  checkedAt: number;
  tradeId: string;
  pair: "BTCB2_USDC";
}
export interface PriceState {
  quote: NeoxexQuote | null;
  loading: boolean;
  error: string | null;
}
type PriceActor = {
  getNeoxexPrice(): Promise<{ ok: string } | { err: string }>;
};
// Dedicated public contract; deployment ID/agent use the existing runtime.
const factory: createActorFunction<PriceActor> = (
  canisterId,
  _upload,
  _download,
  options,
) =>
  Actor.createActor<PriceActor>(
    () =>
      IDL.Service({
        getNeoxexPrice: IDL.Func(
          [],
          [IDL.Variant({ ok: IDL.Text, err: IDL.Text })],
          [],
        ),
      }),
    {
      agent: options.agent ?? HttpAgent.createSync(options.agentOptions),
      canisterId,
      ...options.actorOptions,
    },
  );
let priceActor: Promise<PriceActor> | null = null;
async function requestPrice(): Promise<string> {
  priceActor ??= createActorWithConfig(factory).catch((error) => {
    priceActor = null;
    throw error;
  });
  const result = await (await priceActor).getNeoxexPrice();
  if ("err" in result) throw Error("NeoxEX price is temporarily unavailable");
  return result.ok;
}
function validTime(value: unknown, now: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= now + 60000 &&
    Number.isFinite(new Date(value).getTime())
  );
}
export function validateQuote(value: unknown, now = Date.now()): NeoxexQuote {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid NeoxEX quote");
  const q = value as NeoxexQuote;
  if (
    q.pair !== "BTCB2_USDC" ||
    typeof q.price !== "number" ||
    !Number.isFinite(q.price) ||
    q.price <= 0 ||
    q.price > 1e12 ||
    !validTime(q.tradeAt, now) ||
    !validTime(q.checkedAt, now) ||
    q.tradeAt > q.checkedAt + 60000 ||
    typeof q.tradeId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(q.tradeId)
  )
    throw Error("Invalid NeoxEX quote");
  return {
    pair: q.pair,
    price: q.price,
    tradeAt: q.tradeAt,
    checkedAt: q.checkedAt,
    tradeId: q.tradeId,
  };
}
export function parseNeoxexQuote(body: string, now = Date.now()): NeoxexQuote {
  if (typeof body !== "string" || body.length > 16384)
    throw Error("Invalid NeoxEX response");
  const data = JSON.parse(body);
  if (
    !data ||
    data.success !== true ||
    data.pair !== "BTCB2_USDC" ||
    !Array.isArray(data.trades) ||
    data.trades.length !== 1
  )
    throw Error("Invalid NeoxEX market");
  const trade = data.trades[0];
  if (
    !trade ||
    typeof trade.executed_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(
      trade.executed_at,
    )
  )
    throw Error("Invalid trade time");
  const tradeAt = Date.parse(trade.executed_at);
  if (
    !validTime(tradeAt, now) ||
    new Date(tradeAt).toISOString().slice(0, 19) !==
      trade.executed_at.slice(0, 19)
  )
    throw Error("Invalid trade time");
  return validateQuote(
    {
      pair: data.pair,
      price: trade.price,
      tradeId: trade.trade_id,
      tradeAt,
      checkedAt: now,
    },
    now,
  );
}

/** Shared display cache; never receives wallet data or keys. */
export class NeoxexPriceStore {
  private state: PriceState = { quote: null, loading: false, error: null };
  private listeners = new Set<() => void>();
  private pending: Promise<void> | null = null;
  private attemptedAt = Number.NEGATIVE_INFINITY;
  constructor(
    private request = requestPrice,
    private now = Date.now,
    private storage = () => window.localStorage,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<PriceState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  restore = () => {
    try {
      const raw = this.storage().getItem(PRICE_CACHE_KEY);
      const quote =
        raw && raw.length <= 2048
          ? validateQuote(JSON.parse(raw), this.now())
          : null;
      this.update({ quote });
    } catch {
      this.update({ quote: null });
    }
  };
  refresh = (force = false): Promise<void> => {
    if (this.pending) return this.pending;
    const now = this.now();
    if (now - this.attemptedAt < (force ? 60000 : PRICE_INTERVAL))
      return Promise.resolve();
    this.attemptedAt = now;
    this.update({ loading: true, error: null });
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      this.update({
        loading: false,
        error: "NeoxEX refresh timed out. Last saved quote retained.",
      });
    }, 35000);
    this.pending = (async () => {
      try {
        const quote = parseNeoxexQuote(await this.request(), this.now());
        if (expired) return;
        const previous = this.state.quote;
        if (
          previous &&
          (quote.tradeAt < previous.tradeAt ||
            (quote.tradeId === previous.tradeId &&
              (quote.price !== previous.price ||
                quote.tradeAt !== previous.tradeAt)))
        )
          throw Error("Inconsistent NeoxEX trade");
        let error: string | null = null;
        try {
          this.storage().setItem(PRICE_CACHE_KEY, JSON.stringify(quote));
        } catch {
          error =
            "Quote available, but this browser could not save it for reopening.";
        }
        this.update({ quote, error });
      } catch {
        if (!expired)
          this.update({
            error:
              "NeoxEX is unavailable. Last saved quote retained; you can select Manual in Settings.",
          });
      } finally {
        clearTimeout(timer);
        this.pending = null;
        this.update({ loading: false });
      }
    })();
    return this.pending;
  };
}
export const neoxexPrices = new NeoxexPriceStore();
