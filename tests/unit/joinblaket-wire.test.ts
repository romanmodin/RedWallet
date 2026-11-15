import {
  DN_HANDSHAKE,
  GETPEERLIST,
  HANDSHAKE,
  MAX_FRAME_LENGTH,
  NICK_AUTH_CHALLENGE,
  NICK_AUTH_PROOF,
  NICK_AUTH_RESULT,
  ONION_HOSTID,
  PEERLIST,
  PING,
  PONG,
  PRIVMSG,
  PUBMSG,
  encodeFrame,
  envelope,
  isKnownType,
  parse,
  quote,
} from '../../class/joinblaket/wire';
import vectors from '../fixtures/joinblaket/xbt-taker-vectors.json';

const h = vectors.handshake;

describe('JoinBlaket wire framing', () => {
  it('has the upstream message constants and hostid', () => {
    expect([PRIVMSG, PUBMSG, PEERLIST, GETPEERLIST, HANDSHAKE, DN_HANDSHAKE, PING, PONG]).toEqual([685, 687, 789, 791, 793, 795, 798, 799]);
    expect([NICK_AUTH_CHALLENGE, NICK_AUTH_PROOF, NICK_AUTH_RESULT]).toEqual([803, 805, 807]);
    expect(ONION_HOSTID).toBe('onion-network');
    expect(vectors.nick.hostid).toBe(ONION_HOSTID);
    expect(isKnownType(793)).toBe(true);
    expect(isKnownType(1)).toBe(false);
  });

  it('reproduces the pinned handshake and orderbook bytes', () => {
    expect(envelope(HANDSHAKE, h.handshake_line)).toBe(h.handshake_envelope);
    expect(envelope(NICK_AUTH_PROOF, JSON.stringify(h.nick_auth_proof))).toBe(h.nick_auth_proof_envelope);
    expect(envelope(PUBMSG, h.nick + '!PUBLIC!orderbook')).toBe(h.orderbook_request_envelope);
    expect(encodeFrame(HANDSHAKE, h.handshake_line)).toBe(h.handshake_envelope + '\r\n');
  });

  it('parses the pinned directory replies', () => {
    for (const [text, type] of [
      [h.directory_reply_dn_handshake, DN_HANDSHAKE],
      [h.directory_reply_challenge, NICK_AUTH_CHALLENGE],
      [h.directory_reply_result, NICK_AUTH_RESULT],
      [h.handshake_envelope, HANDSHAKE],
    ] as const) {
      const frame = parse(text + '\r\n');
      expect(frame.type).toBe(type);
      expect(envelope(frame.type, frame.line)).toBe(text);
    }
    expect(JSON.parse(parse(h.directory_reply_challenge).line).challenge).toBe(h.challenge);
    expect(parse(h.orderbook_request_envelope)).toEqual({ type: PUBMSG, line: h.nick + '!PUBLIC!orderbook' });
    expect(parse(vectors.nick.privmsg_line ? envelope(PRIVMSG, vectors.nick.privmsg_line) : '').line).toBe(vectors.nick.privmsg_line);
  });

  it('accepts one \\r\\n, \\n, \\r or no terminator', () => {
    const text = '{"type": 798, "line": ""}';
    for (const end of ['', '\r\n', '\n', '\r']) expect(parse(text + end)).toEqual({ type: 798, line: '' });
  });
});

describe('JoinBlaket wire quoting (Python json.dumps ensure_ascii)', () => {
  it('quotes ASCII like Python', () => {
    expect(quote('plain ~ text')).toBe('"plain ~ text"');
    expect(quote('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(quote('\n\r\t\b\f')).toBe('"\\n\\r\\t\\b\\f"');
  });

  it('escapes other control characters and DEL as lowercase \\uXXXX', () => {
    expect(quote('\u0000\u0001\u001f\u007f')).toBe('"\\u0000\\u0001\\u001f\\u007f"');
    expect(quote('\u000b\u001b')).toBe('"\\u000b\\u001b"');
  });

  it('escapes non-ASCII, astral characters as surrogate pairs', () => {
    expect(quote('é')).toBe('"\\u00e9"');
    expect(quote('\u2028\u2029')).toBe('"\\u2028\\u2029"');
    expect(quote('\u{1F600}')).toBe('"\\ud83d\\ude00"');
    expect(quote('\uffff')).toBe('"\\uffff"');
  });

  it('rejects lone surrogates', () => {
    for (const bad of ['\ud800', '\udc00', 'a\ud83dz', '\ude00\ud83d']) expect(() => quote(bad)).toThrow('surrogate');
  });

  it('round-trips through JSON.parse', () => {
    const samples = ['', 'a"b\\c\n', '\u0000\u007f\u0080', 'é\u{1F600}\u2028', '{"nested": [1, "x"]}'];
    for (const s of samples) {
      expect(JSON.parse(quote(s))).toBe(s);
      expect(parse(envelope(PRIVMSG, s)).line).toBe(s);
    }
  });

  it('matches known Python json.dumps output for the envelope', () => {
    expect(envelope(685, 'é\u{1F600}\n')).toBe('{"type": 685, "line": "\\u00e9\\ud83d\\ude00\\n"}');
  });
});

describe('JoinBlaket wire envelope bounds', () => {
  it('rejects invalid types', () => {
    for (const bad of [1.5, -1, NaN, Infinity, 2 ** 53]) expect(() => envelope(bad, '')).toThrow('type');
    expect(() => envelope('793' as unknown as number, '')).toThrow('type');
  });

  it('rejects non-string lines', () => {
    expect(() => envelope(1, 5 as unknown as string)).toThrow('string');
  });

  it('rejects oversize frames when encoding', () => {
    expect(() => encodeFrame(PRIVMSG, 'a'.repeat(MAX_FRAME_LENGTH))).toThrow('too large');
    expect(encodeFrame(PRIVMSG, 'a'.repeat(1000)).endsWith('\r\n')).toBe(true);
  });
});

describe('JoinBlaket wire adversarial parsing', () => {
  const bad = (text: unknown): void => {
    expect(() => parse(text as string)).toThrow();
  };

  it('rejects non-JSON and non-object roots', () => {
    for (const t of [
      '',
      '\r\n',
      'not json',
      '{',
      '{"type": 1, "line": "x"',
      '[]',
      '[1, "x"]',
      '"x"',
      '42',
      'null',
      'true',
      '{"type": 1, "line": "x"} x',
    ])
      bad(t);
    bad(undefined);
    bad(null);
    bad(5);
  });

  it('rejects embedded or multiple line terminators', () => {
    bad('{"type": 1, "line": "x"}\r\n{"type": 1, "line": "y"}\r\n');
    bad('{"type": 1,\n "line": "x"}');
    bad('\r\n{"type": 1, "line": "x"}');
    bad('{"type": 1, "line": "x"}\r\n\r\n');
  });

  it('rejects non-integer types', () => {
    for (const t of ['1.5', '1.0', '1e3', '-1', '"793"', 'true', 'null', '[]', '{}', '9007199254740993', '1E2', '01'])
      bad(`{"type": ${t}, "line": "x"}`);
  });

  it('judges the type token, not text inside the line string', () => {
    for (const decoy of ['"type": 5,', '"type":5}', '\\"type\\": 5,', '{"type": 5}']) {
      bad('{"type": 1.0, "line": ' + JSON.stringify(decoy) + '}');
      bad('{"line": ' + JSON.stringify(decoy) + ', "type": 1e0}');
      bad('{"type": -0, "line": ' + JSON.stringify(decoy) + '}');
    }
    expect(parse('{"line": "x", "type": 7}')).toEqual({ type: 7, line: 'x' });
    expect(parse('{ "line" : "x" , "type" : 0 }')).toEqual({ type: 0, line: 'x' });
    expect(parse('{"type": 5, "line": ' + JSON.stringify('"type": 1.5,') + '}')).toEqual({ type: 5, line: '"type": 1.5,' });
  });

  it('accepts only canonical non-negative integer type text', () => {
    for (const t of ['+1', '00', '-0', '1.', '.5', '1e0', '1E+0', '0x10', '1_0', '١']) bad('{"type": ' + t + ', "line": "x"}');
    expect(parse('{"type": 9007199254740991, "line": "x"}').type).toBe(9007199254740991);
  });

  it('rejects non-string lines', () => {
    for (const l of ['5', 'null', 'true', '["x"]', '{"a": 1}', '1.5']) bad(`{"type": 1, "line": ${l}}`);
  });

  it('rejects missing, extra and duplicate keys', () => {
    bad('{"type": 1}');
    bad('{"line": "x"}');
    bad('{}');
    bad('{"type": 1, "line": "x", "extra": 2}');
    bad('{"type": 1, "type": 2, "line": "x"}');
    bad('{"type": 1, "line": "x", "line": "y"}');
    bad('{"type": 1, "line": "x", "t\\u0079pe": 2}');
  });

  it('is not fooled by keys nested inside the line string or objects', () => {
    expect(parse('{"type": 1, "line": "{\\"type\\": 2, \\"line\\": 3}"}')).toEqual({ type: 1, line: '{"type": 2, "line": 3}' });
    bad('{"type": 1, "line": "x", "o": {"a": 1}}');
  });

  it('rejects oversize frames', () => {
    const body = (n: number): string => '{"type": 1, "line": "' + 'a'.repeat(n) + '"}';
    expect(parse(body(1000)).line.length).toBe(1000);
    bad(body(MAX_FRAME_LENGTH));
    bad(body(MAX_FRAME_LENGTH * 4));
  });

  it('rejects lone surrogates in raw text and accepts escaped pairs', () => {
    bad('{"type": 1, "line": "\ud800"}');
    bad('{"type": 1, "line": "\udc00"}');
    expect(parse('{"type": 1, "line": "\\ud83d\\ude00"}').line).toBe('\u{1F600}');
  });

  it('rejects unescaped control characters inside the string', () => {
    bad('{"type": 1, "line": "a\tb"}');
    bad('{"type": 1, "line": "a\u0000b"}');
  });

  it('returns frozen frames', () => {
    expect(Object.isFrozen(parse('{"type": 1, "line": "x"}'))).toBe(true);
  });
});
