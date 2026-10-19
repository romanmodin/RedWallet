import { runBip84ReplacementSelfTest } from '../../class/xbt/bip84-self-test';

it('runs the offline public BIP84 replacement and tampering checks used by the native wallet self-test', () => {
  expect(() => runBip84ReplacementSelfTest()).not.toThrow();
});

it('accepts native Buffer views that return plain Uint8Arrays', () => {
  const original = global.Buffer;
  const polyfill: typeof Buffer = require('buffer/').Buffer;
  const subarray = Object.getOwnPropertyDescriptor(polyfill.prototype, 'subarray');
  Object.defineProperty(polyfill.prototype, 'subarray', {
    configurable: true,
    value(this: Uint8Array, start?: number, end?: number) {
      return new Uint8Array(Uint8Array.prototype.subarray.call(this, start, end));
    },
  });
  global.Buffer = polyfill;
  try {
    expect(() => runBip84ReplacementSelfTest()).not.toThrow();
  } finally {
    global.Buffer = original;
    if (subarray) Object.defineProperty(polyfill.prototype, 'subarray', subarray);
    else Reflect.deleteProperty(polyfill.prototype, 'subarray');
  }
});
