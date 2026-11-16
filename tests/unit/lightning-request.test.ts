import { isBolt12Offer, normalizeLightningRequest } from '../../blue_modules/lightning-request';

test('recognizes offers and optional Lightning URI without treating an invoice request as payable', () => {
  expect(isBolt12Offer(' LIGHTNING:LNO1QPZ ')).toBe(true);
  expect(isBolt12Offer('lnr1qpz')).toBe(false);
  expect(normalizeLightningRequest('LIGHTNING:LNO1QPZ', true)).toBe('lno1qpz');
  expect(normalizeLightningRequest('lightning:LNBC100N1QPZ', true)).toBe('lnbc100n1qpz');
});
test.each(['lno1Qpz', 'lno1q?', 'lni1qpz', 'lnr1qpz', 'lno1' + 'q'.repeat(32765)])('rejects malformed/unsupported input %s', text => {
  expect(() => normalizeLightningRequest(text, true)).toThrow();
});
test('gates offers on the native bridge and accepts larger valid offer QR payloads', () => {
  expect(() => normalizeLightningRequest('lno1qpz', false)).toThrow();
  expect(normalizeLightningRequest('lno1' + 'q'.repeat(9000), true)).toHaveLength(9004);
  expect(() => normalizeLightningRequest('lnbc1' + 'q'.repeat(9000), true)).toThrow();
});
