import { BlueApp } from '../../class/blue-app';
import { MixingClient, recoverWalletRounds, confirmRecoveredRound } from '../../class/xbt/kilojoin/client';
import { address, Transaction } from 'bitcoinjs-lib';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { observeCoins, walletSigner } from '../../class/xbt/kilojoin/wallet-adapter';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { XbtTaprootWallet } from '../../class/wallets/xbt-taproot-wallet';
import { Coin, coinScript, outpoint, plan, verifySignature, transaction, digest } from '../../class/xbt/kilojoin/transaction';
import { Round } from '../../class/xbt/kilojoin/round';
import { WalletJournalStore } from '../../class/xbt/kilojoin/wallet-store';
import { ECPairFactory } from 'ecpair';
import ecc from '../../blue_modules/noble_ecc';
jest.mock('../../blue_modules/BlueElectrum', () => ({
  multiGetTransactionByTxid: jest.fn(),
  multiGetUtxoByAddress: jest.fn(),
  multiGetHistoryByAddress: jest.fn(),
  getReportedBlockTip: jest.fn(),
}));
const ECPair = ECPairFactory(ecc);
afterEach(() => jest.restoreAllMocks());
function fixture(Wallet = XbtSegwitBech32Wallet as typeof XbtSegwitBech32Wallet | typeof XbtTaprootWallet) {
  const wallet = new Wallet();
  wallet.setSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
  const a = wallet._getExternalAddressByIndex(0),
    key = ECPair.fromWIF(wallet._getWifForAddress(a)!);
  const raw = new Transaction();
  raw.addInput(Buffer.alloc(32, 1), 0);
  raw.addOutput(address.toOutputScript(a), 50000n);
  const coin: Coin = {
    txid: raw.getId(),
    vout: 0,
    value: 50000,
    pubkey: Buffer.from(key.publicKey).toString('hex'),
    type: wallet.segwitType,
  };
  (BlueElectrum.multiGetTransactionByTxid as jest.Mock).mockResolvedValue({ [coin.txid]: raw.toHex() });
  (BlueElectrum.multiGetUtxoByAddress as jest.Mock).mockResolvedValue({ [a]: [{ txid: coin.txid, vout: 0, value: 50000, height: 100 }] });
  (BlueElectrum.multiGetHistoryByAddress as jest.Mock).mockResolvedValue({ [a]: [{ tx_hash: coin.txid, height: 100 }] });
  (BlueElectrum.getReportedBlockTip as jest.Mock).mockResolvedValue(105);
  return { wallet, coin, raw, a };
}
test('backend adapter verifies raw parent and corroborates confirmed unspent height', async () => {
  const f = fixture();
  expect((await observeCoins([f.coin], () => 1000)).get(outpoint(f.coin))).toMatchObject({ unspent: true, checkedAt: 1000 });
  (BlueElectrum.multiGetHistoryByAddress as jest.Mock).mockResolvedValue({ [f.a]: [{ tx_hash: f.coin.txid, height: 101 }] });
  await expect(observeCoins([f.coin])).rejects.toThrow('verified confirmed');
});
test('backend adapter rejects spent or mismatched coins', async () => {
  let f = fixture();
  (BlueElectrum.multiGetUtxoByAddress as jest.Mock).mockResolvedValue({ [f.a]: [] });
  await expect(observeCoins([f.coin])).rejects.toThrow();
  f = fixture();
  f.coin.value++;
  await expect(observeCoins([f.coin])).rejects.toThrow();
});
test.each([XbtSegwitBech32Wallet, XbtTaprootWallet])(
  '%s signer requires persisted approval and signs only its reserved coin',
  async Wallet => {
    const { wallet, coin } = fixture(Wallet),
      store = new WalletJournalStore(wallet, async () => {});
    const round = await Round.join(wallet.getID(), 'ab'.repeat(8), [outpoint(coin)], 10000, 1, store);
    const other = { ...coin, txid: '22'.repeat(32) },
      type = coin.type;
    const output = (i: number) => (type === 'p2wpkh' ? '0014' + i.toString(16).repeat(40) : '5120' + i.toString(16).repeat(64));
    const changeValue = type === 'p2wpkh' ? 39729 : 39702;
    const p = plan(
      [coin, other],
      [output(3), output(4)],
      [
        { script: output(5), value: changeValue },
        { script: output(6), value: changeValue },
      ],
      10000,
    );
    const signer = walletSigner(wallet, round, () => 5);
    await expect(signer(p, [coin])).rejects.toThrow('approval');
    const reviewed = await round.review(
      p,
      {
        mine: [coin],
        mixScript: output(3),
        changeScript: output(5),
        maxFee: 400,
        feeRate: 2,
        seatInputs: [1, 1],
        verified: new Map([coin, other].map(c => [outpoint(c), { value: c.value, script: coinScript(c).toString('hex') }])),
      },
      2,
    );
    await round.approve(reviewed.commitment!, 3);
    await round.beforeSigning(reviewed.commitment!, 4);
    const signatures = await signer(p, [coin]);
    expect(
      verifySignature(
        p,
        p.coins.findIndex(c => c.txid === coin.txid),
        signatures.get(outpoint(coin))!,
      ),
    ).toBe(true);
    await expect(signer(p, [other])).rejects.toThrow();
  },
);

test('native client requires experimental acknowledgment before reading wallet keys or opening sockets', async () => {
  await expect(MixingClient.join({} as never)).rejects.toThrow('acknowledgment required');
});

test('recovered signed rounds retain locks until corroborated confirmation and freeze recovered outputs', async () => {
  const { wallet, coin, a } = fixture(),
    store = new WalletJournalStore(wallet, async () => {});
  const app = BlueApp.getInstance(),
    previousWallets = app.wallets;
  app.wallets = [wallet];
  const save = jest.spyOn(app, 'saveToDisk').mockResolvedValue(undefined);
  try {
    const mixed = address.toOutputScript(wallet._getExternalAddressByIndex(1));
    const changeScript = address.toOutputScript(wallet._getInternalAddressByIndex(0));
    const other = { ...coin, txid: '22'.repeat(32) };
    const p = plan(
      [coin, other],
      [Buffer.from(mixed).toString('hex'), '0014' + '33'.repeat(20)],
      [
        { script: Buffer.from(changeScript).toString('hex'), value: 39729 },
        { script: '0014' + '44'.repeat(20), value: 39729 },
      ],
      10000,
    );
    const round = await Round.join(wallet.getID(), 'ab'.repeat(8), [outpoint(coin)], 10000, 1, store);
    const reviewed = await round.review(
      p,
      {
        mine: [coin],
        mixScript: Buffer.from(mixed).toString('hex'),
        changeScript: Buffer.from(changeScript).toString('hex'),
        maxFee: 400,
        feeRate: 2,
        seatInputs: [1, 1],
        verified: new Map([coin, other].map(c => [outpoint(c), { value: c.value, script: coinScript(c).toString('hex') }])),
      },
      2,
    );
    await round.approve(reviewed.commitment!, 3);
    await round.beforeSigning(reviewed.commitment!, 4);
    expect((await recoverWalletRounds(wallet))[0].phase).toBe('uncertain');
    const signed = transaction(p),
      key = ECPair.fromWIF(wallet._getWifForAddress(a)!);
    p.coins.forEach((c, i) =>
      signed.setWitness(i, [Buffer.concat([ecc.signDER(digest(p, i), key.privateKey!), Buffer.from([0x21])]), key.publicKey]),
    );
    const id = signed.getId(),
      addresses = [address.fromOutputScript(mixed), address.fromOutputScript(changeScript)];
    (BlueElectrum.multiGetTransactionByTxid as jest.Mock).mockResolvedValue({ [id]: signed.toHex() });
    (BlueElectrum.getReportedBlockTip as jest.Mock).mockResolvedValue(205);
    (BlueElectrum.multiGetHistoryByAddress as jest.Mock).mockResolvedValue(
      Object.fromEntries(addresses.map((addr, i) => [addr, [{ tx_hash: id, height: 200 + i }]])),
    );
    await expect(confirmRecoveredRound(wallet, 'ab'.repeat(8))).resolves.toBe(false);
    expect(wallet._kilojoinJournals!['ab'.repeat(8)].reserved).toHaveLength(1);
    (BlueElectrum.multiGetHistoryByAddress as jest.Mock).mockResolvedValue(
      Object.fromEntries(addresses.map(addr => [addr, [{ tx_hash: id, height: 200 }]])),
    );
    await expect(confirmRecoveredRound(wallet, 'ab'.repeat(8))).resolves.toBe(true);
    expect(wallet._kilojoinJournals!['ab'.repeat(8)].reserved).toHaveLength(0);
    p.outputs.forEach((o, index) => {
      if (addresses.includes(address.fromOutputScript(Buffer.from(o.script, 'hex'))))
        expect(wallet.getUTXOMetadata(id, index).frozen).toBe(true);
    });
  } finally {
    save.mockRestore();
    app.wallets = previousWallets;
  }
});

test.each(['missing', 'duplicate', 'value', 'unconfirmed', 'future', 'history-missing', 'history-conflict'])(
  'rejects corroboration failure %s before accepting a peer coin',
  async fault => {
    const f = fixture();
    const utxo = { txid: f.coin.txid, vout: f.coin.vout, value: f.coin.value, height: 100 };
    let entries = [utxo];
    if (fault === 'missing') entries = [];
    if (fault === 'duplicate') entries = [utxo, { ...utxo }];
    if (fault === 'value') utxo.value++;
    if (fault === 'unconfirmed') utxo.height = 0;
    if (fault === 'future') utxo.height = 106;
    (BlueElectrum.multiGetUtxoByAddress as jest.Mock).mockResolvedValue({ [f.a]: entries });
    if (fault === 'history-missing') (BlueElectrum.multiGetHistoryByAddress as jest.Mock).mockResolvedValue({ [f.a]: [] });
    if (fault === 'history-conflict')
      (BlueElectrum.multiGetHistoryByAddress as jest.Mock).mockResolvedValue({ [f.a]: [{ tx_hash: f.coin.txid, height: 99 }] });
    await expect(observeCoins([f.coin], () => 1000)).rejects.toThrow('CoinJoin requires a verified confirmed unspent coin');
  },
);

// Preserve all existing rejections while exposing only the failed fixed check.
test.each([
  ['missing', 'KJ-CHAIN-UNSPENT'],
  ['duplicate', 'KJ-CHAIN-UNSPENT'],
  ['utxo-value', 'KJ-CHAIN-UTXO-VALUE'],
  ['unconfirmed', 'KJ-CHAIN-CONFIRMATION'],
  ['invalid-height', 'KJ-CHAIN-CONFIRMATION'],
  ['future', 'KJ-CHAIN-TIP-HEIGHT'],
  ['history-missing', 'KJ-CHAIN-HISTORY'],
  ['history-duplicate', 'KJ-CHAIN-HISTORY'],
  ['history-conflict', 'KJ-CHAIN-HEIGHT-MISMATCH'],
  ['output-missing', 'KJ-CHAIN-OUTPUT'],
  ['parent-value', 'KJ-CHAIN-VALUE'],
  ['parent-script', 'KJ-CHAIN-SCRIPT'],
])('reports precise chain rejection %s without accepting the input', async (fault, code) => {
  const f = fixture();
  const utxo = {
    txid: f.coin.txid,
    vout: f.coin.vout,
    value: f.coin.value,
    height: 100,
  };
  let list = [utxo];
  if (fault === 'missing') list = [];
  if (fault === 'duplicate') list = [utxo, { ...utxo }];
  if (fault === 'utxo-value') utxo.value++;
  if (fault === 'unconfirmed') utxo.height = 0;
  if (fault === 'invalid-height') utxo.height = 100.5;
  if (fault === 'future') utxo.height = 106;
  (BlueElectrum.multiGetUtxoByAddress as jest.Mock).mockResolvedValue({
    [f.a]: list,
  });
  if (fault === 'history-missing')
    (BlueElectrum.multiGetHistoryByAddress as jest.Mock).mockResolvedValue({
      [f.a]: [],
    });
  if (fault === 'history-duplicate')
    (BlueElectrum.multiGetHistoryByAddress as jest.Mock).mockResolvedValue({
      [f.a]: [
        { tx_hash: f.coin.txid, height: 100 },
        { tx_hash: f.coin.txid, height: 100 },
      ],
    });
  if (fault === 'history-conflict')
    (BlueElectrum.multiGetHistoryByAddress as jest.Mock).mockResolvedValue({
      [f.a]: [{ tx_hash: f.coin.txid, height: 99 }],
    });
  if (fault === 'output-missing') f.coin.vout = 1;
  if (fault === 'parent-value') f.coin.value++;
  if (fault === 'parent-script') f.coin.pubkey = Buffer.from(ECPair.fromPrivateKey(Buffer.alloc(32, 2)).publicKey).toString('hex');
  await expect(observeCoins([f.coin], () => 1000)).rejects.toMatchObject({
    message: 'CoinJoin requires a verified confirmed unspent coin',
    code,
  });
});
