import { encode, sign } from 'bolt11';
import { sha256 } from '@noble/hashes/sha256';
import { readBridgeInvoice, provesPayment } from '../../blue_modules/lightning-bridge/invoice';
import {
  BridgeMarket,
  KilombinoProvider,
  LightningBridgeProvider,
  leadingZeroBits,
  parseMarket,
  priceMsat,
  ProofTimeoutError,
  QuoteResponseTimeoutError,
  solveProof,
  validateQuote,
} from '../../blue_modules/lightning-bridge/provider';
import { BridgeBackend, BridgeController, BridgeJournal, BridgeStore, NodePayment } from '../../blue_modules/lightning-bridge/state';

const NOW = 1800000000000;
const key = '01'.padStart(64, '0');
const node = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const preimage = '11'.repeat(32);
const hash = Buffer.from(sha256(Buffer.from(preimage, 'hex'))).toString('hex');
const market: BridgeMarket = { open: true, rate: 0.001, spread: 0.02, minSat: 1, maxSat: 100000 };
function invoice({ xbt = false, msat = '100000', paymentHash = hash, expiry = 3600, timestamp = NOW / 1000, cltv = 18 } = {}): string {
  return sign(
    encode({
      millisatoshis: msat,
      timestamp,
      tags: [
        { tagName: 'payment_hash', data: paymentHash },
        { tagName: 'description', data: 'test only' },
        { tagName: 'expire_time', data: expiry },
        { tagName: 'min_final_cltv_expiry', data: cltv },
        ...(xbt ? [{ tagName: 'feature_bits', data: { word_length: 103, extra_bits: { start_bit: 512, bits: [true] } } }] : []),
      ],
    }),
    key,
  ).paymentRequest!;
}
const original = () => readBridgeInvoice(invoice());
function quoteRaw(extra: Record<string, unknown> = {}) {
  return {
    dir: 'toSHA256',
    hash,
    sat: 100,
    hold_invoice: invoice({ xbt: true, msat: '102000000', expiry: 120, cltv: 1200 }),
    pay_sat: 102000,
    rate: 0.001,
    spread: 0.02,
    expires_at: NOW / 1000 + 120,
    node,
    cltv: 1200,
    token: 'ab'.repeat(16),
    ...extra,
  };
}
function environment() {
  let time = NOW;
  let data: BridgeJournal = { version: 1, records: [], requests: [] };
  const store: BridgeStore = {
    read: jest.fn(async () => JSON.parse(JSON.stringify(data))),
    write: jest.fn(async value => {
      data = JSON.parse(JSON.stringify(value));
    }),
  };
  let nodeResult: NodePayment = { state: 'not_found' };
  const backend: BridgeBackend = {
    identity: jest.fn(async () => node),
    review: jest.fn(async () => ({ estimatedFeeMsat: '1500' })),
    status: jest.fn(async () => nodeResult),
    pay: jest.fn(async () => ({ state: 'settled' as const, proofVerified: true, msat: '102000000', feeMsat: '1250' })),
  };
  const provider: LightningBridgeProvider = {
    id: 'test',
    name: 'Test processor',
    website: 'https://test.invalid',
    node,
    info: jest.fn(async () => market),
    quote: jest.fn(async input => validateQuote(quoteRaw(), input, { id: 'test', node }, time)),
    swap: jest.fn(async () => ({ state: 'settled', preimage })),
  };
  const controller = () => new BridgeController(store, backend, [provider], () => time);
  return {
    store,
    backend,
    provider,
    controller,
    records: () => data.records,
    setTime: (value: number) => {
      time = value;
    },
    setStatus: (value: NodePayment) => {
      nodeResult = value;
    },
  };
}
const signal = () => new AbortController().signal;
async function quoted(e: ReturnType<typeof environment>) {
  const c = e.controller();
  const r = await c.quote('test', original(), '10', signal());
  return { c, r };
}

describe('signed bridge invoices and provider protocol', () => {
  it('distinguishes the two lnbc chains using signed features and rejects mixed case/checksum changes', () => {
    expect(original().chain).toBe('SHA256');
    expect(readBridgeInvoice(invoice({ xbt: true })).chain).toBe('XBT');
    expect(() => readBridgeInvoice(invoice().slice(0, -1) + 'x')).toThrow();
    expect(() => readBridgeInvoice('LN' + invoice().slice(2))).toThrow();
  });
  it('binds original hash, exact millisatoshis, pinned signer, chain and quote expiry', () => {
    expect(validateQuote(quoteRaw(), original(), { id: 'test', node }, NOW).payMsat).toBe('102000000');
    for (const extra of [
      { hash: '22'.repeat(32) },
      { node: '03' + '22'.repeat(32) },
      { dir: 'toBLAKE2b' },
      { pay_sat: 102001 },
      { hold_invoice: invoice({ msat: '102000000', expiry: 120 }) },
      { expires_at: NOW / 1000 + 10 },
      { expires_at: NOW / 1000 + 3601 },
      { rate: 0.1 },
      { spread: -1 },
      { token: 'invalid' },
      { hold_invoice: invoice({ xbt: true, msat: '102000001', paymentHash: '22'.repeat(32), expiry: 120, cltv: 1200 }) },
      { hold_invoice: invoice({ xbt: true, msat: '102000000', expiry: 120, cltv: 2017 }), cltv: 2017 },
    ])
      expect(() => validateQuote(quoteRaw(extra), original(), { id: 'test', node }, NOW)).toThrow();
    expect(() => validateQuote(quoteRaw(), original(), { id: 'test', node: '03' + '22'.repeat(32) }, NOW)).toThrow();
  });
  it('retains fractional sats rather than paying the rounded pay_sat', () => {
    const src = readBridgeInvoice(invoice({ msat: '100001' }));
    const amount = priceMsat(src.msat, 0.003, 0.02).toString();
    const raw = quoteRaw({
      sat: 100.001,
      rate: 0.003,
      pay_sat: Number((BigInt(amount) + 999n) / 1000n),
      hold_invoice: invoice({ xbt: true, msat: amount, expiry: 120, cltv: 1200 }),
    });
    const q = validateQuote(raw, src, { id: 'test', node }, NOW);
    expect(q.payMsat).toBe('34000340');
    expect(q.paySat).toBe('34001');
    expect(priceMsat('100000', 0.001, 0.02)).toBe(102000000n);
  });
  it('uses the direction-specific availability and limits, not top-level fields', () => {
    expect(
      parseMarket({ open: true, rate: 9, dirs: { toSHA256: { open: false, rate: 0.001, spread: 0.02, min_sat: 2, max_sat: 99 } } }),
    ).toEqual({ open: false, rate: 0.001, spread: 0.02, minSat: 2, maxSat: 99 });
    expect(() => parseMarket({ open: true })).toThrow();
  });
  it('solves the supplied PoW bits with a lowercase base36 nonce and supports cancellation', async () => {
    const work = await solveProof({ challenge: 'server-challenge', bits: 7, ttl_s: 120 }, hash, signal());
    expect(work.nonce).toMatch(/^[0-9a-z]+$/);
    expect(leadingZeroBits(sha256(Buffer.from(work.challenge + ':' + hash + ':' + work.nonce)))).toBeGreaterThanOrEqual(7);
    const abort = new AbortController();
    abort.abort();
    await expect(solveProof({ challenge: 'c', bits: 256 }, hash, abort.signal)).rejects.toThrow('canceled');
    await expect(solveProof({ challenge: 'c', bits: 257 }, hash, signal())).rejects.toThrow();
  });
  it('matches the independent 18-bit SHA-256 reference nonce', async () => {
    const result = await solveProof({ challenge: 'redwallet-synthetic', bits: 18, ttl_s: 120 }, hash, signal());
    expect(result.nonce).toBe('7cnk');
  }, 120000);
  it('honors the challenge lifetime beyond thirty seconds and stops at expiry', async () => {
    const clock = (elapsed: number) => jest.fn(() => NOW + elapsed).mockReturnValueOnce(NOW);
    await expect(solveProof({ challenge: 'c', bits: 0, ttl_s: 120 }, hash, signal(), clock(31000))).resolves.toHaveProperty('nonce', '0');
    await expect(solveProof({ challenge: 'c', bits: 0, ttl_s: 5 }, hash, signal(), clock(5000))).rejects.toBeInstanceOf(ProofTimeoutError);
  });
  it('allows a manual retry after local proof expiry across restart but guards an ambiguous quote submission', async () => {
    const e = environment();
    jest.mocked(e.provider.quote).mockRejectedValueOnce(new ProofTimeoutError()).mockRejectedValueOnce(new Error('Connection lost'));
    await expect(quoted(e)).rejects.toBeInstanceOf(ProofTimeoutError);
    await expect(quoted(e)).rejects.toThrow('Connection lost');
    await expect(quoted(e)).rejects.toThrow('already exists');
    expect(e.backend.pay).not.toHaveBeenCalled();
  });
  it('verifies exact preimages and refuses false success proofs', () => {
    expect(provesPayment(preimage, hash)).toBe(true);
    expect(provesPayment('22'.repeat(32), hash)).toBe(false);
    expect(provesPayment('', hash)).toBe(false);
  });
  it('uses HTTPS without wallet credentials and the original hex hash for status', async () => {
    const request = jest.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ state: 'pending', preimage: '' }),
    })) as unknown as jest.MockedFunction<typeof fetch>;
    const p = new KilombinoProvider(request);
    await p.swap(hash, 'ab'.repeat(16), signal());
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('https://bridge.kilombino.com/api/swap/' + hash + '?t=' + 'ab'.repeat(16));
    expect(options).toMatchObject({ credentials: 'omit', redirect: 'error', method: 'GET' });
    expect(JSON.stringify(options)).not.toMatch(/macaroon|seed|private/i);
  });
});

describe('durable cross-chain state machine', () => {
  it('quotes without paying, then submits once after explicit approval and verifies settlement', async () => {
    const e = environment(),
      { c, r } = await quoted(e);
    expect(e.backend.pay).not.toHaveBeenCalled();
    expect(r.state).toBe('quoted');
    const paid = await c.approve(hash, r.quote!.holdInvoice, () => true);
    expect(paid.state).toBe('settled');
    expect(paid.actualFeeMsat).toBe('1250');
    expect(e.backend.pay).toHaveBeenCalledTimes(1);
    expect(e.records()[0].quote?.token).toBe('');
    await expect(c.approve(hash, r.quote!.holdInvoice, () => true)).rejects.toThrow();
  });
  it('rejects an expired original invoice before any processor disclosure', async () => {
    const e = environment();
    await expect(
      e.controller().quote('test', readBridgeInvoice(invoice({ expiry: 1, timestamp: NOW / 1000 - 2 })), '10', signal()),
    ).rejects.toThrow('expired');
    expect(e.provider.info).not.toHaveBeenCalled();
    expect(e.provider.quote).not.toHaveBeenCalled();
  });
  it('rejects expired quotes and never pays them', async () => {
    const e = environment(),
      { c, r } = await quoted(e);
    e.setTime(NOW + 110000);
    await expect(c.approve(hash, r.quote!.holdInvoice, () => true)).rejects.toThrow('expired');
    expect(e.backend.pay).not.toHaveBeenCalled();
  });
  it('handles unavailable processors and insufficient Lightning liquidity without submitting', async () => {
    const e = environment();
    (e.provider.info as jest.Mock).mockResolvedValueOnce({ ...market, open: false });
    await expect(e.controller().quote('test', original(), '10', signal())).rejects.toThrow('unavailable');
    (e.backend.review as jest.Mock).mockRejectedValueOnce(new Error('Insufficient liquidity'));
    await expect(e.controller().quote('test', original(), '10', signal())).rejects.toThrow('liquidity');
    expect(e.backend.pay).not.toHaveBeenCalled();
  });
  it('cancel before approval and background during authentication do not submit', async () => {
    const e = environment(),
      { c, r } = await quoted(e);
    await expect(c.approve(hash, r.quote!.holdInvoice, () => false)).rejects.toThrow('canceled');
    await c.cancel(hash);
    expect(e.records()[0].state).toBe('canceled');
    await expect(c.approve(hash, r.quote!.holdInvoice, () => true)).rejects.toThrow();
    expect(e.backend.pay).not.toHaveBeenCalled();
  });
  it('invalidated confirmation during the secure write cannot make a payment', async () => {
    const e = environment(),
      { c, r } = await quoted(e);
    let current = true;
    const write = e.store.write as jest.Mock;
    const persist = write.getMockImplementation()!;
    write.mockImplementationOnce(async (journal: BridgeJournal) => {
      await persist(journal);
      expect(e.records()[0].state).toBe('submitting');
      current = false;
    });
    expect((await c.approve(hash, r.quote!.holdInvoice, () => current)).state).toBe('canceled');
    expect(e.records()[0].quote?.token).toBe('');
    expect(e.backend.pay).not.toHaveBeenCalled();
  });
  it('persists submitting before the RPC, survives a lost response and a controller restart', async () => {
    const e = environment(),
      { c, r } = await quoted(e);
    (e.backend.pay as jest.Mock).mockImplementationOnce(async () => {
      expect(e.records()[0].state).toBe('submitting');
      throw new Error('connection lost');
    });
    expect((await c.approve(hash, r.quote!.holdInvoice, () => true)).state).toBe('unknown');
    const restarted = e.controller();
    expect((await restarted.refresh(hash, signal())).state).toBe('unknown');
    await expect(restarted.quote('test', original(), '10', signal())).rejects.toThrow('uncertain');
    await expect(restarted.approve(hash, r.quote!.holdInvoice, () => true)).rejects.toThrow();
    expect(e.backend.pay).toHaveBeenCalledTimes(1);
  });
  it('a pending phone payment stays pending after background/restart and reconciles without resend', async () => {
    const e = environment(),
      { c, r } = await quoted(e);
    (e.backend.pay as jest.Mock).mockResolvedValueOnce({ state: 'pending' });
    expect((await c.approve(hash, r.quote!.holdInvoice, () => true)).state).toBe('pending');
    e.setStatus({ state: 'settled', proofVerified: true, msat: '102000000', feeMsat: '1200' });
    expect((await e.controller().refresh(hash, signal())).state).toBe('settled');
    expect(e.backend.pay).toHaveBeenCalledTimes(1);
  });
  it('serializes two simultaneous approvals and prevents replay', async () => {
    const e = environment(),
      { c, r } = await quoted(e);
    const result = await Promise.allSettled([
      c.approve(hash, r.quote!.holdInvoice, () => true),
      c.approve(hash, r.quote!.holdInvoice, () => true),
    ]);
    expect(result.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(e.backend.pay).toHaveBeenCalledTimes(1);
  });
  it('never treats bridge settlement/failure/expiry as local settlement or a refund', async () => {
    const e = environment(),
      { c, r } = await quoted(e);
    (e.backend.pay as jest.Mock).mockResolvedValueOnce({ state: 'pending' });
    await c.approve(hash, r.quote!.holdInvoice, () => true);
    e.setStatus({ state: 'pending' });
    for (const state of ['settled', 'failed', 'expired', 'lost']) {
      (e.provider.swap as jest.Mock).mockResolvedValueOnce({ state, preimage: state === 'settled' ? preimage : '' });
      expect((await c.refresh(hash, signal())).state).toBe('pending');
    }
    e.setStatus({ state: 'failed' });
    expect((await c.refresh(hash, signal())).state).toBe('failed');
    expect(e.backend.pay).toHaveBeenCalledTimes(1);
  });
  it('refuses success with invalid proof, wrong amount or excess routing fees', async () => {
    for (const extra of [{ proofVerified: false }, { msat: '1' }, { feeMsat: '10001' }]) {
      const e = environment(),
        { c, r } = await quoted(e);
      (e.backend.pay as jest.Mock).mockResolvedValueOnce({
        state: 'settled',
        proofVerified: true,
        msat: '102000000',
        feeMsat: '1000',
        ...extra,
      });
      expect((await c.approve(hash, r.quote!.holdInvoice, () => true)).state).toBe('unknown');
    }
  });
  it('a secure journal write failure before submission prevents the RPC', async () => {
    const e = environment(),
      { c, r } = await quoted(e);
    (e.store.write as jest.Mock).mockRejectedValueOnce(new Error('keychain locked'));
    await expect(c.approve(hash, r.quote!.holdInvoice, () => true)).rejects.toThrow('keychain');
    expect(e.backend.pay).not.toHaveBeenCalled();
  });
  it('refuses changed node identity and enforces persistent quote rate limits', async () => {
    const e = environment(),
      { c, r } = await quoted(e);
    (e.backend.identity as jest.Mock).mockResolvedValueOnce('03' + '22'.repeat(32));
    await expect(c.approve(hash, r.quote!.holdInvoice, () => true)).rejects.toThrow();
    const journal = await e.store.read();
    journal.requests = Array(6).fill(NOW);
    journal.records = [];
    await e.store.write(journal);
    await expect(e.controller().quote('test', original(), '10', signal())).rejects.toThrow('Six quote requests');
    expect(e.backend.pay).not.toHaveBeenCalled();
  });
  it('does not disclose an invoice to an unselected or unknown provider', async () => {
    const e = environment();
    await expect(e.controller().quote('another', original(), '10', signal())).rejects.toThrow('unavailable');
    expect(e.provider.quote).not.toHaveBeenCalled();
  });
});

test('an unchecked provider adapter cannot bypass the central invoice boundary', async () => {
  const e = environment();
  const q = validateQuote(quoteRaw(), original(), { id: 'test', node }, NOW);
  (e.provider.quote as jest.Mock).mockResolvedValueOnce({ ...q, payMsat: '1' });
  await expect(e.controller().quote('test', original(), '10', signal())).rejects.toThrow('amount');
  expect(e.backend.review).not.toHaveBeenCalled();
  expect(e.backend.pay).not.toHaveBeenCalled();
});

test('a native refusal before SendPaymentV2 is distinct from an ambiguous submission', async () => {
  const e = environment(),
    { c, r } = await quoted(e);
  (e.backend.pay as jest.Mock).mockResolvedValueOnce({ state: 'not_submitted' });
  expect((await c.approve(hash, r.quote!.holdInvoice, () => true)).state).toBe('canceled');
});

test('terminal persistence failure is recovered from the node without another send', async () => {
  const e = environment(),
    { c, r } = await quoted(e);
  const save = e.store.write;
  (e.backend.pay as jest.Mock).mockImplementationOnce(async () => {
    (save as jest.Mock).mockRejectedValueOnce(new Error('locked after send'));
    return { state: 'settled', proofVerified: true, msat: '102000000', feeMsat: '1200' };
  });
  await expect(c.approve(hash, r.quote!.holdInvoice, () => true)).rejects.toThrow('locked');
  expect(e.records()[0].state).toBe('submitting');
  e.setStatus({ state: 'settled', proofVerified: true, msat: '102000000', feeMsat: '1200' });
  expect((await e.controller().refresh(hash, signal())).state).toBe('settled');
  expect(e.backend.pay).toHaveBeenCalledTimes(1);
});

test('malformed secure history fails closed before rendering or sending', async () => {
  const e = environment();
  await quoted(e);
  const bad = await e.store.read();
  bad.records[0].quote!.rate = NaN;
  (e.store.read as jest.Mock).mockResolvedValueOnce(bad);
  await expect(e.controller().list()).rejects.toThrow('stored quote');
  expect(e.backend.pay).not.toHaveBeenCalled();
});

test('repeated polls reuse immutable verification while altered invoices are rechecked', () => {
  const value = invoice({ paymentHash: '71'.repeat(32) });
  const altered = invoice({ paymentHash: '72'.repeat(32) });
  const recover = jest.spyOn(jest.requireActual('bolt11'), 'decode');
  try {
    const first = readBridgeInvoice(value);
    first.hash = '00'.repeat(32);
    for (let i = 0; i < 20; i++) expect(readBridgeInvoice(value).hash).toBe('71'.repeat(32));
    expect(recover).toHaveBeenCalledTimes(1);
    expect(() => readBridgeInvoice('LN' + value.slice(2))).toThrow();
    expect(readBridgeInvoice(altered).hash).toBe('72'.repeat(32));
    expect(recover).toHaveBeenCalledTimes(2);
  } finally {
    recover.mockRestore();
  }
});

test('capacity cleanup respects the quote cooldown and persists before quoting', async () => {
  const e = environment();
  const records: BridgeJournal['records'] = Array.from({ length: 200 }, (_, i) => ({
    hash: i.toString(16).padStart(64, '0'),
    node,
    provider: 'test',
    state: 'requesting',
    createdAt: NOW,
    updatedAt: NOW,
    feeLimit: '10',
  }));
  await e.store.write({ version: 1, records, requests: [] });
  await expect(quoted(e)).rejects.toThrow('history is full');
  records[42].createdAt -= 600000;
  await e.store.write({ version: 1, records, requests: [] });
  (e.store.write as jest.Mock).mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(quoted(e)).rejects.toThrow('storage unavailable');
  expect(e.provider.quote).not.toHaveBeenCalled();
  await quoted(e);
  expect(e.records()).toHaveLength(200);
  expect(e.records().some(r => r.hash === records[42].hash)).toBe(false);
  expect(e.backend.pay).not.toHaveBeenCalled();
});

describe('durable quote diagnostics', () => {
  it('records local quote retries separately from an earlier failed payment', async () => {
    const e = environment();
    const { c, r } = await quoted(e);
    jest.mocked(e.backend.pay).mockResolvedValueOnce({ state: 'failed' });
    expect((await c.approve(hash, r.quote!.holdInvoice, () => true)).state).toBe('failed');

    for (const seconds of [83, 92, 104, 105]) {
      e.setTime(NOW + seconds * 1000);
      await expect(quoted(e)).rejects.toThrow('reservation already exists in RedWallet');
    }
    const [entry] = await e.controller().history();
    expect(entry.record?.state).toBe('failed');
    expect(entry.issues.map(issue => issue.reason)).toEqual(Array(4).fill('existingQuote'));
    expect(e.provider.info).toHaveBeenCalledTimes(1);
    expect(e.provider.quote).toHaveBeenCalledTimes(1);
    expect(e.backend.pay).toHaveBeenCalledTimes(1);
  });

  it('preserves a quote-response timeout and blocks duplicate attempts until the ten-minute reservation expires', async () => {
    const e = environment();
    jest.mocked(e.provider.quote).mockRejectedValueOnce(new QuoteResponseTimeoutError());
    await expect(quoted(e)).rejects.toThrow('processor may have reserved this invoice');
    expect(e.backend.pay).not.toHaveBeenCalled();

    e.setTime(NOW + 1000);
    await expect(quoted(e)).rejects.toThrow('already exists');
    expect(e.provider.quote).toHaveBeenCalledTimes(1);

    e.setTime(NOW + 600001);
    jest.mocked(e.provider.quote).mockRejectedValueOnce(new Error('Bridge unavailable or request refused.'));
    await expect(quoted(e)).rejects.toThrow('request refused');
    expect(e.provider.quote).toHaveBeenCalledTimes(2);
    expect(e.backend.pay).not.toHaveBeenCalled();

    const [entry] = await e.controller().history();
    expect(entry.issues.map(({ reason, at }) => [reason, at])).toEqual([
      ['processorRefused', NOW + 600001],
      ['existingQuote', NOW + 1000],
      ['quoteResponseTimeout', NOW],
    ]);
  });

  it('keeps a proof timeout and a later manual attempt in order across restart, without recording raw errors', async () => {
    const e = environment();
    jest.mocked(e.provider.quote).mockRejectedValueOnce(new Error('Bridge proof of work took too long. No payment was sent.'));
    await expect(quoted(e)).rejects.toThrow('proof of work');
    e.setTime(NOW + 1000);
    await expect(quoted(e)).rejects.toThrow('already exists');
    e.setTime(NOW + 601000);
    jest.mocked(e.provider.quote).mockRejectedValueOnce(new Error('private transport detail ?t=synthetic-private-token'));
    await expect(quoted(e)).rejects.toThrow('private transport detail');
    const [entry] = await e.controller().history();
    expect(entry.record?.state).toBe('quote_failed');
    expect(entry.issues.map(({ reason, at }) => [reason, at])).toEqual([
      ['quoteRequest', NOW + 601000],
      ['existingQuote', NOW + 1000],
      ['proofTimeout', NOW],
    ]);
    expect(JSON.stringify(await e.store.read())).not.toContain('synthetic-private-token');
    expect(e.backend.pay).not.toHaveBeenCalled();
  });

  it('shows an availability failure before reservation without imposing a cooldown or leaking across nodes', async () => {
    const e = environment();
    jest.mocked(e.provider.info).mockRejectedValueOnce(new Error('Bridge unavailable or request refused.'));
    await expect(quoted(e)).rejects.toThrow('request refused');
    expect(await e.controller().list()).toEqual([]);
    expect((await e.store.read()).requests).toEqual([]);
    const [entry] = await e.controller().history();
    expect(entry.record).toBeUndefined();
    expect(entry.issues[0]).toMatchObject({
      at: NOW,
      reason: 'processorRefused',
    });
    jest.mocked(e.backend.identity).mockResolvedValueOnce('03' + '22'.repeat(32));
    expect(await e.controller().history()).toEqual([]);
    await quoted(e);
    expect((await e.controller().history())[0].issues).toHaveLength(1);
    expect(e.backend.pay).not.toHaveBeenCalled();
  });

  it('persists expiry during approval review before submission', async () => {
    const e = environment();
    const { c, r } = await quoted(e);
    jest.mocked(e.backend.review).mockImplementationOnce(async () => {
      e.setTime(NOW + 110000);
      return {};
    });
    await expect(c.approve(hash, r.quote!.holdInvoice, () => true)).rejects.toThrow('expired');
    const [entry] = await e.controller().history();
    expect(entry.record?.state).toBe('quote_expired');
    expect(entry.issues[0]).toMatchObject({
      reason: 'approvalExpired',
      at: NOW + 110000,
    });
    expect(e.backend.pay).not.toHaveBeenCalled();
  });

  it('preserves an uncertain payment across duplicate quote requests and keeps diagnostics bounded', async () => {
    const e = environment();
    const { c, r } = await quoted(e);
    jest.mocked(e.backend.pay).mockRejectedValueOnce(new Error('connection lost after submission'));
    expect((await c.approve(hash, r.quote!.holdInvoice, () => true)).state).toBe('unknown');
    for (let i = 0; i < 102; i++) {
      await expect(c.quote('test', original(), '10', signal())).rejects.toThrow('uncertain');
    }
    const [entry] = await e.controller().history();
    expect(entry.record?.state).toBe('unknown');
    expect(entry.issues).toHaveLength(100);
    expect(entry.issues.every(issue => issue.reason === 'existingPayment')).toBe(true);
    expect(e.backend.pay).toHaveBeenCalledTimes(1);
  });
});

it('allows another processor after an unverified quote and checks native payment state again', async () => {
  const e = environment();
  jest.spyOn(e.provider, 'quote').mockRejectedValueOnce(new Error('Quote could not be verified'));
  await expect(quoted(e)).rejects.toThrow('verified');
  await expect(quoted(e)).rejects.toThrow('already exists');
  const other = { ...e.provider, id: 'other', quote: jest.fn(async () => validateQuote(quoteRaw(), original(), { id: 'other', node }, NOW)) };
  const restarted = new BridgeController(e.store, e.backend, [e.provider, other], () => NOW);
  e.setStatus({ state: 'pending' });
  await expect(restarted.quote('other', original(), '10', signal())).rejects.toThrow('LND already knows');
  expect(other.quote).not.toHaveBeenCalled();
  e.setStatus({ state: 'not_found' });
  await expect(restarted.quote('other', original(), '10', signal())).resolves.toMatchObject({ provider: 'other', state: 'quoted' });
  expect(e.backend.pay).not.toHaveBeenCalled();
});

it('preserves the first processor reservation across a failed switch and restart', async () => {
  const e = environment();
  const failure = new Error('Quote response timed out');
  jest.spyOn(e.provider, 'quote').mockRejectedValueOnce(failure);
  await expect(quoted(e)).rejects.toThrow(failure);
  const other = {
    ...e.provider,
    id: 'other',
    quote: jest.fn().mockRejectedValue(failure),
  };
  let now = NOW;
  const restart = () => new BridgeController(e.store, e.backend, [e.provider, other], () => now);
  await expect(restart().quote('other', original(), '10', signal())).rejects.toThrow(failure);
  await expect(restart().quote('test', original(), '10', signal())).rejects.toThrow('already exists');
  expect(e.provider.quote).toHaveBeenCalledTimes(1);
  now += 600001;
  jest.mocked(e.provider.quote).mockRejectedValueOnce(failure);
  await expect(restart().quote('test', original(), '10', signal())).rejects.toThrow(failure);
  expect(e.provider.quote).toHaveBeenCalledTimes(2);
});
