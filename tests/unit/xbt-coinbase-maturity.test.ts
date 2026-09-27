import { isCoinbaseTransaction, isMatureXbtCoinbase, XBT_COINBASE_MATURITY } from '../../class/xbt/coinbase-maturity';

describe('XBT coinbase maturity', () => {
  it('identifies the canonical coinbase input', () => {
    expect(isCoinbaseTransaction([{ txid: '0'.repeat(64), vout: 0xffffffff }])).toBe(true);
    expect(isCoinbaseTransaction([{ txid: '1'.repeat(64), vout: 0 }])).toBe(false);
    expect(isCoinbaseTransaction([])).toBe(false);
  });

  it('requires 6480 confirmations and rejects unknown or fractional counts', () => {
    expect(XBT_COINBASE_MATURITY).toBe(6480);
    expect(isMatureXbtCoinbase(6479)).toBe(false);
    expect(isMatureXbtCoinbase(6480)).toBe(true);
    expect(isMatureXbtCoinbase(undefined)).toBe(false);
    expect(isMatureXbtCoinbase(6480.5)).toBe(false);
  });
});
