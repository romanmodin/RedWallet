import assert from 'assert';
import * as bitcoin from 'bitcoinjs-lib';
import { requiresHighFeeApproval } from '../../class/xbt/fee-policy';

// Independently calculate the native CPFP review from the retained signed parent.
export function cpfpNeedsApproval(parent: bitcoin.Transaction, child: bitcoin.Transaction): boolean {
  const seen = new Set<number>();
  const inputValue = child.ins.reduce((sum, input) => {
    assert.equal(Buffer.from(input.hash).reverse().toString('hex'), parent.getId());
    assert.ok(parent.outs[input.index] && !seen.has(input.index), 'Invalid or duplicate parent output');
    seen.add(input.index);
    return sum + parent.outs[input.index].value;
  }, 0n);
  const amount = child.outs.reduce((sum, output) => sum + output.value, 0n);
  const fee = Number(inputValue - amount);
  return requiresHighFeeApproval({
    feeSats: fee,
    feeRate: fee / child.virtualSize(),
    amountSats: Number(amount),
  });
}
