/**
 * Bridge for a manually controlled, network-isolated Knots regtest node.
 * This never calls RPC, broadcasts, or uses private wallet material.
 * Prepare:
 * XBT_KNOTS_PREPARE=1 XBT_KNOTS_RESULT=/tmp/redwallet-knots-plan.json \
 *   npx jest --runInBand tests/integration/xbt-knots-acceptance.test.ts
 * Fund the listed regtest addresses after Blake2b activation and mine funding.
 * Fixture: { chain: "regtest", blake2bHeight: 150, height: 151,
 *   fundingTransactions: [{ rawTx: "<real funding tx hex>", confirmations: 1 }] }
 * Sign:
 * XBT_KNOTS_FIXTURE=/tmp/redwallet-knots-fixture.json \
 * XBT_KNOTS_RESULT=/tmp/redwallet-knots-result.json \
 *   npx jest --runInBand tests/integration/xbt-knots-acceptance.test.ts
 * The controller must verify goodHex passes testmempoolaccept, both negatives
 * fail script verification, then submit/mine goodHex only on isolated regtest.
 * Successful execution here proves fixture/signing assertions, not node acceptance.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as bitcoin from 'bitcoinjs-lib';

import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';

jest.mock('../../blue_modules/BlueElectrum', () => ({}));

// Public BIP84 test vector; never replace with a user's recovery phrase.
const publicMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const prepare = process.env.XBT_KNOTS_PREPARE === '1';
const fixturePath = process.env.XBT_KNOTS_FIXTURE;
const resultPath = process.env.XBT_KNOTS_RESULT;
const bridgeTest = prepare || fixturePath ? it : it.skip;

type FundingFixture = {
  chain: string;
  blake2bHeight: number;
  height: number;
  fundingTransactions: { rawTx: string; confirmations: number }[];
};

describe('XBT Knots acceptance bridge', () => {
  bridgeTest('exports a public address plan or signs actual isolated regtest funding', () => {
    if (!resultPath || !path.isAbsolute(resultPath)) throw new Error('XBT_KNOTS_RESULT must be an explicit absolute path');
    if (prepare && fixturePath) throw new Error('Choose prepare or fixture signing, not both');
    if (fixturePath && path.resolve(fixturePath) === path.resolve(resultPath)) {
      throw new Error('Fixture and result paths must differ');
    }

    const wallet = new XbtSegwitBech32Wallet();
    wallet.setSecret(publicMnemonic);
    const addressDetails = (address: string) => {
      const script = Buffer.from(bitcoin.address.toOutputScript(address));
      return {
        address,
        regtestAddress: bitcoin.address.fromOutputScript(script, bitcoin.networks.regtest),
        scriptHex: script.toString('hex'),
      };
    };
    const sources = [60_000, 40_000].map((value, index) => ({
      index,
      value,
      ...addressDetails(wallet._getExternalAddressByIndex(index)),
    }));
    const destination = {
      value: 90_000,
      ...addressDetails(wallet._getExternalAddressByIndex(2)),
    };
    const change = addressDetails(wallet._getInternalAddressByIndex(0));
    const plan = {
      schemaVersion: 1,
      purpose: 'Public BIP84 fixture on network-isolated regtest only',
      derivationPath: XbtSegwitBech32Wallet.derivationPath,
      sources,
      destination,
      change,
      feeRateSatPerVbyte: 1,
    };
    const writeResult = (result: object) => {
      fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n', {
        mode: 0o600,
      });
    };
    if (prepare) {
      writeResult({ mode: 'prepare', ...plan });
      return;
    }

    const fixture = JSON.parse(fs.readFileSync(fixturePath!, 'utf8')) as FundingFixture;
    expect(fixture.chain).toBe('regtest');
    expect(Number.isSafeInteger(fixture.blake2bHeight)).toBe(true);
    expect(fixture.blake2bHeight).toBeGreaterThan(0);
    expect(Number.isSafeInteger(fixture.height)).toBe(true);
    expect(fixture.height).toBeGreaterThanOrEqual(fixture.blake2bHeight);
    expect(Array.isArray(fixture.fundingTransactions)).toBe(true);
    expect(fixture.fundingTransactions.length).toBeGreaterThan(0);

    const parents = fixture.fundingTransactions.map(funding => {
      expect(Number.isSafeInteger(funding.confirmations)).toBe(true);
      expect(funding.confirmations).toBeGreaterThan(0);
      const transaction = bitcoin.Transaction.fromHex(funding.rawTx);
      // RedWallet's conservative coinbase policy stays untouched; fund ordinary outputs.
      expect(transaction.isCoinbase()).toBe(false);
      return {
        transaction,
        txid: transaction.getId(),
        confirmations: funding.confirmations,
        inputs: transaction.ins.map(input => ({
          txid: Buffer.from(input.hash).reverse().toString('hex'),
          vout: input.index,
        })),
      };
    });
    expect(new Set(parents.map(parent => parent.txid)).size).toBe(parents.length);
    const utxos = sources.map(source => {
      const matches = parents.flatMap(parent =>
        parent.transaction.outs.flatMap((output, vout) =>
          output.value === BigInt(source.value) && Buffer.from(output.script).toString('hex') === source.scriptHex
            ? [
                {
                  txid: parent.txid,
                  vout,
                  value: source.value,
                  address: source.address,
                  confirmations: parent.confirmations,
                },
              ]
            : [],
        ),
      );
      expect(matches).toHaveLength(1);
      return matches[0];
    });
    const parentSpy = jest.spyOn(wallet, 'getTransactions').mockReturnValue(
      parents.map(({ txid, confirmations, inputs }) => ({
        txid,
        confirmations,
        inputs,
      })) as any,
    );
    try {
      const result = wallet.createTransaction(
        utxos,
        [{ address: destination.address, value: destination.value }],
        plan.feeRateSatPerVbyte,
        change.address,
      );
      expect(result.tx).toBeDefined();
      const transaction = bitcoin.Transaction.fromHex(result.tx!.toHex());
      expect(transaction.ins).toHaveLength(2);
      expect(result.inputs).toHaveLength(2);
      for (const input of transaction.ins) {
        expect(input.witness).toHaveLength(2);
        expect(input.witness[0][input.witness[0].length - 1]).toBe(0x21);
        expect(input.witness[1]).toHaveLength(33);
      }
      const expectedInputs = utxos.map(utxo => utxo.txid + ':' + utxo.vout).sort();
      expect(transaction.ins.map(input => Buffer.from(input.hash).reverse().toString('hex') + ':' + input.index).sort()).toEqual(
        expectedInputs,
      );
      const outputs = transaction.outs.map((output, vout) => ({
        vout,
        value: Number(output.value),
        scriptHex: Buffer.from(output.script).toString('hex'),
      }));
      expect(outputs).toHaveLength(2);
      expect(outputs.filter(output => output.scriptHex === destination.scriptHex && output.value === destination.value)).toHaveLength(1);
      expect(outputs.filter(output => output.scriptHex === change.scriptHex)).toHaveLength(1);
      const fee = sources.reduce((sum, source) => sum + source.value, 0) - outputs.reduce((sum, output) => sum + output.value, 0);
      expect(fee).toBe(result.fee);
      expect(fee).toBeGreaterThan(0);
      expect(fee).toBeLessThan(1000);
      expect(bitcoin.Psbt.fromBase64(result.psbt.toBase64()).extractTransaction().toHex()).toBe(transaction.toHex());

      const outputMutation = bitcoin.Transaction.fromHex(transaction.toHex());
      outputMutation.outs[0].value -= 1n;
      const sighashMutation = bitcoin.Transaction.fromHex(transaction.toHex());
      const signature = sighashMutation.ins[0].witness[0];
      signature[signature.length - 1] = 0x01;
      writeResult({
        mode: 'signed',
        ...plan,
        chain: fixture.chain,
        blake2bHeight: fixture.blake2bHeight,
        fixtureHeight: fixture.height,
        inputs: utxos,
        expectedTxid: transaction.getId(),
        expectedOutputs: outputs,
        feeSats: fee,
        virtualSize: transaction.virtualSize(),
        goodHex: transaction.toHex(),
        finalizedPsbt: result.psbt.toBase64(),
        negativeControls: {
          changedOutputHex: outputMutation.toHex(),
          removedUnifiedBitHex: sighashMutation.toHex(),
        },
      });
    } finally {
      parentSpy.mockRestore();
    }
  });
});
