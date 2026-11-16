#!/usr/bin/env node
// Local files only. There is deliberately no RPC, HTTP, wallet import or broadcast command.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'node_modules/typescript'));
const { registerHooks } = require('module');
const { fileURLToPath } = require('url');
// Node24 synchronous module hooks: transpile only this repository's TS files.
// No dependency installation, global require.extensions mutation or app runtime.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND' && specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
        const candidate = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier) + '.ts';
        if (
          candidate.startsWith(root + path.sep) &&
          !candidate.includes(path.sep + 'node_modules' + path.sep) &&
          fs.existsSync(candidate)
        ) {
          return nextResolve(candidate, context);
        }
      }
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.ts')) {
      const filename = fileURLToPath(url);
      if (filename.startsWith(root + path.sep) && !filename.includes(path.sep + 'node_modules' + path.sep)) {
        return {
          format: 'commonjs',
          shortCircuit: true,
          source: ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
          }).outputText,
        };
      }
    }
    return nextLoad(url, context);
  },
});
const { createHardwareSigningFixture, verifyHardwareSigningFixture } = require('./hardware-signing-fixture.ts');
function readBounded(filename, limit) {
  const fd = fs.openSync(filename, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size === 0 || stat.size > limit) throw Error('Input must be a nonempty regular file within the size limit');
    const buffer = Buffer.alloc(limit + 1);
    const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (length > limit) throw Error('Input exceeds size limit');
    return buffer.subarray(0, length);
  } finally {
    fs.closeSync(fd);
  }
}
function writeNew(filename, data) {
  fs.writeFileSync(filename, data, { flag: 'wx', mode: 0o600 });
}
try {
  const [command, accountFile, target, receiptFile, ...extra] = process.argv.slice(2);
  if (
    extra.length ||
    !accountFile ||
    !target ||
    !['generate', 'verify'].includes(command) ||
    (command === 'generate' ? receiptFile !== undefined : !receiptFile)
  ) {
    throw Error(
      'Usage: generate <public-account.json> <new-output-directory> OR verify <public-account.json> <signed-file> <new-receipt.json>',
    );
  }
  const account = JSON.parse(readBounded(accountFile, 16 * 1024).toString('utf8'));
  if (command === 'generate') {
    const { request, review } = createHardwareSigningFixture(account);
    fs.mkdirSync(target, { mode: 0o700 });
    writeNew(path.join(target, 'OFFLINE-TEST-NEVER-BROADCAST.psbt'), request.toBuffer());
    writeNew(path.join(target, 'OFFLINE-TEST-NEVER-BROADCAST.base64.txt'), request.toBase64() + '\n');
    writeNew(path.join(target, 'review.json'), JSON.stringify(review, null, 2) + '\n');
    console.log('Created invalid-funding offline test files. Review review.json; never fund or broadcast them.');
  } else {
    const receipt = verifyHardwareSigningFixture(account, readBounded(target, 64 * 1024));
    writeNew(receiptFile, JSON.stringify(receipt, null, 2) + '\n');
    console.log('Offline test signature verified. No payment or physical-device qualification is implied.');
  }
} catch (error) {
  // Do not print account contents, parser excerpts, key material or returned bytes.
  console.error(
    'Offline hardware test failed. Check the command, public account, file limits and signed return. No success receipt was created.',
  );
  process.exitCode = 1;
}
