// Executes the app's prepared self-test on its actual Hermes VM. ONLY native
// storage/entropy boundaries are replaced; this is NOT an iOS Keychain receipt.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');
const { execFileSync } = require('child_process');
const esbuild = require(process.env.REDWALLET_ESBUILD_MODULE || 'esbuild');
const root = path.resolve(__dirname, '../..');
const hermes = process.env.REDWALLET_HERMES_BIN;
const output = process.argv[2];
if (!hermes || !output) throw new Error('Set REDWALLET_HERMES_BIN and supply result JSON path');
const settings = { absWorkingDir: root, bundle: true, platform: 'browser', target: 'es2020', format: 'iife', write: false };
const globals = esbuild.buildSync({
  ...settings,
  stdin: {
    resolveDir: root,
    contents:
      "globalThis.global = globalThis; globalThis.Buffer = require('buffer/').Buffer; globalThis.TextEncoder = require('text-encoding').TextEncoder; globalThis.TextDecoder = require('text-encoding').TextDecoder;",
  },
}).outputFiles[0].text;
const stub = `
  import { sha256 } from '@noble/hashes/sha256';
  const data = new Map(), keys = new Map();
  let counter = 0;
  const metrics = globalThis.__nativeStubMetrics = {writes:0, reads:0, keyCreates:0, keyDeletes:0, plaintextLeaks:0};
  export function nativeEntropy(length) {
    const chunks = [];
    while (chunks.length * 32 < length) chunks.push(Buffer.from(sha256(Buffer.from('public-storage-probe:' + counter++))));
    return Buffer.concat(chunks).subarray(0, length);
  }
  export const storage = {
    async getItem(key) { metrics.reads++; return data.get(key) ?? null; },
    async setItem(key, value) {
      metrics.writes++;
      if (value.includes('poolSecret') || value.includes('blinded') || value.includes('inverse')) metrics.plaintextLeaks++;
      data.set(key, value);
    },
    async removeItem(key) { data.delete(key); }
  };
  export const keychain = {
    ACCESSIBLE: {WHEN_UNLOCKED_THIS_DEVICE_ONLY:'device-only'},
    SECURITY_LEVEL: {SECURE_HARDWARE:'hardware'},
    async getGenericPassword({service}) { return keys.has(service) ? {password:keys.get(service)} : false; },
    async getSecurityLevel() { return 'software'; },
    async setGenericPassword(user, value, {service, accessible}) {
      if (accessible !== 'device-only') throw new Error('Unexpected key accessibility');
      metrics.keyCreates++; keys.set(service, value); return {service};
    },
    async resetGenericPassword({service}) { metrics.keyDeletes++; keys.delete(service); return true; }
  };
  globalThis.__storageLeftovers = () => ({data:data.size, keys:keys.size});
`;
(async () => {
  const result = await esbuild.build({
    ...settings,
    stdin: {
      resolveDir: root,
      contents: `
        import {runKilojoinNativeSelfTest} from './class/xbt/kilojoin/native-self-test';
        runKilojoinNativeSelfTest().then(() => {
          const leftovers = globalThis.__storageLeftovers();
          if (leftovers.data || leftovers.keys || globalThis.__nativeStubMetrics.plaintextLeaks) throw new Error('Storage cleanup/plaintext assertion failed');
          print(JSON.stringify({ok:true, hermes:typeof HermesInternal !== 'undefined', metrics:globalThis.__nativeStubMetrics, leftovers}));
        }).catch(error => print(JSON.stringify({ok:false,error:error.message,metrics:globalThis.__nativeStubMetrics})));
      `,
    },
    plugins: [
      {
        name: 'explicit-offline-native-boundaries',
        setup(build) {
          build.onResolve({ filter: /^(@react-native-async-storage\/async-storage|react-native-keychain)$/ }, args => ({
            path: args.path,
            namespace: 'offline-native',
          }));
          build.onResolve({ filter: /^\.\/wallet-adapter$/ }, args => {
            if (!/class\/xbt\/kilojoin\/(vault|native-self-test|startup-self-test)\.ts$/.test(args.importer))
              throw new Error('Unexpected entropy importer');
            return { path: 'entropy', namespace: 'offline-native' };
          });
          build.onResolve({ filter: /^diagnostic-native-shared$/ }, () => ({ path: 'shared', namespace: 'offline-native' }));
          build.onLoad({ filter: /.*/, namespace: 'offline-native' }, args => ({
            contents:
              args.path === 'shared'
                ? stub
                : args.path === 'entropy'
                  ? "export {nativeEntropy} from 'diagnostic-native-shared';"
                  : 'export {' +
                    (args.path === 'react-native-keychain' ? 'keychain' : 'storage') +
                    " as default} from 'diagnostic-native-shared';",
            resolveDir: root,
          }));
        },
      },
    ],
  });
  const script = globals + '\n' + result.outputFiles[0].text;
  const temporary = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'redwallet-hermes-storage-')), 'probe.js');
  fs.writeFileSync(temporary, script);
  const observed = JSON.parse(execFileSync(hermes, [temporary], { encoding: 'utf8', timeout: 120000 }));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const receipt = {
    checkedAt: new Date().toISOString(),
    nativeBoundary: 'in-memory diagnostic doubles; not native iOS',
    hermesSha256: hash(fs.readFileSync(hermes)),
    bundleSha256: hash(script),
    ...observed,
  };
  fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
  if (!observed.ok || !observed.hermes) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
