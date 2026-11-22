import assert from 'assert';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { URDecoder } from '@ngraveio/bc-ur';
import { CryptoPSBT } from '@keystonehq/bc-ur-registry';
import { Psbt } from 'bitcoinjs-lib';

/** Decode the rendered pixels, rather than accessing app state or an injected payload. */
export interface QrControls {
  /** Reveal the existing fragment controls (tap the QR). */
  showControls: () => Promise<void>;
  /** Stop the 500ms auto-advance via the existing Stop button; resolves once stopped. */
  stop: () => Promise<void>;
  /** Press the existing Next button once. */
  next: () => Promise<void>;
  /** Read the "n of total" label text. */
  label: () => Promise<string>;
}

export async function captureRenderedPsbt(
  takeScreenshot: (name: string) => Promise<string>,
  controls: QrControls,
): Promise<{ psbt: Psbt; images: number }> {
  assert.equal(process.platform, 'darwin', 'Apple Core Image screenshot reader requires the iOS CI host');
  const temp = mkdtempSync(path.join(os.tmpdir(), 'redwallet-qr-pixels-'));
  try {
    const reader = path.join(temp, 'read-qr');
    execFileSync('xcrun', ['swiftc', path.resolve('tests/native/read-qr-image.swift'), '-o', reader], { timeout: 60000 });
    const decoder = new URDecoder();
    const deadline = Date.now() + 120000;
    let images = 0;
    // Animation otherwise samples a moving frame; freeze it, then walk every fragment.
    await controls.showControls();
    await controls.stop();
    const total = Number(/([0-9]+)[^0-9]*$/.exec(await controls.label())?.[1]);
    assert(Number.isInteger(total) && total > 0, 'QR fragment counter is unreadable');
    const seen = new Set<string>();
    // Two passes tolerate a dropped frame; the counter wraps so any start index is covered.
    for (let step = 0; step < total * 2 && Date.now() < deadline && !decoder.isComplete(); step++) {
      const screenshot = await takeScreenshot('offline-hardware-qr-' + images++);
      const values: unknown = JSON.parse(execFileSync(reader, [screenshot], { encoding: 'utf8', timeout: 10000 }));
      assert(Array.isArray(values));
      for (const value of values) {
        if (typeof value === 'string' && value.toUpperCase().startsWith('UR:CRYPTO-PSBT/')) {
          seen.add(value.toUpperCase());
          decoder.receivePart(value);
        }
        if (decoder.isComplete()) break;
      }
      if (!decoder.isComplete()) await controls.next();
    }
    assert(
      decoder.isComplete() && decoder.isSuccess(),
      'Rendered PSBT QR did not decode: saw ' + seen.size + ' distinct fragments of ' + total,
    );
    const ur = decoder.resultUR();
    assert.equal(ur.type, 'crypto-psbt');
    return { psbt: Psbt.fromBuffer(CryptoPSBT.fromCBOR(ur.cbor).getPSBT()), images };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
