import * as encryption from '../../blue_modules/encryption';
import { BlueApp } from '../../class/blue-app';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';

afterEach(() => jest.restoreAllMocks());

it.each(['derivation', 'write', 'verification'])('preserves the active wallet when decoy %s fails', async failure => {
  const storage = new BlueApp();
  const wallet = new XbtSegwitBech32Wallet();
  wallet.setLabel('Existing wallet');
  const wallets = [wallet];
  const transactions = { txid: { memo: 'Existing label' } };
  const contacts = { contact: { label: 'Existing contact' } };
  storage.wallets = wallets;
  storage.tx_metadata = transactions;
  storage.counterparty_metadata = contacts;
  storage.cachedPassword = 'active test password';
  jest.spyOn(storage, 'getItem').mockResolvedValue('["original encrypted bucket"]');
  const write = jest.spyOn(storage, 'setItem').mockResolvedValue(undefined);
  const encrypt = jest.spyOn(encryption, 'encrypt').mockResolvedValue('new encrypted bucket');
  if (failure === 'derivation') encrypt.mockRejectedValueOnce(new Error('native derivation failed'));
  if (failure === 'write') write.mockRejectedValueOnce(new Error('secure store unavailable'));

  await expect(storage.createFakeStorage('decoy test password')).rejects.toThrow();
  expect(storage.wallets).toBe(wallets);
  expect(storage.tx_metadata).toBe(transactions);
  expect(storage.counterparty_metadata).toBe(contacts);
  expect(storage.cachedPassword).toBe('active test password');
  if (failure === 'derivation') expect(write).not.toHaveBeenCalled();
});
