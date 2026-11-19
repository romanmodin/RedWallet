import { lightningBridgeProviders, PaperclipProvider } from '../../blue_modules/lightning-bridge/provider';

const market = {
  open: true,
  payments_enabled: true,
  direction: 'toSHA256',
  cap_unit: 'SHA256 sats',
  rate: 0.002,
  spread: 0.02,
  min_sat: 1000,
  max_sat: 100000,
};
const signal = new AbortController().signal;

it('reads the Paperclip bridge direction and its live limits', async () => {
  const request = jest.fn(async () => ({ ok: true, status: 200, url: '', text: async () => JSON.stringify(market) }));
  await expect(new PaperclipProvider(request).info(signal)).resolves.toMatchObject({ open: true, minSat: 1000, maxSat: 100000 });
  expect(request).toHaveBeenCalledWith(
    'https://lightning.paperclip-xbt.xyz/bridge/api/info?direction=toSHA256',
    expect.objectContaining({ method: 'GET', credentials: 'omit' }),
  );
});
it('refuses a reversed response and excludes unqualified processors from payment', async () => {
  const request = async () => ({ ok: true, status: 200, url: '', text: async () => JSON.stringify({ ...market, direction: 'toBLAKE2b' }) });
  await expect(new PaperclipProvider(request).info(signal)).rejects.toThrow('market');
  expect(lightningBridgeProviders.map(p => p.id)).not.toContain('paperclip');
});

it('stops before proof or quote if Paperclip previews a different payment hash', async () => {
  const request = jest.fn(async () => ({
    ok: true,
    status: 200,
    url: '',
    text: async () => JSON.stringify({ sat: 1, hash: 'bb'.repeat(32) }),
  }));
  const invoice = {
    chain: 'SHA256',
    invoice: 'synthetic',
    hash: 'aa'.repeat(32),
    msat: '1000',
    expiresAt: Math.ceil(Date.now() / 1000) + 60,
  } as const;
  await expect(new PaperclipProvider(request).quote(invoice as Parameters<PaperclipProvider['quote']>[0], signal)).rejects.toThrow(
    'confirm',
  );
  expect(request).toHaveBeenCalledTimes(1);
});

it('polls only the Paperclip swap bound to the original hash and token', async () => {
  const request = jest.fn(async () => ({
    ok: true,
    status: 200,
    url: '',
    text: async () => JSON.stringify({ state: 'settled', preimage: '11'.repeat(32) }),
  }));
  const hash = 'aa'.repeat(32),
    token = 'bb'.repeat(16);
  await new PaperclipProvider(request).swap(hash, token, signal);
  expect(request).toHaveBeenCalledWith(
    'https://lightning.paperclip-xbt.xyz/bridge/api/swap/' + hash + '?t=' + token,
    expect.objectContaining({ method: 'GET' }),
  );
});
