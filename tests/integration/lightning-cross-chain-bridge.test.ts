import { encode, sign } from 'bolt11';
import { sha256 } from '@noble/hashes/sha256';
import { NativeModules } from 'react-native';
import { KilombinoProvider, PaperclipProvider } from '../../blue_modules/lightning-bridge/provider';
import { BridgeController, BridgeJournal, BridgeStore } from '../../blue_modules/lightning-bridge/state';
import { embeddedXbtBridgeBackend } from '../../blue_modules/lightning-bridge/runtime';
import { readBridgeInvoice } from '../../blue_modules/lightning-bridge/invoice';

const now = 1800000000000;
const node = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const preimage = '31'.repeat(32);
const hash = Buffer.from(sha256(Buffer.from(preimage, 'hex'))).toString('hex');
const makeInvoice = (msat: string, xbt = false) =>
  sign(
    encode({
      timestamp: now / 1000,
      millisatoshis: msat,
      tags: [
        { tagName: 'payment_hash', data: hash },
        { tagName: 'description', data: 'mock network only' },
        { tagName: 'expire_time', data: xbt ? 120 : 3600 },
        { tagName: 'min_final_cltv_expiry', data: xbt ? 1200 : 18 },
        ...(xbt ? [{ tagName: 'feature_bits', data: { word_length: 103, extra_bits: { start_bit: 512, bits: [true] } } }] : []),
      ],
    }),
    '01'.padStart(64, '0'),
  ).paymentRequest!;

test.each([
  {
    id: 'kilombino',
    Provider: KilombinoProvider,
    OtherProvider: PaperclipProvider,
    origin: 'https://bridge.kilombino.com',
  },
  {
    id: 'paperclip',
    Provider: PaperclipProvider,
    OtherProvider: KilombinoProvider,
    origin: 'https://lightning.paperclip-xbt.xyz/bridge',
  },
])('$id quotes, recovers after restart, and never resubmits through another processor', async ({ id, Provider, OtherProvider, origin }) => {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  const previousNative = NativeModules.XBTLightningBridge;
  const original = makeInvoice('100001');
  const hold = makeInvoice('34000340', true);
  let localState = 'not_found';
  const native = {
    wallet: jest.fn(async () => ({ node })),
    bridgePayment: jest.fn(async (operation: string, payload: string) => {
      if (operation === 'review') {
        expect(JSON.parse(payload)).toMatchObject({ invoice: hold, hash, msat: '34000340', feeLimit: '10', destination: node, node });
        return { estimatedFeeMsat: '1500' };
      }
      if (operation === 'pay') {
        expect(JSON.parse(payload).invoice).not.toBe(original);
        expect(stored.records[0].state).toBe('submitting');
        localState = 'pending';
        return { state: 'pending' };
      }
      return localState === 'settled'
        ? { state: 'settled', proofVerified: true, msat: '34000340', feeMsat: '1300' }
        : { state: localState };
    }),
  };
  NativeModules.XBTLightningBridge = native;
  let stored: BridgeJournal = { version: 1, records: [], requests: [] };
  const store: BridgeStore = {
    read: async () => JSON.parse(JSON.stringify(stored)),
    write: async data => {
      stored = JSON.parse(JSON.stringify(data));
    },
  };
  const calls: { path: string; body?: unknown; headers: unknown }[] = [];
  const market = { open: true, rate: 0.003, spread: 0.02, min_sat: 1, max_sat: 100000 };
  const paperclip = id === 'paperclip';
  const statusPath = '/api/swap/' + hash + '?t=' + 'ab'.repeat(16);
  let remoteProof = 'ff'.repeat(32);
  const request = jest.fn(async (url: string | URL | Request, options?: RequestInit) => {
    expect(String(url).startsWith(origin + '/')).toBe(true);
    const path = String(url).slice(origin.length);
    const body = options?.body ? JSON.parse(options.body as string) : undefined;
    calls.push({ path, body, headers: options?.headers });
    let value: unknown;
    switch (path) {
      case '/api/info':
        value = { dirs: { toSHA256: market } };
        break;
      case '/api/info?direction=toSHA256':
        value = {
          ...market,
          direction: 'toSHA256',
          cap_unit: 'SHA256 sats',
          payments_enabled: true,
        };
        break;
      case '/api/check':
        value = { direction: 'toSHA256', hash, sat: 100.001, wait_s: 0 };
        break;
      case '/api/pow':
        value = { challenge: 'mock-challenge', bits: 0, ttl_s: 120 };
        break;
      case '/api/quote':
        value = {
          [paperclip ? 'direction' : 'dir']: 'toSHA256',
          hash,
          sat: 100.001,
          hold_invoice: hold,
          pay_sat: 34001,
          rate: 0.003,
          spread: 0.02,
          expires_at: now / 1000 + 120,
          node,
          cltv: 1200,
          token: 'ab'.repeat(16),
        };
        break;
      case statusPath:
        value = { state: 'settled', preimage: remoteProof };
        break;
      default:
        throw new Error('Unexpected request to the simulated processor');
    }
    return { ok: true, url: String(url), text: async () => JSON.stringify(value) } as Response;
  }) as jest.MockedFunction<typeof fetch>;
  const provider = new Provider(request);
  const otherRequest = jest.fn(async () => {
    throw new Error('Unselected processor was contacted');
  });
  const other = new OtherProvider(otherRequest);
  // Only the unfunded fixture signer can sign these synthetic hold invoices.
  Object.defineProperty(provider, 'node', { value: node });
  const controller = new BridgeController(store, embeddedXbtBridgeBackend, [provider], () => now);
  try {
    expect(calls).toHaveLength(0);
    const recipient = readBridgeInvoice(original);
    const signal = new AbortController().signal;
    const quoted = await controller.quote(id, recipient, '10', signal);
    const expectedQuote = { invoice: original, pow: { challenge: 'mock-challenge', nonce: '0' } };
    if (paperclip) {
      expect(calls.map(c => c.path)).toEqual(['/api/info?direction=toSHA256', '/api/check', '/api/pow', '/api/quote']);
      expect(calls[1].body).toEqual({ invoice: original, direction: 'toSHA256' });
      expect(calls[3].body).toEqual({ ...expectedQuote, direction: 'toSHA256' });
    } else {
      expect(calls.map(c => c.path)).toEqual(['/api/info', '/api/pow', '/api/quote']);
      expect(calls[2].body).toEqual(expectedQuote);
    }
    expect(quoted.provider).toBe(id);
    expect(calls[0].headers).toMatchObject({ 'User-Agent': 'RedWallet' });
    expect(native.bridgePayment.mock.calls.some(c => c[0] === 'pay')).toBe(false);
    expect((await controller.approve(hash, quoted.quote!.holdInvoice, () => true)).state).toBe('pending');
    // The provider can be unavailable on restart. Never redirect a status token or a pending payment.
    const unavailable = new BridgeController(store, embeddedXbtBridgeBackend, [other], () => now);
    expect((await unavailable.refresh(hash, signal)).state).toBe('pending');
    await expect(unavailable.quote(other.id, recipient, '10', signal)).rejects.toThrow('pending');
    expect(otherRequest).not.toHaveBeenCalled();

    const restarted = new BridgeController(store, embeddedXbtBridgeBackend, [other, provider], () => now);
    const unproven = await restarted.refresh(hash, signal);
    expect(unproven.state).toBe('pending');
    expect(unproven.bridgeState).toBeUndefined();
    remoteProof = preimage;
    const remoteSettled = await restarted.refresh(hash, signal);
    expect(remoteSettled).toMatchObject({ provider: id, state: 'pending', bridgeState: 'settled' });
    expect(calls[calls.length - 1].path).toBe(statusPath);
    localState = 'settled';
    const final = await restarted.refresh(hash, signal);
    expect(otherRequest).not.toHaveBeenCalled();
    expect(final.state).toBe('settled');
    expect(final.actualFeeMsat).toBe('1300');
    expect(native.bridgePayment.mock.calls.filter(c => c[0] === 'pay')).toHaveLength(1);
    expect(JSON.stringify(calls)).not.toMatch(/macaroon|private.?key|seed/i);
    expect(stored.records[0].quote?.token).toBe('');
  } finally {
    NativeModules.XBTLightningBridge = previousNative;
    clock.mockRestore();
  }
});
