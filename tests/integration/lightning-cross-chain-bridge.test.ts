import { encode, sign } from 'bolt11';
import { sha256 } from '@noble/hashes/sha256';
import { NativeModules } from 'react-native';
import { KilombinoProvider } from '../../blue_modules/lightning-bridge/provider';
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

test('HTTP quote → explicit approval → native XBT submission → restart → local proof settlement', async () => {
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
  const request = jest.fn(async (url: string | URL | Request, options?: RequestInit) => {
    const path = String(url).replace('https://bridge.kilombino.com', '');
    const body = options?.body ? JSON.parse(options.body as string) : undefined;
    calls.push({ path, body, headers: options?.headers });
    const value =
      path === '/api/info'
        ? { dirs: { toSHA256: { open: true, rate: 0.003, spread: 0.02, min_sat: 1, max_sat: 100000 } } }
        : path === '/api/pow'
          ? { challenge: 'mock-challenge', bits: 0, ttl_s: 120 }
          : path === '/api/quote'
            ? {
                dir: 'toSHA256',
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
              }
            : { state: 'settled', preimage };
    return { ok: true, url: String(url), text: async () => JSON.stringify(value) } as Response;
  }) as jest.MockedFunction<typeof fetch>;
  const provider = new KilombinoProvider(request);
  // Test authority only: the real Kilombino private key is neither needed nor available.
  Object.defineProperty(provider, 'node', { value: node });
  const controller = new BridgeController(store, embeddedXbtBridgeBackend, [provider], () => now);
  try {
    expect(calls).toHaveLength(0);
    const quoted = await controller.quote('kilombino', readBridgeInvoice(original), '10', new AbortController().signal);
    expect(calls.map(c => c.path)).toEqual(['/api/info', '/api/pow', '/api/quote']);
    expect(calls[2].body).toEqual({ invoice: original, pow: { challenge: 'mock-challenge', nonce: '0' } });
    expect(calls[0].headers).toMatchObject({ 'User-Agent': 'RedWallet' });
    expect(native.bridgePayment.mock.calls.some(c => c[0] === 'pay')).toBe(false);
    expect((await controller.approve(hash, quoted.quote!.holdInvoice, () => true)).state).toBe('pending');
    const remoteSettled = await controller.refresh(hash, new AbortController().signal);
    expect(remoteSettled.state).toBe('pending');
    expect(calls[calls.length - 1].path).toBe('/api/swap/' + hash + '?t=' + 'ab'.repeat(16));
    localState = 'settled';
    const restarted = new BridgeController(store, embeddedXbtBridgeBackend, [provider], () => now);
    const final = await restarted.refresh(hash, new AbortController().signal);
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
