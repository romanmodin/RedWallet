import BIP32Factory from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import ecc from '../../blue_modules/noble_ecc';
import { UR, UREncoder } from '@ngraveio/bc-ur';
import { BlueURDecoder } from '../../blue_modules/ur';
import startImport from '../../class/wallet-import';
import { BtcWatchOnlyWallet } from '../../class/wallets/btc-watch-only-wallet';
import { BtcSegwitBech32Wallet } from '../../class/wallets/btc-segwit-bech32-wallet';
import { isBtcWallet } from '../../blue_modules/wallet-network';
import fixture from '../fixtures/keystone3-btc-crypto-account.json';

jest.mock('electrum-client', () => jest.fn());
const bip32 = BIP32Factory(ecc);
const account = fixture.accounts.find(a => a.path === "m/84'/0'/0'")!;

async function importDecodedAccount(decoder: InstanceType<typeof BlueURDecoder>) {
  expect(decoder.isComplete()).toBe(true);
  const text = decoder.toString();
  const publicAccounts = JSON.parse(text);
  expect(publicAccounts).toHaveLength(4);
  expect(publicAccounts.map((a: any) => a.AccountKeyPath)).toEqual(fixture.accounts.map(a => a.path));
  const password = jest.fn(async () => '');
  const { wallets } = await startImport(
    text,
    false,
    false,
    true,
    () => {},
    () => {},
    password,
    true,
    'segwit',
    {},
    'btc',
  ).promise;
  expect(wallets).toHaveLength(1);
  const wallet = wallets[0] as BtcWatchOnlyWallet;
  expect(wallet).toBeInstanceOf(BtcWatchOnlyWallet);
  expect(isBtcWallet(wallet)).toBe(true);
  expect(wallet.getDerivationPath()).toBe(account.path);
  expect(wallet.getMasterFingerprintHex().toUpperCase()).toBe(fixture.masterFingerprint);
  expect(wallet._hdWalletInstance).toBeInstanceOf(BtcSegwitBech32Wallet);
  expect(wallet.allowSend()).toBe(false);
  expect(password).not.toHaveBeenCalled();
  const expected = bip32.fromBase58(account.xpub);
  for (const chain of [0, 1]) {
    for (const index of [0, 1, 7]) {
      const address = bitcoin.payments.p2wpkh({ pubkey: expected.derive(chain).derive(index).publicKey }).address;
      expect(chain ? wallet._getInternalAddressByIndex(index) : wallet._getExternalAddressByIndex(index)).toBe(address);
    }
  }
  expect(require('electrum-client')).not.toHaveBeenCalled();
}

beforeEach(() => jest.clearAllMocks());

test('imports Keystone firmware single-frame crypto-account QR through the actual decoder', async () => {
  const ur = new UR(Buffer.from(fixture.cborHex, 'hex'), fixture.registryType);
  const decoder = new BlueURDecoder();
  decoder.receivePart(UREncoder.encodeSinglePart(ur).toUpperCase());
  await importDecodedAccount(decoder);
});

test('imports the same Keystone account from animated, reordered and repeated UR fragments', async () => {
  const ur = new UR(Buffer.from(fixture.cborHex, 'hex'), fixture.registryType);
  const fragments = new UREncoder(ur, 80).encodeWhole();
  expect(fragments.length).toBeGreaterThan(1);
  const decoder = new BlueURDecoder();
  for (const fragment of [...fragments].reverse()) {
    decoder.receivePart(fragment);
    decoder.receivePart(fragment);
  }
  await importDecodedAccount(decoder);
});
