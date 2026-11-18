import assert from 'assert';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { URDecoder } from '@ngraveio/bc-ur';
import { CryptoPSBT } from '@keystonehq/bc-ur-registry';
import { Psbt } from 'bitcoinjs-lib';

/** Decode the rendered pixels, rather than accessing app state or an injected payload. */
export async function captureRenderedPsbt(takeScreenshot: (name: string) => Promise<string>): Promise<{ psbt: Psbt; images: number }> {
  assert.equal(process.platform, 'darwin', 'Apple Core Image screenshot reader requires the iOS CI host');
  const temp = mkdtempSync(path.join(os.tmpdir(), 'redwallet-qr-pixels-'));
  try {
    const reader = path.join(temp, 'read-qr');
    execFileSync('xcrun', ['swiftc', path.resolve('tests/native/read-qr-image.swift'), '-o', reader], { timeout: 60000 });
    const decoder = new URDecoder();
    const deadline = Date.now() + 45000;
    let images = 0;
    while (Date.now() < deadline && !decoder.isComplete()) {
      const screenshot = await takeScreenshot('offline-hardware-qr-' + images++);
      const values: unknown = JSON.parse(execFileSync(reader, [screenshot], { encoding: 'utf8', timeout: 10000 }));
      assert(Array.isArray(values));
      for (const value of values) {
        if (typeof value === 'string' && value.toUpperCase().startsWith('UR:CRYPTO-PSBT/')) decoder.receivePart(value);
        if (decoder.isComplete()) break;
      }
      if (!decoder.isComplete()) await new Promise(resolve => setTimeout(resolve, 350));
    }
    assert(decoder.isComplete() && decoder.isSuccess(), 'Rendered PSBT QR did not decode before the deadline');
    const ur = decoder.resultUR();
    assert.equal(ur.type, 'crypto-psbt');
    return { psbt: Psbt.fromBuffer(CryptoPSBT.fromCBOR(ur.cbor).getPSBT()), images };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
