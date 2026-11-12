import BIP32Factory from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import ecc from '../../blue_modules/noble_ecc';
import { UR, UREncoder } from '@ngraveio/bc-ur';
import { BlueURDecoder } from '../../blue_modules/ur';
import startImport from '../../class/wallet-import';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { XbtTaprootWallet } from '../../class/wallets/xbt-taproot-wallet';
import { isBtcWallet } from '../../blue_modules/wallet-network';
import fixture from '../fixtures/keystone3-btc-crypto-account.json';

jest.mock('electrum-client', () => jest.fn());
const bip32 = BIP32Factory(ecc);

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
  ).promise;
  expect(wallets).toHaveLength(2);
  for (const candidate of wallets) {
    const wallet = candidate as WatchOnlyWallet;
    const account = fixture.accounts.find(a => a.path === wallet.getDerivationPath())!;
    const taproot = account.path.startsWith("m/86'");
    expect(wallet).toBeInstanceOf(WatchOnlyWallet);
    expect(isBtcWallet(wallet)).toBe(false);
    expect(wallet.xbt_network).toBe(true);
    expect(wallet.getMasterFingerprintHex().toUpperCase()).toBe(fixture.masterFingerprint);
    expect(wallet._hdWalletInstance).toBeInstanceOf(taproot ? XbtTaprootWallet : XbtSegwitBech32Wallet);
    expect(wallet.allowSend()).toBe(false);
    expect(password).not.toHaveBeenCalled();
    const expected = bip32.fromBase58(account.xpub);
    for (const chain of [0, 1]) {
      for (const index of [0, 1, 7]) {
        const pubkey = expected.derive(chain).derive(index).publicKey;
        const address = taproot
          ? bitcoin.payments.p2tr({ internalPubkey: pubkey.subarray(1, 33) }).address
          : bitcoin.payments.p2wpkh({ pubkey }).address;
        expect(chain ? wallet._getInternalAddressByIndex(index) : wallet._getExternalAddressByIndex(index)).toBe(address);
      }
    }
  }
  expect(require('electrum-client')).not.toHaveBeenCalled();
}

beforeEach(() => jest.clearAllMocks());

test('imports Keystone firmware single-frame crypto-account QR on XBT through the actual decoder', async () => {
  const ur = new UR(Buffer.from(fixture.cborHex, 'hex'), fixture.registryType);
  const decoder = new BlueURDecoder();
  decoder.receivePart(UREncoder.encodeSinglePart(ur).toUpperCase());
  await importDecodedAccount(decoder);
});

test('imports the same Keystone XBT accounts from animated, reordered and repeated UR fragments', async () => {
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

function decodeAccounts() {
  const ur = new UR(Buffer.from(fixture.cborHex, 'hex'), fixture.registryType);
  const decoder = new BlueURDecoder();
  decoder.receivePart(UREncoder.encodeSinglePart(ur));
  return JSON.parse(decoder.toString());
}

async function importAccounts(accounts: unknown, onWallet = jest.fn()) {
  return startImport(
    JSON.stringify(accounts),
    false,
    false,
    true,
    () => {},
    onWallet,
    async () => '',
    true,
  ).promise;
}

test('rejects a corrupt supported account before importing any account', async () => {
  const accounts = decodeAccounts();
  accounts.find((a: any) => a.AccountKeyPath.startsWith("m/86'")).ExtPubKey = 'xpub-invalid';
  const onWallet = jest.fn();
  await expect(importAccounts(accounts, onWallet)).rejects.toThrow('Invalid XBT public account');
  expect(onWallet).not.toHaveBeenCalled();
});

test('rejects unsupported-only and oversized QR account lists', async () => {
  const accounts = decodeAccounts();
  await expect(importAccounts(accounts.filter((a: any) => /m\/(44|49)'/.test(a.AccountKeyPath)))).rejects.toThrow('no supported XBT');
  await expect(importAccounts(Array(21).fill(accounts[0]))).rejects.toThrow('Invalid cold-wallet');
});

test('normalizes hardened path notation and preserves nonzero account identity validation', async () => {
  const accounts = decodeAccounts().filter((a: any) => a.AccountKeyPath.startsWith("m/84'"));
  accounts[0].AccountKeyPath = '84h/0h/0h';
  const { wallets } = await importAccounts(accounts);
  expect((wallets[0] as WatchOnlyWallet).getDerivationPath()).toBe("m/84'/0'/0'");
  accounts[0].AccountKeyPath = '84h/0h/1h';
  await expect(importAccounts(accounts)).rejects.toThrow('Invalid XBT public account');
});

test('preserves single-account Keystone exports without enabling an external signer', async () => {
  const account = decodeAccounts().find((a: any) => a.AccountKeyPath.startsWith("m/84'"));
  const { wallets } = await importAccounts({ ...account, CoboVaultFirmwareVersion: '1.2.4(BTC-Only)' });
  expect(wallets).toHaveLength(1);
  const wallet = wallets[0] as WatchOnlyWallet;
  expect(wallet.xbt_network).toBe(true);
  expect(wallet.getDerivationPath()).toBe(account.AccountKeyPath);
  expect(wallet.getMasterFingerprintHex().toUpperCase()).toBe(fixture.masterFingerprint);
  expect(wallet.allowSend()).toBe(false);
});
