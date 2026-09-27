import { ECPairFactory } from 'ecpair';

import ecc from '../../blue_modules/noble_ecc';
import { finalizeUnifiedP2wpkhInput, signUnifiedP2wpkhInput } from '../xbt/unified-psbt';
import { AbstractHDElectrumWallet } from './abstract-hd-electrum-wallet';
import { HDSegwitBech32Wallet } from './hd-segwit-bech32-wallet';

const ECPair = ECPairFactory(ecc);

/** XBT BIP84 wallet; its transaction signatures use Knots Unified Sighash. */
export class XbtSegwitBech32Wallet extends HDSegwitBech32Wallet {
  static readonly type = 'HDsegwitBech32XBT';
  static readonly typeReadable = 'XBT SegWit (BIP84)';
  // @ts-ignore: override
  public readonly type = XbtSegwitBech32Wallet.type;
  // @ts-ignore: override
  public readonly typeReadable = XbtSegwitBech32Wallet.typeReadable;
  public readonly segwitType = 'p2wpkh';
  static readonly derivationPath = "m/84'/0'/0'";

  allowPayJoin() {
    return false;
  }

  allowCosignPsbt() {
    return false;
  }

  allowBIP47() {
    return false;
  }

  allowSilentPaymentSend() {
    return false;
  }

  createTransaction(...args: Parameters<AbstractHDElectrumWallet['createTransaction']>) {
    const [utxos, targets, feeRate, changeAddress, sequence, skipSigning, masterFingerprint] = args;
    const result = super.createTransaction(utxos, targets, feeRate, changeAddress, sequence, true, masterFingerprint);
    if (skipSigning) return result;

    result.inputs.forEach((input, inputIndex) => {
      if (!input.address) throw new Error('XBT signing input is missing its wallet address');
      const wif = this._getWifForAddress(input.address);
      if (!wif) throw new Error('XBT signing input is not controlled by this wallet');
      const keyPair = ECPair.fromWIF(wif);
      signUnifiedP2wpkhInput(result.psbt, inputIndex, {
        publicKey: keyPair.publicKey,
        sign: messageHash => keyPair.sign(Buffer.from(messageHash)),
      });
      finalizeUnifiedP2wpkhInput(result.psbt, inputIndex, keyPair.publicKey, (publicKey, messageHash, signature) =>
        ecc.verify(messageHash, publicKey, signature),
      );
    });

    result.tx = result.psbt.extractTransaction();
    return result;
  }
}
