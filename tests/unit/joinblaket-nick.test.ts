import ecc from "../../blue_modules/noble_ecc";
import {
  NickIdentity,
  checkDirectoryReply,
  handshakeLine,
  handshakeSha256,
  isValidNick,
  nickAuthSignedMessage,
  nickFromPubkey,
  nickVersion,
  parseChallenge,
  proofLine,
  resultOk,
  verifyPrivmsg,
  verifyProof,
} from "../../class/joinblaket/nick";
import {
  decodeBase64,
  der,
  messageHash,
  parseStrictDer,
  signMessage,
  verifyHash,
  verifyMessage,
} from "../../class/joinblaket/message-signatures";
import {
  HANDSHAKE,
  NICK_AUTH_CHALLENGE,
  ONION_HOSTID,
  envelope,
  parse,
} from "../../class/joinblaket/wire";
import vectors from "../fixtures/joinblaket/xbt-taker-vectors.json";

const n = vectors.nick;
const h = vectors.handshake;
const priv = Buffer.from(n.private_key, "hex");
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const hex32 = (v: bigint): Buffer =>
  Buffer.from(v.toString(16).padStart(64, "0"), "hex");

describe("JoinBlaket nick derivation and message signatures", () => {
  it("derives the pinned nick from the pinned key", () => {
    const id = new NickIdentity(priv);
    expect(id.pubkeyHex).toBe(n.pubkey);
    expect(id.nick).toBe(n.nick);
    expect(nickFromPubkey(n.pubkey)).toBe(n.nick_from_pubkey);
    expect(nickFromPubkey(n.pubkey.toUpperCase())).toBe(n.nick);
    expect(isValidNick(n.nick) && isValidNick(n.maker_nick)).toBe(true);
    expect(isValidNick("J5" + "O".repeat(13))).toBe(false);
    expect(isValidNick(n.nick + "x")).toBe(false);
    expect(nickVersion(n.nick)).toBe(5);
    expect(nickVersion("x")).toBe(5);
    expect(() => nickFromPubkey("02" + "z".repeat(64))).toThrow();
    id.destroy();
  });

  it("reproduces the pinned message hash, signature and privmsg bytes", () => {
    const msg = n.signed_data + n.hostid;
    expect(messageHash(msg).toString("hex")).toBe(n.message_hash);
    expect(signMessage(priv, msg)).toBe(n.signature_b64);
    const id = new NickIdentity(priv);
    expect(id.signData(n.signed_data)).toBe(n.signed_suffix);
    expect(id.signPrivmsg("fill", n.signed_data)).toBe(
      "fill " + n.signed_suffix,
    );
    expect(
      `${id.nick}!${n.maker_nick}!${id.signPrivmsg("fill", n.signed_data)}`,
    ).toBe(n.privmsg_line);
    id.destroy();
  });

  it("verifies the pinned privmsg and rejects the wrong nick, tampered data and a different command signature target", () => {
    const rest = n.privmsg_line.split("!").slice(2).join("!");
    expect(verifyPrivmsg(n.nick, rest)).toEqual(n.verify_signed_privmsg);
    expect(verifyPrivmsg(n.maker_nick, rest).ok).toBe(false);
    expect(verifyPrivmsg(n.nick, rest.replace("30000000", "30000001")).ok).toBe(
      false,
    );
    expect(verifyPrivmsg(n.nick, rest, "other-network").ok).toBe(false);
    expect(verifyPrivmsg("not-a-nick", rest).ok).toBe(false);
    expect(verifyPrivmsg(n.nick, "fill only").ok).toBe(false);
    // The command is not signed: swapping it keeps `ok`, so callers must never authorize on the command alone.
    const swapped = verifyPrivmsg(n.nick, rest.replace(/^fill/, "push"));
    expect(swapped.ok).toBe(true);
    expect(swapped.command).toBe("push");
  });

  it("verifies the pinned session privmsgs from both sides", () => {
    for (const side of [vectors.session.fill, vectors.session.pubkey]) {
      const line = JSON.parse(side.frame).line as string;
      const [from, , ...rest] = line.split("!");
      expect(verifyPrivmsg(from, rest.join("!")).ok).toBe(true);
    }
  });

  it("handles non-ASCII data as UTF-8 and rejects lone surrogates", () => {
    const id = new NickIdentity(priv);
    const rest = id.signPrivmsg("msg", "h\u00e9llo \ud83d\ude00");
    expect(verifyPrivmsg(id.nick, rest)).toMatchObject({
      ok: true,
      data: "h\u00e9llo \ud83d\ude00",
    });
    expect(
      verifyMessage(
        "h\u00e9llo" + ONION_HOSTID,
        rest.split(" ").pop() as string,
        Buffer.from(id.pubkeyHex, "hex"),
      ),
    ).toBe(false);
    expect(() => id.signData("bad \ud800")).toThrow();
    expect(() => messageHash("\udc00")).toThrow();
    expect(() => id.signPrivmsg("msg", "a\nb")).toThrow();
    expect(() => id.signPrivmsg("bad command", "a")).toThrow();
    id.destroy();
  });

  it("rejects malformed, high-S and non-canonical signatures", () => {
    const good = decodeBase64(n.signature_b64) as Buffer;
    const parsed = parseStrictDer(good);
    expect(parsed).not.toBeNull();
    const pub = Buffer.from(n.pubkey, "hex");
    const hash = messageHash(n.signed_data + n.hostid);
    expect(verifyHash(hash, good, pub)).toBe(true);
    const r = parsed!.r;
    const s = BigInt("0x" + parsed!.s.toString("hex"));
    const high = der(r, hex32(N - s));
    expect(parseStrictDer(high)).toBeNull();
    expect(verifyHash(hash, high, pub)).toBe(false);
    expect(ecc.verify(hash, pub, Buffer.concat([r, hex32(N - s)]), false)).toBe(
      true,
    ); // valid math, rejected by policy
    expect(parseStrictDer(der(hex32(0n), hex32(1n)))).toBeNull();
    expect(parseStrictDer(der(hex32(N), hex32(1n)))).toBeNull();
    expect(parseStrictDer(der(hex32(1n), hex32(0n)))).toBeNull();
    const bad: Buffer[] = [
      Buffer.concat([good, Buffer.from([0])]), // trailing byte
      Buffer.concat([Buffer.from([0x31]), good.subarray(1)]), // wrong tag
      Buffer.concat([
        good.subarray(0, 1),
        Buffer.from([good[1] - 1]),
        good.subarray(2, good.length - 1),
      ]), // bad length
      Buffer.from("3006020100020100", "hex"), // zero r and s
      Buffer.from("3008020200010201" + "01", "hex"), // non-minimal r
      Buffer.from("300602018002" + "0101", "hex"), // negative r
      Buffer.alloc(73, 1),
      Buffer.alloc(0),
    ];
    for (const sig of bad) {
      expect(parseStrictDer(sig)).toBeNull();
      expect(verifyHash(hash, sig, pub)).toBe(false);
    }
    for (const text of [
      "",
      " " + n.signature_b64,
      n.signature_b64 + "\n",
      n.signature_b64.slice(0, -2),
      "!!!!",
      "A".repeat(5000),
    ])
      expect(verifyMessage(n.signed_data + n.hostid, text, pub)).toBe(false);
    expect(
      verifyMessage(
        n.signed_data + n.hostid,
        n.signature_b64.replace(/=$/, ""),
        pub,
      ),
    ).toBe(true); // padding optional
    expect(
      verifyMessage(
        n.signed_data + n.hostid,
        n.signature_b64,
        Buffer.alloc(33, 4),
      ),
    ).toBe(false);
    expect(
      verifyMessage(
        n.signed_data + n.hostid,
        n.signature_b64,
        Buffer.concat([Buffer.from([4]), pub.subarray(1)]),
      ),
    ).toBe(false);
  });

  it("rejects invalid identity keys", () => {
    expect(() => new NickIdentity(Buffer.alloc(32))).toThrow();
    expect(() => new NickIdentity(hex32(N))).toThrow();
    expect(() => new NickIdentity(Buffer.alloc(31, 1))).toThrow();
  });
});

describe("JoinBlaket directory handshake and nick authentication", () => {
  const id = (): NickIdentity => new NickIdentity(priv);

  it("reproduces the pinned handshake bytes and hash", () => {
    expect(handshakeLine(n.nick)).toBe(h.handshake_line);
    expect(envelope(HANDSHAKE, handshakeLine(n.nick))).toBe(
      h.handshake_envelope,
    );
    expect(handshakeSha256(h.handshake_line)).toBe(h.handshake_line_sha256);
    expect(handshakeLine(n.nick, "xbt", false, false)).toContain(
      '"features": {"peerlist_features": true, "ping": true}',
    );
    expect(() => handshakeLine("bad")).toThrow();
    expect(() => handshakeLine(n.nick, 'x"y')).toThrow();
  });

  it("accepts the pinned directory reply and rejects wrong network, version, rejection and missing nick auth", () => {
    const ok = parse(h.directory_reply_dn_handshake);
    expect(checkDirectoryReply(ok)).toBeNull();
    const line = (patch: Record<string, unknown>) => ({
      type: 795,
      line: JSON.stringify({ ...JSON.parse(ok.line), ...patch }),
    });
    expect(checkDirectoryReply(line({ network: "testnet" }))).toBe(
      "directory network mismatch",
    );
    expect(checkDirectoryReply(line({ accepted: false }))).toBe(
      "handshake rejected",
    );
    expect(checkDirectoryReply(line({ accepted: "true" }))).toBe(
      "handshake rejected",
    );
    expect(
      checkDirectoryReply(line({ "proto-ver-min": 6, "proto-ver-max": 7 })),
    ).toBe("no compatible protocol version");
    expect(
      checkDirectoryReply(line({ "proto-ver-min": "5", "proto-ver-max": 5 })),
    ).toBe("no compatible protocol version");
    expect(
      checkDirectoryReply(line({ features: { nick_auth: "true" } })),
    ).toMatch(/nick authentication/);
    expect(
      checkDirectoryReply(line({ features: {} }), "xbt", false),
    ).toBeNull();
    expect(checkDirectoryReply({ type: 803, line: ok.line })).toBe(
      "unexpected response type 803",
    );
    expect(checkDirectoryReply({ type: 795, line: "nope" })).toBe(
      "handshake reply is not JSON",
    );
    expect(
      checkDirectoryReply({
        type: 795,
        line: '{"accepted": false, "accepted": true}',
      }),
    ).toBe("handshake reply is not JSON");
  });

  it("parses the pinned challenge and rejects malformed ones", () => {
    const frame = parse(h.directory_reply_challenge);
    expect(frame.type).toBe(NICK_AUTH_CHALLENGE);
    expect(parseChallenge(frame.line)).toEqual({
      challenge: h.challenge,
      directoryId: h.directory_id,
    });
    const c = h.challenge;
    for (const bad of [
      "{}",
      "[]",
      "x",
      JSON.stringify({ challenge: c }),
      JSON.stringify({
        challenge: c,
        "directory-id": h.directory_id,
        extra: 1,
      }),
      JSON.stringify({
        challenge: c.toUpperCase(),
        "directory-id": h.directory_id,
      }),
      JSON.stringify({ challenge: c.slice(2), "directory-id": h.directory_id }),
      JSON.stringify({ challenge: c, "directory-id": "" }),
      JSON.stringify({ challenge: c, "directory-id": "a|b" }),
      JSON.stringify({ challenge: c, "directory-id": "a b" }),
      JSON.stringify({ challenge: c, "directory-id": 5 }),
      `{"challenge":"${c}","challenge":"${c}","directory-id":"x"}`,
    ])
      expect(() => parseChallenge(bad)).toThrow();
  });

  it("builds the pinned transcript and the exact proof bytes", () => {
    const identity = id();
    const challenge = parseChallenge(parse(h.directory_reply_challenge).line);
    const msg = nickAuthSignedMessage(
      challenge.challenge,
      challenge.directoryId,
      h.handshake_line_sha256,
      n.nick,
      n.pubkey,
    );
    expect(msg.toString("hex")).toBe(h.nick_auth_signed_message_hex);
    expect(messageHash(msg).toString("hex")).toBe(h.nick_auth_message_hash);
    const proof = proofLine(
      identity,
      challenge,
      h.handshake_line,
      h.directory_id,
    );
    expect(JSON.parse(proof)).toEqual(h.nick_auth_proof);
    expect(envelope(805, proof)).toBe(h.nick_auth_proof_envelope);
    expect(
      verifyProof(proof, challenge, h.directory_id, h.handshake_line, n.nick),
    ).toBe(true);
    identity.destroy();
  });

  it("rejects a wrong directory, challenge, nick or handshake", () => {
    const identity = id();
    const challenge = parseChallenge(parse(h.directory_reply_challenge).line);
    expect(() =>
      proofLine(identity, challenge, h.handshake_line, "other.onion:5222"),
    ).toThrow("directory id mismatch");
    expect(() =>
      proofLine(
        identity,
        { ...challenge, directoryId: "evil.onion:1" },
        h.handshake_line,
        h.directory_id,
      ),
    ).toThrow();
    expect(() =>
      proofLine(
        identity,
        challenge,
        handshakeLine(vectors.nick.maker_nick),
        h.directory_id,
      ),
    ).toThrow("handshake nick mismatch");
    expect(() =>
      proofLine(identity, challenge, "not json", h.directory_id),
    ).toThrow();
    expect(() =>
      proofLine(
        identity,
        { ...challenge, challenge: "zz" },
        h.handshake_line,
        h.directory_id,
      ),
    ).toThrow();
    const proof = proofLine(
      identity,
      challenge,
      h.handshake_line,
      h.directory_id,
    );
    expect(
      verifyProof(
        proof,
        challenge,
        "other.onion:5222",
        h.handshake_line,
        n.nick,
      ),
    ).toBe(false);
    expect(
      verifyProof(
        proof,
        { ...challenge, challenge: "0".repeat(64) },
        h.directory_id,
        h.handshake_line,
        n.nick,
      ),
    ).toBe(false);
    expect(
      verifyProof(
        proof,
        challenge,
        h.directory_id,
        h.handshake_line,
        n.maker_nick,
      ),
    ).toBe(false);
    expect(
      verifyProof(
        proof,
        challenge,
        h.directory_id,
        h.handshake_line + " ",
        n.nick,
      ),
    ).toBe(false);
    expect(
      verifyProof("{}", challenge, h.directory_id, h.handshake_line, n.nick),
    ).toBe(false);
    identity.destroy();
  });

  it("does not let a privmsg signature authorize a nick-auth proof or vice versa", () => {
    const identity = id();
    const challenge = parseChallenge(parse(h.directory_reply_challenge).line);
    const msg = nickAuthSignedMessage(
      challenge.challenge,
      challenge.directoryId,
      h.handshake_line_sha256,
      n.nick,
      n.pubkey,
    ).toString("latin1");
    // A directory asking for a "privmsg" over the transcript text gets a signature over text + hostid, never over the transcript.
    const privmsgSig = identity.signData(msg).split(" ").pop() as string;
    const proof = JSON.stringify({ pubkey: n.pubkey, signature: privmsgSig });
    expect(
      verifyProof(proof, challenge, h.directory_id, h.handshake_line, n.nick),
    ).toBe(false);
    // And the proof signature is not a valid privmsg signature for any data.
    const rest = `fill x ${n.pubkey} ${h.nick_auth_proof.signature}`;
    expect(verifyPrivmsg(n.nick, rest).ok).toBe(false);
    identity.destroy();
  });

  it("accepts only the exact ok result", () => {
    expect(resultOk(parse(h.directory_reply_result).line)).toBe(true);
    for (const bad of [
      '{"code":"ok","verified":"true"}',
      '{"code":"ok","verified":false}',
      '{"code":"no","verified":true}',
      "{}",
      "x",
      "[]",
    ])
      expect(resultOk(bad)).toBe(false);
  });
});

describe("NickIdentity lifecycle", () => {
  it("generates distinct fresh identities", async () => {
    const a = await NickIdentity.random();
    const b = await NickIdentity.random();
    expect(a.nick).not.toBe(b.nick);
    expect(isValidNick(a.nick)).toBe(true);
    expect(verifyPrivmsg(a.nick, a.signPrivmsg("ping", "x")).ok).toBe(true);
    a.destroy();
    b.destroy();
  });

  it("wipes its own key copy, leaves the caller buffer alone and fails closed after destroy", () => {
    const input = Uint8Array.from(priv);
    const identity = new NickIdentity(input);
    const key = (identity as any).key as Uint8Array;
    expect(key).not.toBe(input);
    identity.destroy();
    expect(Buffer.from(key).equals(Buffer.alloc(32))).toBe(true);
    expect(Buffer.from(input).equals(priv)).toBe(true);
    expect(identity.destroyed).toBe(true);
    expect(() => identity.signData("x")).toThrow("destroyed");
    expect(() => identity.signPrivmsg("fill", "x")).toThrow("destroyed");
    expect(() => identity.signBytesFor(Buffer.alloc(1))).toThrow("destroyed");
    expect(() =>
      proofLine(
        identity,
        parseChallenge(parse(h.directory_reply_challenge).line),
        h.handshake_line,
        h.directory_id,
      ),
    ).toThrow("destroyed");
    expect(() => identity.destroy()).not.toThrow();
    expect(identity.pubkeyHex).toBe(n.pubkey); // public data stays readable
  });
});
