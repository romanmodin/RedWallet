import { capSuggestedFeeRate, requiresHighFeeApproval } from '../../class/xbt/fee-policy';
it.each([Infinity, NaN, -1, 0])('rejects invalid suggested fee rate %s', rate => {
  expect(capSuggestedFeeRate(rate)).toBe(1);
});
it('caps server estimates without rewriting a user fee', () => {
  expect(capSuggestedFeeRate(10000)).toBe(100);
  expect(capSuggestedFeeRate(2)).toBe(2);
});
it('requires a separate approval for excessive fee rate, absolute fee, or payment fraction', () => {
  expect(requiresHighFeeApproval({ feeSats: 200, feeRate: 2, amountSats: 10000 })).toBe(false);
  expect(requiresHighFeeApproval({ feeSats: 200, feeRate: 101, amountSats: 10000 })).toBe(true);
  expect(
    requiresHighFeeApproval({
      feeSats: 100001,
      feeRate: 2,
      amountSats: 10000000,
    }),
  ).toBe(true);
  expect(requiresHighFeeApproval({ feeSats: 501, feeRate: 2, amountSats: 10000 })).toBe(true);
  expect(() => requiresHighFeeApproval({ feeSats: -1, feeRate: 2, amountSats: 10000 })).toThrow();
});
