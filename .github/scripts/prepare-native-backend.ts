/** Download integrity-pinned, disposable test tools. No system installation or production configuration. */
import assert from 'assert';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync, chmodSync, copyFileSync, existsSync } from 'fs';
import path from 'path';

const directory = process.argv[2];
assert.ok(directory && path.isAbsolute(directory), 'Supply an explicit absolute test-tool directory');
mkdirSync(directory, { recursive: true });
const manifest = JSON.parse(readFileSync('tests/native/backend-assets.json', 'utf8'));
const mac = process.platform === 'darwin';
assert.ok(mac || (process.platform === 'linux' && process.arch === 'x64'), 'Only macOS and Linux x86_64 test runners are supported');
const macKey = process.arch === 'arm64' ? 'macos_arm64' : 'macos_x86_64';
function download(asset: { url: string; sha256: string }): string {
  const file = path.join(directory, path.basename(asset.url));
  if (!existsSync(file)) {
    execFileSync('curl', ['--fail', '--location', '--max-time', '180', '--max-filesize', '500000000', '--output', file, asset.url], {
      stdio: 'inherit',
      timeout: 185_000,
    });
  }
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), asset.sha256, 'Test-tool archive digest mismatch');
  return file;
}
function extractBinary(archive: string, name: string): void {
  const members = execFileSync('tar', ['-tzf', archive], {
    encoding: 'utf8',
    maxBuffer: 20_000_000,
  })
    .split('\n')
    .filter(member => member.endsWith('/' + name) || member === name);
  assert.equal(members.length, 1, 'Ambiguous test binary in archive: ' + name);
  const file = path.join(directory, name);
  writeFileSync(
    file,
    execFileSync('tar', ['-xOf', archive, members[0]], {
      maxBuffer: 150_000_000,
    }),
  );
  chmodSync(file, 0o755);
}
const knots = download(manifest.knots[mac ? macKey : 'linux']);
extractBinary(knots, 'bitcoind');
extractBinary(knots, 'bitcoin-cli');
if (!mac) {
  extractBinary(download(manifest.fulcrum.linux), 'Fulcrum');
} else {
  // This fork has no published macOS binary. Build its pinned source with the
  // supplied universal static RocksDB, following its upstream qmake instructions.
  const source = path.join(directory, 'fulcrum-source');
  mkdirSync(source, { recursive: true });
  const archive = download(manifest.fulcrum.source);
  const members = execFileSync('tar', ['-tzf', archive], {
    encoding: 'utf8',
    maxBuffer: 20_000_000,
  })
    .split('\n')
    .filter(Boolean);
  assert.ok(
    members.every(member => !member.startsWith('/') && !member.split('/').includes('..')),
    'Unsafe source archive path',
  );
  execFileSync('tar', ['-xzf', archive, '-C', source, '--strip-components=1']);
  const qtPrefix = execFileSync('brew', ['--prefix', 'qtbase'], {
    encoding: 'utf8',
  }).trim();
  const qmake = path.join(qtPrefix, 'bin/qmake');
  execFileSync(qmake, ['CONFIG+=release', 'CONFIG-=debug'], {
    cwd: source,
    stdio: 'inherit',
    timeout: 120_000,
  });
  execFileSync('make', ['-j3'], {
    cwd: source,
    stdio: 'inherit',
    timeout: 1200_000,
  });
  const built = [path.join(source, 'Fulcrum'), path.join(source, 'Fulcrum.app/Contents/MacOS/Fulcrum')].find(existsSync);
  assert.ok(built, 'Compiled macOS Fulcrum not found');
  copyFileSync(built, path.join(directory, 'Fulcrum'));
}
writeFileSync(path.join(directory, 'asset-provenance.json'), JSON.stringify(manifest, null, 2) + '\n');
for (const name of ['bitcoind', 'bitcoin-cli', 'Fulcrum']) {
  execFileSync(path.join(directory, name), ['--version'], {
    stdio: 'inherit',
    timeout: 10_000,
  });
}
