import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import Realm from 'realm';
import ecc from '../../blue_modules/noble_ecc';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import * as standardHardware from '../../class/xbt/standard-hardware';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { XBT_MAINNET_CHECKPOINT_HEADER } from '../../class/xbt/electrum-checkpoint';
import { signUnifiedP2wpkhInput, finalizeUnifiedP2wpkhInput } from '../../class/xbt/unified-psbt';

jest.mock('react-native-default-preference', () => ({
  __esModule: true,
  default: {
    setName: jest.fn(),
    get: jest.fn(async (key: string) => ({ electrum_host: 'isolated.test', electrum_tcp_port: '', electrum_ssl_port: '50002' })[key]),
    set: jest.fn(),
    clear: jest.fn(),
  },
}));
jest.mock('electrum-client', () => jest.fn().mockImplementation(() => mockClient));

let mockClient: ReturnType<typeof clientFor>;
const originalFetch = global.fetch;
const checkpoint = '00000000000000000001d82da6ecccf08e07afa383f9212b0e1b95cc72430c00';
const seed = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function clientFor(raws: Record<string, string>, history: any[]) {
  return {
    // Single-request mode exercises real production readers without mocking them.
    initElectrum: jest.fn(async () => ['ElectrumPersonalServer', '1.4']),
    blockchainBlock_header: jest.fn(async () => XBT_MAINNET_CHECKPOINT_HEADER),
    blockchainHeaders_subscribe: jest.fn(async () => ({ height: 1000009 })),
    blockchainTransaction_get: jest.fn(async (id: string) => raws[id]),
    blockchainScripthash_getHistory: jest.fn(async () => history),
    blockchainTransaction_broadcast: jest.fn(async (hex: string) => bitcoin.Transaction.fromHex(hex).getId()),
    server_ping: jest.fn(async () => undefined),
    close: jest.fn(),
  };
}

async function ready() {
  const cold = new XbtSegwitBech32Wallet();
  cold.setSecret(seed);
  const watch = new WatchOnlyWallet();
  watch.setSecret('[73c5da0a/84h/0h/0h]' + cold.getXpub()).init();
  watch.setUseWithHardwareWalletEnabled(true);
  watch.setHardwareSigningMode('standard');
  const receive = watch._getExternalAddressByIndex(0);
  const key = ECPairFactory(ecc).fromWIF(cold._getWifForAddress(receive)!);
  const ancestor = new bitcoin.Transaction();
  ancestor.addInput(Buffer.alloc(32, 1), 0);
  ancestor.addOutput(bitcoin.address.toOutputScript(receive), 200000n);
  const funding = new bitcoin.Psbt();
  funding.addInput({ hash: ancestor.getId(), index: 0, witnessUtxo: ancestor.outs[0], sighashType: 0x21 });
  funding.addOutput({ address: receive, value: 199000n });
  signUnifiedP2wpkhInput(funding, 0, key);
  finalizeUnifiedP2wpkhInput(funding, 0, key.publicKey, (pubkey, hash, sig) => ecc.verify(hash, pubkey, sig));
  const parent = funding.extractTransaction();
  // Synthetic inclusion fixture; real chain/consensus is covered by the separate
  // shared-history Core/Knots integration test. No external requests here.
  const conflict = parent.clone();
  conflict.outs[0].value = 198000n;
  const sibling = Buffer.alloc(32, 3);
  const header = Buffer.alloc(80);
  Buffer.from(bitcoin.crypto.hash256(Buffer.concat([sibling, conflict.getHash()]))).copy(header, 36);
  const blockHash = Buffer.from(bitcoin.crypto.hash256(header)).reverse().toString('hex');
  const raws = { [parent.getId()]: parent.toHex(), [ancestor.getId()]: ancestor.toHex() };
  const history = [{ tx_hash: parent.getId(), height: 1000000 }];
  mockClient = clientFor(raws, history);
  const client = mockClient;
  expect(await BlueElectrum.ensureConnected()).toBe(true);
  const response = async (url: any, options: any) => {
    expect(options.method).toBe('GET');
    let value: string;
    if (url.endsWith('/block-height/961640')) value = checkpoint;
    else if (url.endsWith('/blocks/tip/height')) value = '1000009';
    else if (url.includes('/outspend/'))
      value = JSON.stringify({
        spent: true,
        txid: conflict.getId(),
        status: { confirmed: true, block_height: 1000000, block_hash: blockHash },
      });
    else if (url.endsWith('/hex')) value = conflict.toHex();
    else if (url.endsWith('/merkle-proof'))
      value = JSON.stringify({
        block_height: 1000000,
        pos: 1,
        merkle: [Buffer.from(sibling).reverse().toString('hex')],
      });
    else if (url.endsWith('/header')) value = header.toString('hex');
    else if (url.endsWith('/block-height/1000000')) value = blockHash;
    else if (url.endsWith('/block/' + blockHash)) value = JSON.stringify({ id: blockHash, height: 1000000, tx_count: 2 });
    else throw new Error('Unexpected proof request');
    return { ok: true, redirected: false, url, headers: { get: () => null }, text: async () => value } as any;
  };
  global.fetch = jest.fn(response);
  jest
    .spyOn(watch._hdWalletInstance!, 'getTransactions')
    .mockReturnValue([{ txid: parent.getId(), rawHex: parent.toHex(), confirmations: 10 } as any]);
  const request = (
    await watch.createStandardHardwareTransaction(
      [{ txid: parent.getId(), vout: 0, value: 199000, address: receive, confirmations: 10 }],
      [{ address: cold._getExternalAddressByIndex(1), value: 50000 }],
      2,
      watch._getInternalAddressByIndex(0),
    )
  ).psbt;
  const signed = request.clone();
  signed.signInput(0, key);
  const hex = watch.combinePsbt(request, signed).toHex();
  return { watch, request, hex, history, raws, client, response };
}

beforeEach(async () => {
  BlueElectrum.forceDisconnect();
  await BlueElectrum.setDisabled(false);
  (Realm as any).__mockRealmHelpers.reset();
  jest.spyOn(standardHardware, 'assertStandardHardwareReleased').mockImplementation(() => {});
});
afterEach(() => {
  global.fetch = originalFetch;
  BlueElectrum.forceDisconnect();
  jest.restoreAllMocks();
});

it('rechecks live evidence after slow signing and sends only the reviewed bytes once', async () => {
  const f = await ready();
  const historyReads = f.client.blockchainScripthash_getHistory.mock.calls.length;
  const proofReads = (global.fetch as jest.Mock).mock.calls.length;
  const later = Date.now() + 600000;
  jest.spyOn(Date, 'now').mockReturnValue(later);
  await expect(f.watch.broadcastTx(f.hex)).resolves.toBe(true);
  expect(f.client.blockchainScripthash_getHistory.mock.calls.length).toBeGreaterThan(historyReads);
  expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(proofReads);
  expect(f.client.blockchainTransaction_broadcast).toHaveBeenCalledTimes(1);
  expect(f.client.blockchainTransaction_broadcast).toHaveBeenCalledWith(f.hex);
  await expect(f.watch.broadcastTx(f.hex)).rejects.toThrow('verified signing request');
  expect(f.client.blockchainTransaction_broadcast).toHaveBeenCalledTimes(1);
});

it('blocks a changed XBT confirmation state at the actual broadcast boundary', async () => {
  const f = await ready();
  f.history[0].height = 0;
  await expect(f.watch.broadcastTx(f.hex)).rejects.toThrow('six XBT confirmations');
  expect(f.client.blockchainTransaction_broadcast).not.toHaveBeenCalled();
});

it('does not fall back to the cached XBT tip when its fresh request fails', async () => {
  const f = await ready();
  f.client.blockchainHeaders_subscribe.mockRejectedValue(new Error('tip unavailable'));
  await expect(f.watch.broadcastTx(f.hex)).rejects.toThrow('tip unavailable');
  expect(f.client.blockchainTransaction_broadcast).not.toHaveBeenCalled();
});

it('blocks a provider outage after the signature has already been accepted', async () => {
  const f = await ready();
  global.fetch = jest.fn(async () => {
    throw new Error('proof offline');
  });
  await expect(f.watch.broadcastTx(f.hex)).rejects.toThrow('proof offline');
  expect(f.client.blockchainTransaction_broadcast).not.toHaveBeenCalled();
});

it('stops when the signer is disabled while proof requests are in flight', async () => {
  const f = await ready();
  (global.fetch as jest.Mock).mockImplementationOnce(async (url, options) => {
    f.watch.setUseWithHardwareWalletEnabled(false);
    return f.response(url, options);
  });
  await expect(f.watch.broadcastTx(f.hex)).rejects.toThrow('Signing request changed');
  expect(f.client.blockchainTransaction_broadcast).not.toHaveBeenCalled();
});

it('does not switch to a replacement Electrum connection during proof collection', async () => {
  const f = await ready();
  let replacement: ReturnType<typeof clientFor> | undefined;
  let reconnect: Promise<boolean> | undefined;
  (global.fetch as jest.Mock).mockImplementationOnce(async (url, options) => {
    BlueElectrum.forceDisconnect();
    replacement = clientFor(f.raws, f.history);
    mockClient = replacement;
    reconnect = BlueElectrum.ensureConnected();
    await reconnect;
    return f.response(url, options);
  });
  await expect(f.watch.broadcastTx(f.hex)).rejects.toThrow('connection changed');
  await reconnect;
  expect(f.client.blockchainTransaction_broadcast).not.toHaveBeenCalled();
  expect(replacement!.blockchainTransaction_broadcast).not.toHaveBeenCalled();
});

it('refuses altered bytes before collecting fresh evidence or submitting them', async () => {
  const f = await ready();
  const changed = bitcoin.Transaction.fromHex(f.hex);
  changed.outs[0].value += 1n;
  const requests = (global.fetch as jest.Mock).mock.calls.length;
  await expect(f.watch.broadcastTx(changed.toHex())).rejects.toThrow('verified signing request');
  expect((global.fetch as jest.Mock).mock.calls.length).toBe(requests);
  expect(f.client.blockchainTransaction_broadcast).not.toHaveBeenCalled();
});

it('treats an unexpected transaction ID as a failed submission', async () => {
  const f = await ready();
  f.client.blockchainTransaction_broadcast.mockResolvedValue('ab'.repeat(32));
  await expect(f.watch.broadcastTx(f.hex)).rejects.toThrow('Unexpected XBT broadcast response');
});

it.each([0, -1, 1000004, NaN])('rejects invalid or insufficient fresh tip %s despite a prior mature tip', async height => {
  const f = await ready();
  f.client.blockchainHeaders_subscribe.mockResolvedValue({ height });
  await expect(f.watch.broadcastTx(f.hex)).rejects.toThrow();
  expect(f.client.blockchainTransaction_broadcast).not.toHaveBeenCalled();
});

it('prevents concurrent taps from submitting the same approved transaction twice', async () => {
  const f = await ready();
  let entered!: () => void;
  let finish!: (id: string) => void;
  const submitted = new Promise<void>(resolve => {
    entered = resolve;
  });
  f.client.blockchainTransaction_broadcast.mockImplementation(() => {
    entered();
    return new Promise<string>(resolve => {
      finish = resolve;
    });
  });
  const first = f.watch.broadcastTx(f.hex);
  await submitted;
  await expect(f.watch.broadcastTx(f.hex)).rejects.toThrow('already being submitted');
  expect(f.client.blockchainTransaction_broadcast).toHaveBeenCalledTimes(1);
  finish(bitcoin.Transaction.fromHex(f.hex).getId());
  await expect(first).resolves.toBe(true);
});

it('permits an explicit retry after a failed submission and rechecks evidence again', async () => {
  const f = await ready();
  f.client.blockchainTransaction_broadcast.mockRejectedValueOnce(new Error('submission unavailable'));
  await expect(f.watch.broadcastTx(f.hex)).rejects.toThrow('submission unavailable');
  const reads = (global.fetch as jest.Mock).mock.calls.length;
  await expect(f.watch.broadcastTx(f.hex)).resolves.toBe(true);
  expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(reads);
  expect(f.client.blockchainTransaction_broadcast).toHaveBeenCalledTimes(2);
  expect(f.client.blockchainTransaction_broadcast.mock.calls.every(call => call[0] === f.hex)).toBe(true);
});
