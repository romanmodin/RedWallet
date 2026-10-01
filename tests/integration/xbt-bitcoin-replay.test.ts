/**
 * Opt-in signing bridge for an isolated Bitcoin Core regtest rejection check.
 * No RPC or broadcast occurs here. Only the published BIP84 test mnemonic is used.
 * XBT_BITCOIN_FIXTURE and XBT_BITCOIN_RESULT must be distinct absolute JSON paths.
 * A passing bridge is not a node-validation result; record Core's receipts separately.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as bitcoin from 'bitcoinjs-lib';

import { HDSegwitBech32Wallet } from '../../class/wallets/hd-segwit-bech32-wallet';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';

jest.mock('../../blue_modules/BlueElectrum', () => ({}));

const fixturePath = process.env.XBT_BITCOIN_FIXTURE;
const resultPath = process.env.XBT_BITCOIN_RESULT;
const bridgeTest = fixturePath ? it : it.skip;

describe('XBT replay rejection on independent Bitcoin Core', () => {
  bridgeTest('signs identical public regtest inputs using Unified and Bitcoin digests', () => {
    if (!fixturePath || !path.isAbsolute(fixturePath) || !resultPath || !path.isAbsolute(resultPath)) {
      throw new Error('Fixture and result must be explicit absolute paths');
    }
    if (path.resolve(fixturePath) === path.resolve(resultPath)) throw new Error('Fixture and result paths must differ');
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    expect(fixture.chain).toBe('regtest');
    expect(fixture.implementation).toBe('Bitcoin Core');
    expect(fixture.confirmations).toBeGreaterThan(0);
    const parent = bitcoin.Transaction.fromHex(fixture.fundingHex);
    expect(parent.isCoinbase()).toBe(false);

    const wallet = new XbtSegwitBech32Wallet();
    const bitcoinWallet = new HDSegwitBech32Wallet();
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    wallet.setSecret(mnemonic);
    bitcoinWallet.setSecret(mnemonic);
    const inputs = [60_000, 40_000].map((value, index) => {
      const address = wallet._getExternalAddressByIndex(index);
      expect(bitcoinWallet._getExternalAddressByIndex(index)).toBe(address);
      const script = Buffer.from(bitcoin.address.toOutputScript(address));
      const matches = parent.outs
        .map((output, vout) => ({ output, vout }))
        .filter(({ output }) => output.value === BigInt(value) && Buffer.from(output.script).equals(script));
      expect(matches).toHaveLength(1);
      return { txid: parent.getId(), vout: matches[0].vout, value, address, confirmations: fixture.confirmations };
    });
    const parentSpy = jest.spyOn(wallet, 'getTransactions').mockReturnValue([
      {
        txid: parent.getId(),
        confirmations: fixture.confirmations,
        inputs: parent.ins.map(input => ({ txid: Buffer.from(input.hash).reverse().toString('hex'), vout: input.index })),
      } as any,
    ]);
    try {
      const targets = [{ address: wallet._getExternalAddressByIndex(2), value: 90_000 }];
      const changeAddress = wallet._getInternalAddressByIndex(0);
      const unified = wallet.createTransaction(inputs, targets, 1, changeAddress).tx!;
      const standard = bitcoinWallet.createTransaction(inputs, targets, 1, changeAddress).tx!;
      expect(unified.ins).toHaveLength(2);
      expect(standard.ins).toHaveLength(2);
      // Same non-witness transaction: different funding or outputs cannot explain rejection.
      expect(unified.getId()).toBe(standard.getId());
      for (const input of unified.ins) expect(input.witness[0].at(-1)).toBe(0x21);
      for (const input of standard.ins) expect(input.witness[0].at(-1)).toBe(0x01);
      const stripped = bitcoin.Transaction.fromHex(unified.toHex());
      for (const input of stripped.ins) {
        input.witness[0][input.witness[0].length - 1] = 0x01;
      }
      expect(stripped.getId()).toBe(unified.getId());
      fs.writeFileSync(
        resultPath,
        JSON.stringify(
          {
            purpose: 'Public BIP84 fixture on isolated Bitcoin Core regtest only',
            txid: unified.getId(),
            inputs,
            unifiedHex: unified.toHex(),
            strippedUnifiedHex: stripped.toHex(),
            bitcoinControlHex: standard.toHex(),
          },
          null,
          2,
        ) + '\n',
        { mode: 0o600 },
      );
    } finally {
      parentSpy.mockRestore();
    }
  });
});
