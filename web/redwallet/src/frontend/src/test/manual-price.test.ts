import { manualUsdEstimate } from "@/services/manualPrice";
import { LocalSettingsService } from "@/services/settingsService";
import { expect, it } from "vitest";

it("formats exact manual USD estimates, including sub-cent and exponential prices", () => {
  expect(manualUsdEstimate(1000000n, 0.2346)).toBe("0.002346 USD");
  expect(manualUsdEstimate(100000000n, 123.456)).toBe("123.46 USD");
  expect(manualUsdEstimate(100000000n, 1e-8)).toBe("<0.000001 USD");
  expect(manualUsdEstimate(100000000n, 1e12)).toBe("1,000,000,000,000.00 USD");
  expect(() => manualUsdEstimate(1n, Number.POSITIVE_INFINITY)).toThrow();
});
it("preserves old manual quotes with unknown age and retains new update time across reload", () => {
  const service = new LocalSettingsService();
  service.updateSettings({ manualUsdPerXbt: 12.3 });
  expect(service.getSettings()).toMatchObject({
    ok: true,
    value: { manualUsdPerXbt: 12.3, manualPriceUpdatedAt: undefined },
  });
  const now = Date.now();
  service.updateSettings({ manualPriceUpdatedAt: now });
  expect(new LocalSettingsService().getSettings()).toMatchObject({
    ok: true,
    value: { manualPriceUpdatedAt: now },
  });
  service.updateSettings({
    manualUsdPerXbt: 1e13,
    manualPriceUpdatedAt: now + 1000000,
  });
  expect(service.getSettings()).toMatchObject({
    ok: true,
    value: { manualUsdPerXbt: undefined, manualPriceUpdatedAt: undefined },
  });
});
