import { ManualFiatEstimate } from "@/components/settings/ManualFiatEstimate";
import {
  NeoxexPriceStore,
  PRICE_CACHE_KEY,
  neoxexPrices,
  parseNeoxexQuote,
} from "@/services/neoxexPrice";
import {
  LocalSettingsService,
  settingsService,
} from "@/services/settingsService";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const now = Date.parse("2026-09-30T20:00:00Z");
const response = (patch: Record<string, unknown> = {}) =>
  JSON.stringify({
    success: true,
    pair: "BTCB2_USDC",
    trades: [
      {
        trade_id: "TRD-TEST",
        price: 355.15,
        executed_at: "2026-09-30T19:59:00.000Z",
        ...patch,
      },
    ],
  });
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("accepts the exact XBT/USDC trade and preserves its execution time", () => {
  expect(parseNeoxexQuote(response(), now)).toMatchObject({
    price: 355.15,
    pair: "BTCB2_USDC",
    tradeAt: now - 60000,
    checkedAt: now,
  });
  for (const patch of [
    { price: -1 },
    { price: "355" },
    { price: 1e13 },
    { trade_id: "" },
    { executed_at: "2026-02-30T00:00:00Z" },
    { executed_at: "2026-09-30T20:02:00Z" },
    { executed_at: "2026-09-30 19:59:00" },
  ])
    expect(() => parseNeoxexQuote(response(patch), now)).toThrow();
  for (const body of [
    response().replace("BTCB2_USDC", "BTC_USDC"),
    response().replace('"success":true', '"success":false'),
    "x".repeat(16385),
    '{"success":true,"pair":"BTCB2_USDC","trades":[]}',
  ])
    expect(() => parseNeoxexQuote(body, now)).toThrow();
});
it("deduplicates callers, throttles refresh, retains failed quotes and restores them", async () => {
  let clock = now;
  let resolve!: (body: string) => void;
  const request = vi.fn(
    () =>
      new Promise<string>((r) => {
        resolve = r;
      }),
  );
  const store = new NeoxexPriceStore(request, () => clock);
  const first = store.refresh();
  const second = store.refresh();
  expect(first).toBe(second);
  expect(request).toHaveBeenCalledTimes(1);
  resolve(response());
  await first;
  const saved = localStorage.getItem(PRICE_CACHE_KEY);
  await store.refresh(true);
  expect(request).toHaveBeenCalledTimes(1);
  clock += 300000;
  request.mockImplementationOnce(async () => {
    throw Error("exchange unavailable");
  });
  await store.refresh();
  expect(store.getSnapshot()).toMatchObject({
    quote: { price: 355.15, tradeAt: now - 60000 },
    error: expect.stringContaining("retained"),
  });
  expect(localStorage.getItem(PRICE_CACHE_KEY)).toBe(saved);
  const reopened = new NeoxexPriceStore(request, () => clock);
  reopened.restore();
  expect(reopened.getSnapshot().quote?.price).toBe(355.15);
  expect(request).toHaveBeenCalledTimes(2);
});
it("rejects an older or altered trade without replacing the saved quote", async () => {
  let clock = now;
  const request = vi.fn(async () => response());
  const store = new NeoxexPriceStore(request, () => clock);
  await store.refresh();
  clock += 300000;
  request.mockResolvedValueOnce(response({ price: 999 }));
  await store.refresh();
  expect(store.getSnapshot().quote?.price).toBe(355.15);
  clock += 300000;
  request.mockResolvedValueOnce(
    response({ trade_id: "OTHER", executed_at: "2026-09-30T19:00:00Z" }),
  );
  await store.refresh();
  expect(store.getSnapshot().quote?.tradeAt).toBe(now - 60000);
});
it("times out without overlapping a still unresolved request or using its late result", async () => {
  vi.useFakeTimers();
  let resolve!: (body: string) => void;
  const request = vi.fn(
    () =>
      new Promise<string>((r) => {
        resolve = r;
      }),
  );
  const store = new NeoxexPriceStore(request, () => now);
  const pending = store.refresh();
  await vi.advanceTimersByTimeAsync(35000);
  expect(store.getSnapshot()).toMatchObject({
    loading: false,
    error: expect.stringContaining("timed out"),
  });
  void store.refresh(true);
  expect(request).toHaveBeenCalledTimes(1);
  resolve(response());
  await pending;
  expect(store.getSnapshot().quote).toBeNull();
});
it("defaults new settings to Auto, preserves legacy manual price and keeps both modes independent", () => {
  const settings = new LocalSettingsService();
  expect(settings.getSettings()).toMatchObject({
    value: { priceMode: "auto" },
  });
  localStorage.setItem(
    "redwallet.settings.v1",
    JSON.stringify({ manualUsdPerXbt: 123 }),
  );
  expect(settings.getSettings()).toMatchObject({
    value: { priceMode: "manual", manualUsdPerXbt: 123 },
  });
  settings.updateSettings({ priceMode: "auto" });
  expect(settings.getSettings()).toMatchObject({
    value: { priceMode: "auto", manualUsdPerXbt: 123 },
  });
  settings.updateSettings({ priceMode: "manual" });
  expect(settings.getSettings()).toMatchObject({
    value: { priceMode: "manual", manualUsdPerXbt: 123 },
  });
});
it("switches displayed USD/USDC estimates, labels stale trade time, and makes no requests in Manual or background", async () => {
  const refresh = vi.spyOn(neoxexPrices, "refresh").mockResolvedValue();
  const restore = vi
    .spyOn(neoxexPrices, "restore")
    .mockImplementation(() => {});
  settingsService.updateSettings({
    priceMode: "manual",
    manualUsdPerXbt: 375.25,
    manualPriceUpdatedAt: Date.now(),
  });
  render(<ManualFiatEstimate satoshis={1000000n} />);
  expect(screen.getByText(/3.75 USD/)).toBeInTheDocument();
  expect(refresh).not.toHaveBeenCalled();
  act(() => settingsService.updateSettings({ priceMode: "auto" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  fireEvent(document, new Event("visibilitychange"));
  expect(refresh).toHaveBeenCalledTimes(1);
  act(() => settingsService.updateSettings({ priceMode: "manual" }));
  expect(screen.getByText(/3.75 USD/)).toBeInTheDocument();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  restore.mockRestore();
});
it("shows the cached USDC estimate and stale execution time, independently of the saved manual quote", () => {
  vi.spyOn(neoxexPrices, "refresh").mockResolvedValue();
  localStorage.setItem(
    PRICE_CACHE_KEY,
    JSON.stringify(
      parseNeoxexQuote(response({ executed_at: "2026-09-30T19:00:00Z" }), now),
    ),
  );
  settingsService.updateSettings({ priceMode: "auto", manualUsdPerXbt: 999 });
  render(<ManualFiatEstimate satoshis={1000000n} />);
  expect(screen.getByText(/3.55 USDC/)).toBeInTheDocument();
  expect(screen.getByText(/Stale price/)).toBeInTheDocument();
  expect(screen.getByText(/not an exact USD conversion/)).toBeInTheDocument();
  expect(screen.queryByText(/9.99 USD/)).toBeNull();
  act(() => settingsService.updateSettings({ priceMode: "manual" }));
  expect(screen.getByText(/9.99 USD/)).toBeInTheDocument();
});
