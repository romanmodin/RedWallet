// Diagnostic-only bundler. esbuild is a temporary external tool, not an app dep.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const esbuild = require(process.env.REDWALLET_ESBUILD_MODULE || 'esbuild');
const root = path.resolve(__dirname, '../..');
const destination = process.argv[2];
const baseline = process.argv[3];
if (!destination || (baseline && !/^[0-9a-f]{40}$/.test(baseline))) {
  throw new Error('Usage: node build-hermes-kilojoin.cjs OUTPUT.js [BASELINE_FULL_COMMIT]');
}
const settings = { absWorkingDir: root, bundle: true, platform: 'browser', target: 'es2020', format: 'iife', write: false };
const globals = esbuild.buildSync({
  ...settings,
  stdin: {
    resolveDir: root,
    contents:
      "globalThis.global = globalThis; globalThis.Buffer = require('buffer/').Buffer; " +
      "globalThis.TextEncoder = require('text-encoding').TextEncoder; globalThis.TextDecoder = require('text-encoding').TextDecoder;",
  },
}).outputFiles[0].text;
(async () => {
  const code = await esbuild.build({
    ...settings,
    entryPoints: ['scripts/diagnostics/hermes-kilojoin-startup.ts'],
    plugins: baseline
      ? [
          {
            name: 'baseline-decrypt-only',
            setup(build) {
              build.onLoad({ filter: /class\/xbt\/kilojoin\/crypto\.ts$/ }, args => ({
                contents: execFileSync('git', ['show', baseline + ':class/xbt/kilojoin/crypto.ts'], { cwd: root, encoding: 'utf8' }),
                loader: 'ts',
                resolveDir: path.dirname(args.path),
              }));
            },
          },
        ]
      : [],
  });
  fs.writeFileSync(destination, globals + '\n' + code.outputFiles[0].text);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
