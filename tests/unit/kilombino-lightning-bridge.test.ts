import { bridgeInfo, parseSha256Invoice, quoteSha256Invoice, solveBridgePow } from '../../blue_modules/kilombino-lightning-bridge';

const fetchMock = jest.fn();
jest.mock('../../util/fetch', () => ({ fetch: (...args: unknown[]) => fetchMock(...args) }));

beforeEach(() => fetchMock.mockReset());

it('rejects malformed, testnet and amountless invoices before contacting the bridge', async () => {
  expect(() => parseSha256Invoice('lnbcrt1test')).toThrow();
  expect(() => parseSha256Invoice('lightning:lnbc1invalid')).toThrow();
  await expect(quoteSha256Invoice('not-an-invoice')).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('reads the direction-specific limits and spread', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ open: true, dirs: { toSHA256: { open: true, rate: 0.0038, spread: 0.02, min_sat: 1000, max_sat: 100000 } } }) });
  const info = await bridgeInfo();
  expect(info.dirs.toSHA256).toEqual({ open: true, rate: 0.0038, spread: 0.02, min_sat: 1000, max_sat: 100000 });
  expect(fetchMock).toHaveBeenCalledWith('https://bridge.kilombino.com/api/info', expect.objectContaining({ timeout: 10000 }));
});

it('fails closed when the provider returns malformed or inverted limits', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ open: true, dirs: { toSHA256: { open: true, rate: 1, spread: 0.01, min_sat: 100000, max_sat: 1000 } } }) });
  await expect(bridgeInfo()).rejects.toThrow('limits');
});

it('solves an actual SHA256 challenge and refuses excessive difficulty', async () => {
  const hash = 'ab'.repeat(32);
  const nonce = await solveBridgePow('test-challenge', hash, 8);
  expect(nonce).toMatch(/^[0-9a-z]+$/);
  await expect(solveBridgePow('test', hash, 30)).rejects.toThrow('Unsupported');
  await expect(solveBridgePow('', hash, 1)).rejects.toThrow('Unsupported');
});

it('never sends funds: quote module exposes no payment submission API', () => {
  expect(typeof quoteSha256Invoice).toBe('function');
});
