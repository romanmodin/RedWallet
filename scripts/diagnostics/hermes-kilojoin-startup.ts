/** Standalone Hermes VM check. Public synthetic fixtures only; no network,
 * wallet storage, spending signer, broadcasts, or production-global patches.
 * Bundle with the app's buffer/text-encoding packages before executing.
 */
import { conversationKey, decrypt, encrypt, NostrEvent } from '../../class/xbt/kilojoin/crypto';
import { MessageInbox } from '../../class/xbt/kilojoin/messages';
import { ParticipantSession } from '../../class/xbt/kilojoin/session';
import { Round } from '../../class/xbt/kilojoin/round';
import { Terms } from '../../class/xbt/kilojoin/protocol';
import { parseSeat } from '../../class/xbt/kilojoin/roster';
import { Coin, coinScript, outpoint } from '../../class/xbt/kilojoin/transaction';
import * as tx from '../../class/xbt/kilojoin/transaction';
import * as blind from '../../class/xbt/kilojoin/blind-rsa';
import ecc from '../../blue_modules/noble_ecc';
import messages from '../../tests/unit/fixtures/kilojoin-kotlin-messages.json';
import sessions from '../../tests/unit/fixtures/kilojoin-kotlin-session.json';
import signatures from '../../tests/unit/fixtures/kilojoin-kotlin-signatures.json';
import rsa from '../../tests/unit/fixtures/kilojoin-rfc9474.json';

declare function print(text: string): void;
const results: { name: string; ok: boolean; error?: string; phase?: string; participants?: number }[] = [];
const secret = (n: number) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
function check(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}
function test(name: string, action: () => void) {
  try {
    action();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error instanceof Error ? error.message : 'Unknown failure' });
  }
}

const bufferProbe = Buffer.from('welcome').subarray(0);
const runtime = {
  hermes: typeof (globalThis as { HermesInternal?: unknown }).HermesInternal !== 'undefined',
  subarrayIsBuffer: Buffer.isBuffer(bufferProbe),
  subarrayString: bufferProbe.toString(),
};
for (const v of messages.encryption) {
  test('kotlin-nip44-' + v.length, () => {
    const key = conversationKey(secret(3), messages.creator);
    check(decrypt(v.ciphertext, key) === v.plaintext, 'Kotlin plaintext mismatch');
    check(encrypt(v.plaintext, key, Buffer.from(v.nonce, 'hex')) === v.ciphertext, 'Kotlin ciphertext mismatch');
  });
}
test('actual-kotlin-inbox-and-replay', () => {
  const inbox = new MessageInbox(messages.creator, messages.pool, secret(3), 10000);
  try {
    messages.messages.forEach((v, i) => {
      check(JSON.stringify(inbox.receive(v.event, 10000).body) === JSON.stringify(v.body), 'Kotlin envelope mismatch');
      if (i === 0) inbox.installPoolSecret(secret(2));
    });
    let rejected = false;
    try {
      inbox.receive(messages.messages[1].event, 10000);
    } catch (e) {
      rejected = e instanceof Error && e.message === 'Replayed message';
    }
    check(rejected, 'Replay accepted');
  } finally {
    inbox.close();
  }
});
test('multibyte-utf8', () => {
  const text = 'Welcome — café 🚀';
  const key = Buffer.alloc(32, 13);
  check(decrypt(encrypt(text, key, Buffer.alloc(32, 14)), key) === text, 'UTF8 mismatch');
});
test('tampered-mac-rejected', () => {
  const v = messages.encryption[0];
  const bytes = Buffer.from(v.ciphertext, 'base64');
  bytes[40] ^= 1;
  let rejected = false;
  try {
    decrypt(bytes.toString('base64'), Buffer.from(v.key, 'hex'));
  } catch (e) {
    rejected = e instanceof Error && e.message === 'Invalid NIP44 MAC';
  }
  check(rejected, 'Bad MAC accepted');
});

test('rfc9474-blind-unblind-and-tamper', () => {
  const h = (s: string) => Buffer.from(s, 'hex');
  const pk = blind.publicKey(rsa.N + ':10001');
  const prepared = h(rsa.PREPARED_MSG);
  const inverse = BigInt('0x' + rsa.INV);
  check(blind.pssEncode(prepared, pk.bits - 1, h(rsa.SALT)).toString('hex') === rsa.ENCODED_MSG, 'RSA encoding mismatch');
  const result = blind.blind(
    pk,
    prepared,
    () => {
      throw new Error('Unexpected entropy');
    },
    { salt: h(rsa.SALT), r: blind.inverse(inverse, pk.n) },
  );
  check(result.blinded.toString('hex') === rsa.BLINDED_MSG && result.inv === inverse, 'Blinding mismatch');
  check(blind.finalize(pk, prepared, h(rsa.BLIND_SIG), inverse).toString('hex') === rsa.SIG, 'Unblinding mismatch');
  const bad = h(rsa.SIG);
  bad[100] = (bad[100] + 1) % 256;
  check(!blind.verify(pk, prepared, bad), 'Bad RSA signature accepted');
});
for (const v of signatures) {
  test('kotlin-signed-transaction-' + v.type, () => {
    const type = v.type as Coin['type'];
    const output = (n: number) => (type === 'p2wpkh' ? '0014' + n.toString(16).repeat(40) : '5120' + n.toString(16).repeat(64));
    const coins: Coin[] = [1, 2].map(n => ({
      txid: n.toString(16).repeat(64),
      vout: 0,
      value: 50000,
      type,
      pubkey: Buffer.from(ecc.pointFromScalar(secret(n), true)!).toString('hex'),
    }));
    const value = type === 'p2wpkh' ? 39729 : 39702;
    const plan = tx.plan(
      coins,
      [output(5), output(6)],
      [
        { script: output(3), value },
        { script: output(4), value },
      ],
      10000,
    );
    check(tx.transaction(plan).getId() === v.txid, 'Transaction ID mismatch');
    v.signatures.forEach((signature, i) => check(tx.verifySignature(plan, i, signature), 'Kotlin signature mismatch'));
    check(!!tx.assemble(plan, new Map(coins.map((c, i) => [outpoint(c), v.signatures[i]]))), 'Assembly failed');
    check(!tx.verifySignature(plan, 0, v.signatures[0].slice(0, -2) + '01'), 'Wrong sighash accepted');
  });
}

async function startup() {
  for (const v of sessions) {
    const terms = v.terms as Terms;
    const name = 'kotlin-session-' + terms.script + '-' + v.mixes.length + '-' + terms.max_peers;
    let session: ParticipantSession | undefined;
    try {
      const seat = parseSeat(v.rawSeat, terms);
      const now = v.startedAt + 2;
      const round = await Round.join('synthetic', terms.id, seat.coins.map(outpoint), now + 7200, now, { save: async () => {} });
      session = new ParticipantSession(terms, seat, secret(7), v.mixes, 10000, round, {
        now: () => now,
        random: length => new Uint8Array(length).fill(37),
        saveEncrypted: async () => {},
        walletOutpoints: () => new Set(seat.coins.map(outpoint)),
        observe: async (coins: Coin[]) =>
          new Map(coins.map(c => [outpoint(c), { value: c.value, script: coinScript(c).toString('hex'), unspent: true, checkedAt: now }])),
        publish: async () => {
          throw new Error('Offline startup must not publish');
        },
      });
      await session.receive(v.events[0] as NostrEvent);
      check(session.snapshot().phase === 'open', 'Welcome did not open session');
      for (const event of v.events.slice(1).reverse()) await session.receive(event as NostrEvent);
      check(session.snapshot().phase === 'voting', 'Roster did not reach voting');
      check(session.snapshot().seats.length === terms.max_peers, 'Missing peers');
      check(Object.keys(session.snapshot().signatures).length === 0, 'Unexpected signature');
      results.push({ name, ok: true, phase: session.snapshot().phase, participants: session.snapshot().seats.length });
    } catch (error) {
      results.push({
        name,
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown failure',
        phase: session?.snapshot().phase,
        participants: session?.snapshot().seats.length,
      });
    }
  }
  print(JSON.stringify({ runtime, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results }));
}
startup().catch(error => {
  print(JSON.stringify({ runtime, fatal: String(error) }));
});
