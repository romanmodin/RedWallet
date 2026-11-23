import type { BridgeInvoice } from '../../blue_modules/lightning-bridge/invoice';
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
const recipient = (): BridgeInvoice => ({
  chain: 'SHA256',
  invoice: 'synthetic',
  hash: 'aa'.repeat(32),
  msat: '1000',
  expiresAt: Math.ceil(Date.now() / 1000) + 60,
  destination: '02' + '33'.repeat(32),
  cltv: 18,
});

it('reads the Paperclip bridge direction and its live limits', async () => {
  const request = jest.fn(async () => ({
    ok: true,
    status: 200,
    url: '',
    text: async () => JSON.stringify(market),
  }));
  await expect(new PaperclipProvider(request).info(signal)).resolves.toMatchObject({ open: true, minSat: 1000, maxSat: 100000 });
  expect(request).toHaveBeenCalledWith(
    'https://lightning.paperclip-xbt.xyz/bridge/api/info?direction=toSHA256',
    expect.objectContaining({ method: 'GET', credentials: 'omit' }),
  );
});
it('refuses a reversed market response', async () => {
  const request = async () => ({
    ok: true,
    status: 200,
    url: '',
    text: async () => JSON.stringify({ ...market, direction: 'toBLAKE2b' }),
  });
  await expect(new PaperclipProvider(request).info(signal)).rejects.toThrow('market');
});

it('offers Paperclip after Kilombino in the iOS payment picker', () => {
  expect(lightningBridgeProviders.map(p => p.id)).toEqual(['kilombino', 'paperclip']);
});

it.each([
  [{ hash: 'bb'.repeat(32) }, 'payment hash'],
  [{ sat: 2 }, 'invoice amount'],
  [{ wait_s: 12 }, 'wait 12 seconds'],
  [{ wait_s: 'invalid' }, 'unexpected retry interval'],
  [{ error: 'private upstream detail' }, 'declined the invoice preview'],
] as const)('stops before proof or quote for preview response %j', async (fields, message) => {
  const invoice = recipient();
  const request = jest.fn(async () => ({
    ok: true,
    status: 200,
    url: '',
    text: async () => JSON.stringify({ direction: 'toSHA256', sat: 1, hash: invoice.hash, ...fields }),
  }));
  await expect(new PaperclipProvider(request).quote(invoice, signal)).rejects.toThrow(message);
  expect(request).toHaveBeenCalledTimes(1);
});

describe.each([
  ['missing', {}],
  ['reversed', { direction: 'toBLAKE2b' }],
  ['conflicting', { direction: 'toSHA256', dir: 'toBLAKE2b' }],
  ['alias only', { dir: 'toSHA256' }],
] as const)('Paperclip with %s direction', (_, fields) => {
  const response = (body: unknown) => ({
    ok: true,
    status: 200,
    url: '',
    text: async () => JSON.stringify(body),
  });

  it('rejects the preview before requesting proof', async () => {
    const invoice = recipient();
    const request = jest.fn(async () => response({ ...fields, hash: invoice.hash, sat: 1 }));
    await expect(new PaperclipProvider(request).quote(invoice, signal)).rejects.toThrow('confirm');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects the quote after a valid preview', async () => {
    const invoice = recipient();
    const request = jest
      .fn(async () => response(fields))
      .mockResolvedValueOnce(response({ direction: 'toSHA256', hash: invoice.hash, sat: 1 }))
      .mockResolvedValueOnce(response({ challenge: 'mock', bits: 0, ttl_s: 120 }));
    await expect(new PaperclipProvider(request).quote(invoice, signal)).rejects.toThrow('quote direction');
    expect(request).toHaveBeenCalledTimes(3);
  });
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
