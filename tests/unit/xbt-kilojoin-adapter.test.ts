import { address, Transaction } from 'bitcoinjs-lib';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { observeCoins, walletSigner } from '../../class/xbt/kilojoin/wallet-adapter';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { XbtTaprootWallet } from '../../class/wallets/xbt-taproot-wallet';
import { Coin, coinScript, outpoint, plan, verifySignature } from '../../class/xbt/kilojoin/transaction';
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
