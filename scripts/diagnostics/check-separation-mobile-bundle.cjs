// Build the actual Metro entry for each mobile platform and inspect source maps.
// This proves resolver wiring; native network behavior is qualified separately.
const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');
const root = process.cwd();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'redwallet-proof-bundle-'));
try {
  const results = [];
  const configuration = [];
  const dependencies = fs.realpathSync(path.join(root, 'node_modules'));
  if (dependencies !== path.join(root, 'node_modules')) {
    // Read-only support for an existing shared dependency directory; no install/mutation.
    const roots = [...new Set([dependencies, path.dirname(path.dirname(require.resolve('react-native/package.json')))])];
    const config = path.join(temporary, 'metro.cjs');
    fs.writeFileSync(
      config,
      'const base = require(' +
        JSON.stringify(path.join(root, 'metro.config.js')) +
        ');' +
        'const roots = ' +
        JSON.stringify(roots) +
        ';' +
        'module.exports = {...base, watchFolders: [...(base.watchFolders || []), ...roots], resolver: {...base.resolver, nodeModulesPaths: [...roots, ...(base.resolver.nodeModulesPaths || [])]}};',
    );
    configuration.push('--config', config);
  }
  for (const platform of ['ios', 'android']) {
    const output = path.join(temporary, platform + '.bundle');
    const map = output + '.map';
    execFileSync(
      process.execPath,
      [
        'node_modules/react-native/cli.js',
        'bundle',
        ...configuration,
        '--platform',
        platform,
        '--entry-file',
        'class/xbt/separation-service.ts',
        '--dev',
        'false',
        '--max-workers',
        '2',
        '--bundle-output',
        output,
        '--sourcemap-output',
        map,
      ],
      { cwd: root, stdio: 'inherit', timeout: 240000 },
    );
    const sources = JSON.parse(fs.readFileSync(map, 'utf8')).sources;
    assert(
      sources.some(value => value.endsWith('class/xbt/separation-http.native.ts')),
      platform + ': native adapter missing',
    );
    assert(!sources.some(value => value.endsWith('class/xbt/separation-http.ts')), platform + ': generic Node adapter bundled');
    results.push({
      platform,
      nativeAdapter: true,
      genericFetchAdapter: false,
      bundleSha256: createHash('sha256').update(fs.readFileSync(output)).digest('hex'),
    });
  }
  const receipt = {
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    observedAt: new Date().toISOString(),
    trackedChangesPresent: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() !== '',
    sourceSha256: Object.fromEntries(
      ['class/xbt/separation-service.ts', 'class/xbt/separation-http.native.ts', 'class/xbt/separation-http-policy.ts'].map(file => [
        file,
        createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
      ]),
    ),
    results,
  };
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
