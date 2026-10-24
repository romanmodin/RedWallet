/** Offline native startup qualification. All keys/coins are PUBLIC synthetic
 * fixture constants. No wallet backend, network, spending signer or broadcaster.
 * Actual Kilowallet PoolSession envelopes: 233733def7e492084f4d57e5faa1d76b9ab2ce79.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Keychain from 'react-native-keychain';
import ecc from '../../../blue_modules/noble_ecc';
import vectors from './startup-self-test-vectors.json';
import { NostrEvent, utf8Hash } from './crypto';
import { Terms } from './protocol';
import { parseSeat } from './roster';
import { Round } from './round';
import { ParticipantSession } from './session';
import { Coin, coinScript, outpoint } from './transaction';
import { SessionVault } from './vault';
import { nativeEntropy } from './wallet-adapter';

export async function runKilojoinStartupSelfTest(): Promise<void> {
  for (const v of vectors) {
    for (const reverse of [false, true]) {
      const terms = v.terms as Terms;
      // Fixed fixture time deliberately isolates this OFFLINE check from expiry.
      const now = v.startedAt + 2;
      const own = parseSeat(v.rawSeat, terms);
      const attempt = Buffer.from(nativeEntropy(32)).toString('hex');
      const walletId = 'kilojoin-native-startup-selftest';
      const service = 'redwallet.kilojoin.v1.' + utf8Hash(JSON.stringify([walletId, terms.id, attempt])).toString('hex');
      const vault = new SessionVault(walletId, terms.id, attempt);
      const round = await Round.join(walletId, terms.id, own.coins.map(outpoint), now + 7200, now, { save: async () => {} }, attempt);
      // Independent known synthetic coins from KilowalletSessionHarness.kt setup.
      // Do not create successful observations by echoing arbitrary incoming coins.
      const peers: Coin[] = [4, 100, 101, 102].map((key, i) => ({
        txid: i === 0 ? '44'.repeat(32) : String(i + 4).repeat(64),
        vout: 0,
        value: 20000000,
        type: terms.script,
        pubkey: Buffer.from(ecc.pointFromScalar(Buffer.from(key.toString(16).padStart(64, '0'), 'hex'), true)!).toString('hex'),
      }));
      const chain = new Map(
        [...own.coins, ...peers].map(c => [
          outpoint(c),
          {
            value: c.value,
            script: coinScript(c).toString('hex'),
            unspent: true,
            checkedAt: now,
          },
        ]),
      );
      let saved = 0,
        observations = 0;
      const session = new ParticipantSession(terms, own, Buffer.from('07'.padStart(64, '0'), 'hex'), v.mixes, 10000, round, {
        now: () => now,
        random: nativeEntropy,
        saveEncrypted: async state => {
          saved++;
          await vault.save(state);
        },
        observe: async () => {
          observations++;
          return chain;
        },
        walletOutpoints: () => new Set(own.coins.map(outpoint)),
        publish: async () => {
          throw new Error('Offline startup attempted publication');
        },
      });
      try {
        await vault.save(session.snapshot());
        await session.receive(v.events[0] as NostrEvent);
        if (session.snapshot().phase !== 'open') throw new Error('Native welcome failed');
        const events = v.events.slice(1);
        if (reverse) events.reverse();
        for (const e of events) await session.receive(e as NostrEvent);
        const state = session.snapshot();
        const persisted = (await vault.load()) as {
          phase?: string;
          seats?: unknown[];
        } | null;
        if (
          state.phase !== 'voting' ||
          state.seats.length !== 5 ||
          persisted?.phase !== 'voting' ||
          persisted.seats?.length !== 5 ||
          round.snapshot().phase !== 'joined' ||
          round.snapshot().reserved.length !== 1 ||
          Object.keys(state.signatures).length !== 0
        )
          throw new Error('Native pool startup verification failed');
        const beforeReplay = JSON.stringify({ state, journal: round.snapshot(), saved, observations });
        // Replay is a no-op, not a protocol failure. Check the full state and
        // reservation journal, plus absence of fresh storage/chain work.
        for (const event of v.events) await session.receive(event as NostrEvent);
        if (beforeReplay !== JSON.stringify({ state: session.snapshot(), journal: round.snapshot(), saved, observations }))
          throw new Error('Native startup replay guard failed');
        if (JSON.stringify(await vault.load()) !== JSON.stringify(persisted)) throw new Error('Native replay changed persisted state');
      } finally {
        await AsyncStorage.removeItem(service);
        await Keychain.resetGenericPassword({ service });
      }
    }
  }
}
