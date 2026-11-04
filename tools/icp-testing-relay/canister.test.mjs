import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import mo from 'motoko';

const source = readFileSync(new URL('./lease.mo', import.meta.url), 'utf8');
mo.write('lease.mo', source);
const prelude = `import Prim "mo:⛔"; import L "lease";
persistent actor Who { public shared({caller}) func who():async Principal { caller } };
let owner = await Who.who();`;
function interpret(body) {
  mo.write('test.mo', prelude + body);
  return mo.run('test.mo');
}
test('lease compiles to ICP WebAssembly without diagnostics', () => {
  assert.deepEqual(mo.check('lease.mo'), []);
  assert.ok(mo.wasm('lease.mo', 'ic').wasm.length > 0);
});
test('both publication orders retire permanently; one receipt keeps the lease active', () => {
  for (const [first, second] of [['ios', 'android'], ['android', 'ios']]) {
    const result = interpret(`let c=await L.Lease(owner,owner,60);
      assert (await c.get_lease()).active;
      assert (await c.mark_published(#${first},"verified-public-release")).active;
      assert not (await c.mark_published(#${second},"verified-public-release")).active;
      assert not (await c.mark_published(#${first},"replacement-receipt")).active;`);
    assert.equal(result.result.error, null, result.stderr);
  }
});
test('manual revocation cannot be reversed by publication calls', () => {
  const result = interpret(`let c=await L.Lease(owner,owner,60);
    assert not (await c.revoke()).active;
    assert not (await c.mark_published(#ios,"verified-public-release")).active;`);
  assert.equal(result.result.error, null, result.stderr);
});
test('anonymous owner and zero/overlong TTL are rejected', () => {
  for (const body of [
    'let c=await L.Lease(Prim.principalOfBlob("\\04"),owner,60);',
    'let c=await L.Lease(owner,owner,0);',
    'let c=await L.Lease(owner,owner,2592001);',
  ]) assert.ok(interpret(body).result.error);
});
test('unauthorized publication and revocation are rejected', () => {
  for (const call of ['mark_published(#ios,"forged")', 'revoke()']) {
    const result = interpret(`let c=await L.Lease(Prim.principalOfBlob(""),owner,60); ignore await c.${call};`);
    assert.ok(result.result.error);
    assert.match(result.stderr, /assertion failure/);
  }
});

test('unauthorized lease reading is rejected', () => {
  const result = interpret('let c=await L.Lease(Prim.principalOfBlob(""),Prim.principalOfBlob(""),60); ignore await c.get_lease();');
  assert.ok(result.result.error);
});
