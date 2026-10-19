/** XBT backend and spending-key adapters. Only the explicitly approved session calls the signer. */
import { address, crypto as bitcoinCrypto } from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import ecc from '../../../blue_modules/noble_ecc';
import * as BlueElectrum from '../../../blue_modules/BlueElectrum';
import { XbtSegwitBech32Wallet } from '../../wallets/xbt-segwit-bech32-wallet';
import { XbtTaprootWallet } from '../../wallets/xbt-taproot-wallet';
import { parseVerifiedParentTransaction } from '../verified-transaction';
import { isMatureXbtCoinbase } from '../coinbase-maturity';
import { ChainCoin } from './roster';
import { Coin, coinScript, digest, outpoint, Plan, transaction } from './transaction';
import { Round } from './round';
import { reservedCoins } from './wallet-store';
const ECPair = ECPairFactory(ecc);
export type MixingWallet = XbtSegwitBech32Wallet | XbtTaprootWallet;
export function nativeEntropy(length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 1 || length > 65536 || !globalThis.crypto?.getRandomValues)
    throw new Error('Native secure entropy unavailable');
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}
export async function observeCoins(coins: Coin[], now = () => Math.floor(Date.now() / 1000)): Promise<ReadonlyMap<string, ChainCoin>> {
  if (!coins.length || coins.length > 200 || new Set(coins.map(outpoint)).size !== coins.length)
    throw new Error('Invalid observation request');
  const addresses = [...new Set(coins.map(c => address.fromOutputScript(coinScript(c))))];
  const [raw, unspent, history, tip] = await Promise.all([
    BlueElectrum.multiGetTransactionByTxid(
      coins.map(c => c.txid),
      false,
      45,
      true,
    ),
    BlueElectrum.multiGetUtxoByAddress(addresses),
    BlueElectrum.multiGetHistoryByAddress(addresses),
    BlueElectrum.getReportedBlockTip(),
  ]);
  if (tip === null || !Number.isSafeInteger(tip) || tip < 1) throw new Error('Unverified chain tip');
  const checkedAt = now(),
    result = new Map<string, ChainCoin>();
  for (const c of coins) {
    const tx = parseVerifiedParentTransaction(c.txid, raw[c.txid]),
      script = coinScript(c);
    const a = address.fromOutputScript(script),
      output = tx.outs[c.vout];
    const matches = (unspent[a] || []).filter(u => u.txid === c.txid && u.vout === c.vout);
    const entries = (history[a] || []).filter(h => h.tx_hash === c.txid);
    if (
      !output ||
      output.value !== BigInt(c.value) ||
      Buffer.compare(Buffer.from(output.script), script) !== 0 ||
      matches.length !== 1 ||
      entries.length !== 1 ||
      matches[0].value !== c.value ||
      !Number.isSafeInteger(matches[0].height) ||
      matches[0].height <= 0 ||
      matches[0].height > tip ||
      entries[0].height !== matches[0].height
    )
      throw new Error('CoinJoin requires a verified confirmed unspent coin');
    if (tx.isCoinbase() && !isMatureXbtCoinbase(tip - matches[0].height + 1)) throw new Error('Immature CoinJoin coinbase');
    result.set(outpoint(c), { value: c.value, script: script.toString('hex'), unspent: true, checkedAt });
  }
  return result;
}
export function walletSigner(
  wallet: MixingWallet,
  round: Round,
  now = () => Math.floor(Date.now() / 1000),
): (p: Plan, mine: Coin[]) => Promise<Map<string, string>> {
  return async (p, mine) => {
    const journal = round.snapshot(),
      reservations = reservedCoins(wallet);
    if (
      !Number.isSafeInteger(now()) ||
      now() >= journal.deadline ||
      journal.walletId !== wallet.getID() ||
      journal.phase !== 'signed' ||
      journal.reviewedHex !== transaction(p).toHex() ||
      p.type !== wallet.segwitType ||
      JSON.stringify([...journal.reserved].sort()) !== JSON.stringify(mine.map(outpoint).sort()) ||
      mine.some(c => !reservations.has(outpoint(c)))
    )
      throw new Error('Missing durable signing approval');
    const signatures = new Map<string, string>();
    for (const coin of mine) {
      const index = p.coins.findIndex(c => outpoint(c) === outpoint(coin));
      if (index < 0 || p.coins[index].value !== coin.value || p.coins[index].pubkey !== coin.pubkey || p.coins[index].type !== coin.type)
        throw new Error('Signing coin changed');
      const a = address.fromOutputScript(coinScript(coin));
      if (!wallet.weOwnAddress(a)) throw new Error('CoinJoin input is not owned');
      const wif = wallet._getWifForAddress(a);
      if (!wif) throw new Error('CoinJoin spending key unavailable');
      const key = ECPair.fromWIF(wif);
      if (Buffer.from(key.publicKey).toString('hex') !== coin.pubkey) throw new Error('CoinJoin key mismatch');
      const signature =
        p.type === 'p2wpkh'
          ? ecc.signDER(digest(p, index), key.privateKey!)
          : key.tweak(bitcoinCrypto.taggedHash('TapTweak', key.publicKey.slice(1))).signSchnorr!(digest(p, index));
      signatures.set(outpoint(coin), Buffer.concat([signature, Buffer.from([0x21])]).toString('hex'));
    }
    return signatures;
  };
}
