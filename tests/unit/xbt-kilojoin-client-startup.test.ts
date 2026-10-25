import { randomBytes } from 'crypto';
import { address, Transaction } from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Keychain from 'react-native-keychain';
import ecc from '../../blue_modules/noble_ecc';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { BlueApp } from '../../class/blue-app';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { XbtTaprootWallet } from '../../class/wallets/xbt-taproot-wallet';
import { LightningCustodianWallet } from '../../class/wallets/lightning-custodian-wallet';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';
import { ClientView, MixingClient } from '../../class/xbt/kilojoin/client';
import { conversationKey, decrypt, encrypt, NostrEvent, signEvent } from '../../class/xbt/kilojoin/crypto';
import { Terms, tokenHash } from '../../class/xbt/kilojoin/protocol';
import { Coin, change, coinScript, outpoint, ownershipMessage } from '../../class/xbt/kilojoin/transaction';
import { reservedCoins } from '../../class/xbt/kilojoin/wallet-store';
import { SessionVault } from '../../class/xbt/kilojoin/vault';
import vectors from './fixtures/kilojoin-kotlin-session.json';

// Full production client/session/transport/vault/wallet/coin-verification flow.
// Only network, native entropy/storage and disk I/O are test doubles. All coins,
// keys and signed messages are disposable fixtures; no live socket or broadcaster.
jest.mock('../../blue_modules/BlueElectrum', () => ({
  multiGetTransactionByTxid: jest.fn(),
  multiGetUtxoByAddress: jest.fn(),
  multiGetHistoryByAddress: jest.fn(),
  getReportedBlockTip: jest.fn(),
  estimateCurrentBlockheight: () => 110,
}));
jest.mock('../../class/xbt/kilojoin/wallet-adapter', () => ({
  ...jest.requireActual('../../class/xbt/kilojoin/wallet-adapter'),
  nativeEntropy: (length: number) => require('crypto').randomBytes(length),
}));
const ECPair = ECPairFactory(ecc);
const secret = (n: number) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
const pub = (key: Uint8Array) => Buffer.from(ecc.pointFromScalar(key, true)!.slice(1)).toString('hex');
const drain = async () => {
  for (let i = 0; i < 20; i++) await new Promise<void>(resolve => setImmediate(resolve));
};
type Fault =
  | 'none'
  | 'welcome-write'
  | 'welcome-key-read'
  | 'bad-welcome-mac'
  | 'peer-unspent'
  | 'peer-raw-missing'
  | 'peer-backend-rejected'
  | 'wallet-inventory'
  | 'wrong-pool-secret'
  | 'creator-reject'
  | 'initial-write'
  | 'initial-key-create'
  | 'ack-refused';

function fixture(type: Coin['type'], outputs: 1 | 5, reverse = false, earlyWelcome = false, replayNoise = false) {
  const wallet = type === 'p2wpkh' ? new XbtSegwitBech32Wallet() : new XbtTaprootWallet();
  wallet.setSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
  wallet.next_free_address_index = 1;
  const ownAddress = wallet._getExternalAddressByIndex(0);
  const key = ECPair.fromWIF(wallet._getWifForAddress(ownAddress)!);
  const parents = new Map<string, { raw: Transaction; coin: Coin; address: string }>();
  const makeCoin = (n: number, value: number, publicKey: Uint8Array) => {
    const preliminary = {
      type,
      txid: '00'.repeat(32),
      vout: 0,
      value,
      pubkey: Buffer.from(publicKey).toString('hex'),
    };
    const raw = new Transaction();
    raw.addInput(Buffer.alloc(32, n), 0);
    raw.addOutput(coinScript(preliminary), BigInt(value));
    const coin = { ...preliminary, txid: raw.getId() };
    parents.set(coin.txid, {
      raw,
      coin,
      address: address.fromOutputScript(coinScript(coin)),
    });
    return coin;
  };
  const ownCoin = makeCoin(1, 35000000, key.publicKey);
  jest.spyOn(wallet, 'fetchUtxo').mockResolvedValue(undefined);
  jest.spyOn(wallet, 'getUtxo').mockReturnValue([{ ...ownCoin, address: ownAddress } as never]);
  jest.spyOn(wallet, 'getChangeAddressAsync').mockResolvedValue(wallet._getInternalAddressByIndex(0));
  const broadcast = jest.spyOn(wallet, 'broadcastTx').mockRejectedValue(new Error('Offline test must never broadcast'));
  let fault: Fault = 'none';
  (BlueElectrum.multiGetTransactionByTxid as jest.Mock).mockImplementation(async (ids: string[]) => {
    if (ids.length > 1 && fault === 'peer-backend-rejected') throw new Error('private backend response');
    return Object.fromEntries(
      ids.map(id => [id, fault === 'peer-raw-missing' && id !== ownCoin.txid ? undefined : parents.get(id)?.raw.toHex()]),
    );
  });
  jest.spyOn(wallet, 'getDerivedUtxoFromOurTransaction').mockImplementation(() => {
    if (fault === 'wallet-inventory') throw new TypeError('private wallet detail');
    return [];
  });
  (BlueElectrum.multiGetUtxoByAddress as jest.Mock).mockImplementation(async (addresses: string[]) =>
    Object.fromEntries(
      addresses.map(a => [
        a,
        [...parents.values()]
          .filter(p => p.address === a && !(fault === 'peer-unspent' && a !== ownAddress))
          .map(p => ({ ...p.coin, height: 100 })),
      ]),
    ),
  );
  (BlueElectrum.multiGetHistoryByAddress as jest.Mock).mockImplementation(async (addresses: string[]) =>
    Object.fromEntries(
      addresses.map(a => [a, [...parents.values()].filter(p => p.address === a).map(p => ({ tx_hash: p.coin.txid, height: 100 }))]),
    ),
  );
  (BlueElectrum.getReportedBlockTip as jest.Mock).mockResolvedValue(110);
  const app = BlueApp.getInstance();
  const previousWallets = app.wallets;
  app.wallets = [wallet];
  jest.spyOn(app, 'saveToDisk').mockResolvedValue(undefined);
  const now = Math.floor(Date.now() / 1000);
  const poolKey = secret(9),
    creatorKey = secret(2);
  const terms: Terms = {
    ...(vectors.find(v => v.terms.script === type && v.mixes.length === outputs)!.terms as Terms),
    id: randomBytes(16).toString('hex'),
    public_key: pub(poolKey),
    creator: pub(creatorKey),
    denomination: 3000000,
    max_peers: 5,
    peers: 4,
    timeout: now + 3600,
    state: 'open',
  };
  const poolEvent = signEvent(
    {
      kind: 32022,
      created_at: now,
      tags: [
        ['d', terms.id],
        ['t', 'kilojoin'],
      ],
      content: JSON.stringify(terms),
    },
    poolKey,
    randomBytes(32),
  );
  const peers = [3, 4, 5, 6].map(n => {
    const coin = makeCoin(n, 20000000, ecc.pointFromScalar(secret(n), true)!);
    const join = n === 3 ? terms.public_key : pub(secret(n + 100));
    const changeScript = type === 'p2wpkh' ? '0014' + n.toString(16).repeat(40) : '5120' + n.toString(16).repeat(64);
    return {
      token_hash: tokenHash(n.toString(16).repeat(32)),
      join_pub: join,
      coin,
      coins: [coin],
      proofs: [Buffer.from(ecc.signDER(ownershipMessage(terms.id, join, coin), secret(n))).toString('hex')],
      change_script: changeScript,
      change_value: change(coin.value, terms.denomination, terms.fee_rate, 1, type, outputs),
    };
  });
  const envelope = (body: unknown, recipient: string, encryptionKey = conversationKey(creatorKey, recipient)) =>
    signEvent(
      {
        kind: 2023,
        created_at: now,
        tags: [['p', recipient]],
        content: encrypt(JSON.stringify(body), encryptionKey, randomBytes(32)),
      },
      creatorKey,
      randomBytes(32),
    );
  const clients: MixingClient[] = [];
  const sockets: OfflineSocket[] = [];
  const identities: string[] = [];
  const views: ClientView[] = [];
  class OfflineSocket {
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onerror?: () => void;
    onclose?: () => void;
    direct = '';
    closed = false;
    events: NostrEvent[] = [];
    history: NostrEvent[] = [];
    filters: Record<string, unknown>[] = [];
    constructor() {
      sockets.push(this);
      queueMicrotask(() => this.onopen?.());
    }

    deliver(sub: string, event: NostrEvent) {
      this.onmessage?.({ data: JSON.stringify(['EVENT', sub, event]) });
    }

    close() {
      this.closed = true;
    }

    send(text: string) {
      const frame = JSON.parse(text);
      if (frame[0] === 'REQ') {
        this.filters.push(frame[2]);
        if (frame[2]['#p'][0] === terms.public_key) {
          for (const event of reverse ? [...this.history].reverse() : this.history) this.deliver(frame[1], event);
          this.onmessage?.({ data: JSON.stringify(['EOSE', frame[1]]) });
        } else this.direct = frame[1];
      }
      if (frame[0] !== 'EVENT') return;
      const event = frame[1] as NostrEvent;
      this.events.push(event);
      const join = JSON.parse(decrypt(event.content, conversationKey(poolKey, event.pubkey)));
      if (join.type !== 'join') throw new Error('Offline startup test forbids any other publication');
      identities.push(event.pubkey);
      const own = { ...join.seat, token_hash: tokenHash('ab'.repeat(16)) };
      this.history = [
        envelope({ type: 'roster', seq: 5, seats: [...peers, own] }, terms.public_key),
        envelope(
          {
            type: 'vote_open',
            by: peers[0].token_hash,
            vote_id: 'ba'.repeat(8),
          },
          terms.public_key,
        ),
      ];
      if (replayNoise) {
        const member = (messageType: string) =>
          signEvent(
            {
              kind: 2023,
              created_at: now,
              tags: [['p', terms.public_key]],
              content: encrypt(JSON.stringify({ type: messageType }), conversationKey(poolKey, terms.public_key), randomBytes(32)),
            },
            poolKey,
            randomBytes(32),
          );
        this.history = [
          ...['join', 'leave', 'vote', 'abort', 'sig', 'blind', 'close_request', 'tx'].map(member),
          envelope({ type: 'roster', seq: 4, seats: peers }, terms.public_key),
          envelope({ type: 'outputs', round_id: 'dd'.repeat(8), scripts: [] }, terms.public_key),
          ...this.history,
          ...this.history,
          envelope({ type: 'roster', seq: 5, seats: [...peers, own] }, terms.public_key),
        ];
      }
      const welcome = envelope(
        fault === 'creator-reject'
          ? { type: 'reject', reason: 'private rejection detail' }
          : {
              type: 'welcome',
              pool_secret: fault === 'wrong-pool-secret' ? '8' : '9',
              token: 'ab'.repeat(16),
              seq: 5,
            },
        event.pubkey,
        fault === 'bad-welcome-mac' ? Buffer.alloc(32, 7) : undefined,
      );
      if (fault === 'welcome-write') (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('private native storage detail'));
      if (fault === 'welcome-key-read')
        (Keychain.getGenericPassword as jest.Mock).mockRejectedValueOnce(new Error('private keychain detail'));
      if (earlyWelcome) this.deliver(this.direct, welcome);
      this.onmessage?.({
        data: JSON.stringify(['OK', event.id, fault !== 'ack-refused', '']),
      });
      if (!earlyWelcome) this.deliver(this.direct, welcome);
    }
  }
  const previousSocket = global.WebSocket;
  global.WebSocket = OfflineSocket as unknown as typeof WebSocket;
  return {
    wallet,
    ownCoin,
    terms,
    views,
    sockets,
    identities,
    peers,
    broadcast,
    setFault: (value: Fault) => {
      fault = value;
    },
    async join() {
      if (fault === 'initial-write') (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('private initial-write detail'));
      if (fault === 'initial-key-create')
        (Keychain.setGenericPassword as jest.Mock).mockRejectedValueOnce(new Error('private initial-key detail'));
      const client = await MixingClient.join({
        poolEvent,
        experimentalAcknowledged: true,
        wallet,
        selected: [outpoint(ownCoin)],
        maxFee: 1000,
        onUpdate: v => views.push(v),
      });
      clients.push(client);
      await drain();
      return client;
    },
    async cleanup() {
      for (const client of clients) await client.close();
      global.WebSocket = previousSocket;
      app.wallets = previousWallets;
      jest.restoreAllMocks();
    },
  };
}

const startupMatrix = (['p2wpkh', 'p2tr'] as const).flatMap(type =>
  ([1, 5] as const).flatMap(outputs =>
    [false, true].flatMap(reverse =>
      [false, true].map(earlyWelcome => ({
        type,
        outputs,
        reverse,
        earlyWelcome,
      })),
    ),
  ),
);
test.each(startupMatrix)(
  'upstream-confirmed noisy replay through full $type client / $outputs outputs / reverse=$reverse / early=$earlyWelcome',
  async ({ type, outputs, reverse, earlyWelcome }) => {
    const f = fixture(type, outputs, reverse, earlyWelcome, true);
    try {
      const client = await f.join();
      expect(client.view().error).toBeUndefined();
      expect(f.views.every(view => view.error === undefined)).toBe(true);
      expect(client.view().session).toMatchObject({
        phase: 'voting',
        sequence: 5,
      });
      expect(client.view().session.seats).toHaveLength(5);
      expect(client.view().session.seats[0].join_pub).toBe(f.terms.public_key);
      expect(client.view().session.seats[0].join_pub).not.toBe(f.terms.creator);
      const filter = f.sockets[0].filters.find(item => (item['#p'] as string[])[0] === f.terms.public_key)!;
      expect(filter).toBeDefined();
      expect(filter).not.toHaveProperty('since');
      expect(reservedCoins(f.wallet)).toEqual(new Set([outpoint(f.ownCoin)]));
      expect(f.sockets[0].events).toHaveLength(1); // join only; no automatic vote or signing
      expect(f.broadcast).not.toHaveBeenCalled();
    } finally {
      await f.cleanup();
    }
  },
);
test.each(startupMatrix)(
  'full $type client / $outputs outputs / reverse=$reverse / welcome-before-ACK=$earlyWelcome starts and safely rejoins',
  async ({ type, outputs, reverse, earlyWelcome }) => {
    const f = fixture(type, outputs, reverse, earlyWelcome);
    try {
      const first = await f.join();
      expect(first.view().error).toBeUndefined();
      expect(first.view()).toMatchObject({
        session: { phase: 'voting' },
        journal: { phase: 'joined' },
      });
      expect(first.view().session.seats).toHaveLength(5);
      expect(await new SessionVault(f.wallet.getID(), f.terms.id, f.identities[0]).load()).toMatchObject({ phase: 'voting' });
      expect(f.wallet.next_free_address_index).toBe(1 + outputs);
      await first.close();
      expect(reservedCoins(f.wallet).size).toBe(0);
      const second = await f.join();
      expect(second.view().error).toBeUndefined();
      expect(second.view().session.phase).toBe('voting');
      expect(new Set(f.identities).size).toBe(2);
      expect(f.wallet.next_free_address_index).toBe(1 + 2 * outputs);
      const count = f.views.length;
      f.sockets[0].deliver('kilojoin-participant-2', f.sockets[0].history[0]);
      f.sockets[0].onerror?.();
      await drain();
      expect(f.views).toHaveLength(count);
      expect(reservedCoins(f.wallet)).toEqual(new Set([outpoint(f.ownCoin)]));
      expect(f.broadcast).not.toHaveBeenCalled();
      expect(f.sockets.every(s => s.events.length === 1)).toBe(true);
    } finally {
      await f.cleanup();
    }
  },
);

test.each([
  ['welcome-write', 'joining', 'KJ-STORAGE'],
  ['welcome-key-read', 'joining', 'KJ-STORAGE'],
  ['bad-welcome-mac', 'joining', 'KJ-DECRYPT'],
  ['wrong-pool-secret', 'joining', 'KJ-WELCOME'],
  ['peer-unspent', 'open', 'KJ-CHAIN'],
  ['peer-raw-missing', 'open', 'KJ-BACKEND'],
  ['peer-backend-rejected', 'open', 'KJ-BACKEND'],
  ['wallet-inventory', 'open', 'KJ-WALLET-INPUTS'],
] as const)('full client isolates %s and permits a fresh unsigned attempt after Stop', async (fault, phase, code) => {
  const f = fixture('p2wpkh', 5);
  try {
    f.setFault(fault);
    const first = await f.join();
    expect(first.view().session.phase).toBe(phase);
    expect(first.view().session.seats).toHaveLength(0);
    if (fault === 'bad-welcome-mac') expect(first.view().error).toBeUndefined();
    else {
      expect(first.view().error).toContain(code);
      expect(first.view().error).not.toMatch(/private|keychain detail|storage detail/);
      const firstError = first.view().error;
      f.sockets[0].onerror?.();
      expect(first.view().error).toBe(firstError);
    }
    await first.close();
    expect(first.view().journal).toMatchObject({
      phase: 'aborted',
      reserved: [],
    });
    expect(first.view().error).toBeUndefined();
    expect(f.views[f.views.length - 1].error).toBeUndefined();
    expect(reservedCoins(f.wallet).size).toBe(0);
    f.setFault('none');
    const second = await f.join();
    expect(second.view().error).toBeUndefined();
    expect(second.view().session.phase).toBe('voting');
    expect(second.view().session.seats).toHaveLength(5);
    expect(new Set(f.identities).size).toBe(2);
    expect(f.broadcast).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});

test.each(['initial-write', 'initial-key-create', 'ack-refused'] as const)(
  '%s rejects startup, releases unsigned reservations and permits a fresh attempt',
  async fault => {
    const f = fixture('p2wpkh', 5, true, true);
    try {
      f.setFault(fault);
      await expect(f.join()).rejects.toThrow(fault === 'ack-refused' ? 'Relay rejected publication' : 'Session persistence failed');
      await drain();
      expect(f.wallet._kilojoinJournals![f.terms.id]).toMatchObject({
        phase: 'aborted',
        reserved: [],
      });
      expect(reservedCoins(f.wallet).size).toBe(0);
      expect(f.sockets[0].closed).toBe(true);
      expect(f.views).toEqual([]);
      expect(f.sockets[0].events).toHaveLength(fault === 'ack-refused' ? 1 : 0);
      f.setFault('none');
      const next = await f.join();
      expect(next.view().error).toBeUndefined();
      expect(next.view().session.phase).toBe('voting');
      expect(reservedCoins(f.wallet)).toEqual(new Set([outpoint(f.ownCoin)]));
      expect(f.broadcast).not.toHaveBeenCalled();
    } finally {
      await f.cleanup();
    }
  },
);

test.each((['p2wpkh', 'p2tr'] as const).flatMap(type => ['key-read', 'ciphertext-write'].map(fault => ({ type, fault }))))(
  'full $type client can restart after a $fault failure during Stop without reusing the old attempt',
  async ({ type, fault }) => {
    const f = fixture(type, 5, true, true);
    try {
      const first = await f.join();
      expect(first.view().session.phase).toBe('voting');
      const failing = fault === 'key-read' ? Keychain.getGenericPassword : AsyncStorage.setItem;
      (failing as jest.Mock).mockRejectedValueOnce(new Error('private synthetic cancellation detail'));
      await expect(first.close()).rejects.toThrow('Session persistence failed');
      expect(first.view().journal).toMatchObject({
        phase: 'aborted',
        reserved: [],
      });
      expect(f.sockets[0].closed).toBe(true);
      await expect(first.close()).resolves.toBeUndefined();
      const second = await f.join();
      expect(second.view().error).toBeUndefined();
      expect(second.view().session.phase).toBe('voting');
      expect(new Set(f.identities).size).toBe(2);
      expect(reservedCoins(f.wallet)).toEqual(new Set([outpoint(f.ownCoin)]));
      const count = f.views.length;
      f.sockets[0].deliver('kilojoin-participant-2', f.sockets[0].history[0]);
      f.sockets[0].onerror?.();
      await drain();
      expect(f.views).toHaveLength(count);
      expect(f.broadcast).not.toHaveBeenCalled();
      expect(f.sockets.every(socket => socket.events.length === 1)).toBe(true);
    } finally {
      await f.cleanup();
    }
  },
);

test('an authentic creator rejection aborts the unsigned join rather than showing a participant-processing failure', async () => {
  const f = fixture('p2wpkh', 5);
  try {
    f.setFault('creator-reject');
    const client = await f.join();
    expect(client.view()).toMatchObject({
      session: { phase: 'aborted', terminalCause: 'creator-rejected', seats: [] },
      journal: { phase: 'aborted', reserved: [] },
    });
    expect(client.view().error).toBeUndefined();
    expect(reservedCoins(f.wallet).size).toBe(0);
    expect(f.sockets[0].events).toHaveLength(1);
    expect(f.broadcast).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});

test('stopping after a relay failure clears the obsolete reservation warning only after durable cancellation', async () => {
  const f = fixture('p2wpkh', 1);
  try {
    const client = await f.join();
    f.sockets[0].onerror?.();
    expect(client.view().error).toContain('Could not connect');
    expect(reservedCoins(f.wallet).size).toBe(1);
    const app = BlueApp.getInstance();
    (app.saveToDisk as jest.Mock).mockRejectedValueOnce(new Error('synthetic journal write failure'));
    await expect(client.close()).rejects.toThrow();
    expect(client.view().journal.phase).toBe('joined');
    expect(client.view().error).toContain('Coins remain reserved');
    expect(reservedCoins(f.wallet).size).toBe(1);
    await client.close();
    expect(client.view().journal).toMatchObject({
      phase: 'aborted',
      reserved: [],
    });
    expect(client.view().error).toBeUndefined();
    expect(f.views[f.views.length - 1].error).toBeUndefined();
    expect(reservedCoins(f.wallet).size).toBe(0);
    const count = f.views.length;
    f.sockets[0].onerror?.();
    await drain();
    expect(f.views).toHaveLength(count);
    expect(f.broadcast).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});

test('a terminal creator rejection cannot be replaced by a later relay reservation warning', async () => {
  const f = fixture('p2wpkh', 1);
  try {
    f.setFault('creator-reject');
    const client = await f.join();
    expect(client.view().journal).toMatchObject({
      phase: 'aborted',
      reserved: [],
    });
    f.sockets[0].onerror?.();
    expect(client.view().error).toBeUndefined();
    expect(reservedCoins(f.wallet).size).toBe(0);
    expect(f.broadcast).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});

test.each(['p2wpkh', 'p2tr'] as const)('full %s startup tolerates an unrelated Lightning wallet with payment history', async type => {
  const f = fixture(type, 1);
  try {
    const lightning = new LightningCustodianWallet();
    lightning.transactions_raw = [{ type: 'paid_invoice', amt: 1, fee: 0, timestamp: 1000 }];
    BlueApp.getInstance().wallets.push(lightning);
    const client = await f.join();
    expect(client.view().error).toBeUndefined();
    expect(client.view().session).toMatchObject({ phase: 'voting', sequence: 5 });
    expect(client.view().session.seats).toHaveLength(5);
    expect(reservedCoins(f.wallet)).toEqual(new Set([outpoint(f.ownCoin)]));
    expect(f.sockets[0].events).toHaveLength(1);
    expect(f.broadcast).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});

test.each(['p2wpkh', 'p2tr'] as const)('full %s startup still rejects a roster using another on-chain wallet input', async type => {
  const f = fixture(type, 1);
  try {
    const other = new XbtSegwitBech32Wallet();
    jest.spyOn(other, 'getDerivedUtxoFromOurTransaction').mockReturnValue([f.peers[0].coin as never]);
    BlueApp.getInstance().wallets.push(other);
    const client = await f.join();
    expect(other.getDerivedUtxoFromOurTransaction).toHaveBeenCalledWith(true);
    expect(client.view().error).toContain('KJ-WALLET-INPUTS');
    expect(client.view().session).toMatchObject({ phase: 'open', seats: [] });
    expect(reservedCoins(f.wallet)).toEqual(new Set([outpoint(f.ownCoin)]));
    expect(f.sockets[0].events).toHaveLength(1);
    expect(f.broadcast).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});

const watchOnlyMatrix = (['p2wpkh', 'p2tr'] as const).flatMap(type =>
  (['p2wpkh', 'p2tr'] as const).flatMap(watchType => [false, true].map(xbt => ({ type, watchType, xbt }))),
);

function watchOnlyAccount(type: Coin['type'], xbt: boolean) {
  const source = type === 'p2wpkh' ? new XbtSegwitBech32Wallet() : new XbtTaprootWallet();
  source.setSecret('legal winner thank year wave sausage worth useful legal winner thank yellow');
  const watch = new WatchOnlyWallet();
  watch.xbt_network = xbt;
  watch.segwitType = type;
  watch.setSecret(source.getXpub());
  watch.init();
  return watch;
}

test.each(watchOnlyMatrix)(
  'full $type startup accepts a saved $watchType HD watch-only account / XBT=$xbt',
  async ({ type, watchType, xbt }) => {
    const f = fixture(type, 1);
    try {
      const watch = watchOnlyAccount(watchType, xbt);
      const hd = watch._hdWalletInstance!;
      // Exercise real public derivation and cached history, without a spending key.
      hd._txs_by_external_index[0] = [
        {
          txid: 'aa'.repeat(32),
          outputs: [
            {
              n: 0,
              value: 0.001,
              scriptPubKey: { addresses: [hd._getExternalAddressByIndex(0)] },
            },
          ],
          inputs: [],
          confirmations: 10,
        } as never,
      ];
      BlueApp.getInstance().wallets.push(watch);
      const client = await f.join();
      expect(client.view().error).toBeUndefined();
      expect(client.view().session).toMatchObject({
        phase: 'voting',
        sequence: 5,
      });
      expect(client.view().session.seats).toHaveLength(5);
      expect(reservedCoins(f.wallet)).toEqual(new Set([outpoint(f.ownCoin)]));
      expect(f.sockets[0].events).toHaveLength(1);
      expect(f.broadcast).not.toHaveBeenCalled();
    } finally {
      await f.cleanup();
    }
  },
);

test.each(watchOnlyMatrix)(
  'full $type startup rejects an input claimed by another $watchType HD watch-only account / XBT=$xbt',
  async ({ type, watchType, xbt }) => {
    const f = fixture(type, 1);
    try {
      const watch = watchOnlyAccount(watchType, xbt);
      const inventory = jest
        .spyOn(watch._hdWalletInstance!, 'getDerivedUtxoFromOurTransaction')
        .mockReturnValue([f.peers[0].coin as never]);
      BlueApp.getInstance().wallets.push(watch);
      const client = await f.join();
      expect(inventory).toHaveBeenCalledWith(true);
      expect(client.view().error).toContain('KJ-WALLET-INPUTS');
      expect(client.view().session).toMatchObject({ phase: 'open', seats: [] });
      expect(reservedCoins(f.wallet)).toEqual(new Set([outpoint(f.ownCoin)]));
      expect(f.sockets[0].events).toHaveLength(1);
      expect(f.broadcast).not.toHaveBeenCalled();
    } finally {
      await f.cleanup();
    }
  },
);
