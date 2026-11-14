import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { NativeTestOutcome, runWithNativeReceipt } from '../native/native-test-receipt';

describe('native qualification failure reporting', () => {
  test.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])('records outcome with test failure=%s and cleanup failure=%s', async (testFails, cleanupFails) => {
    const testError = new Error('original signing assertion');
    const cleanupError = new Error('node shutdown failed');
    const events: string[] = [];
    let receipt: NativeTestOutcome | undefined;
    const result = runWithNativeReceipt({
      run: async () => {
        events.push('test');
        if (testFails) throw testError;
      },
      cleanup: async () => {
        events.push('cleanup');
        if (cleanupFails) throw cleanupError;
      },
      writeReceipt: outcome => {
        events.push('receipt');
        receipt = outcome;
      },
    });
    if (testFails || cleanupFails) await expect(result).rejects.toBe(testFails ? testError : cleanupError);
    else await expect(result).resolves.toBeUndefined();
    expect(events).toEqual(['test', 'cleanup', 'receipt']);
    expect(receipt?.passed).toBe(!testFails && !cleanupFails);
    expect(receipt?.testError).toBe(testFails ? testError.stack : undefined);
    expect(receipt?.cleanupError).toBe(cleanupFails ? cleanupError.stack : undefined);
  });

  test.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])('retains the original failure when receipt writing also fails (%s, %s)', async (testFails, cleanupFails) => {
    const testError = new Error('original signing assertion');
    const cleanupError = new Error('node shutdown failed');
    const writeError = new Error('disk full');
    const report = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(
        runWithNativeReceipt({
          run: async () => {
            if (testFails) throw testError;
          },
          cleanup: async () => {
            if (cleanupFails) throw cleanupError;
          },
          writeReceipt: () => {
            throw writeError;
          },
        }),
      ).rejects.toBe(testFails ? testError : cleanupFails ? cleanupError : writeError);
      expect(report).toHaveBeenCalledWith('Native test receipt could not be written:', writeError);
    } finally {
      report.mockRestore();
    }
  });

  test('writes failed receipt to disk even when both the test and cleanup fail', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'redwallet-receipt-'));
    const file = path.join(directory, 'receipt.json');
    const original = new Error('original assertion');
    try {
      await expect(
        runWithNativeReceipt({
          run: async () => {
            throw original;
          },
          cleanup: async () => {
            throw new Error('cleanup failure');
          },
          writeReceipt: outcome => writeFileSync(file, JSON.stringify(outcome)),
        }),
      ).rejects.toBe(original);
      const receipt = JSON.parse(readFileSync(file, 'utf8'));
      expect(receipt.passed).toBe(false);
      expect(receipt.testError).toContain('original assertion');
      expect(receipt.cleanupError).toContain('cleanup failure');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
