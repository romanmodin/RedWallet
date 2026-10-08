export function lifecycleFormats(requested?: string): readonly ('segwit' | 'taproot')[] {
  if (requested === undefined) return ['segwit', 'taproot'];
  if (requested === 'segwit' || requested === 'taproot') return [requested];
  throw new Error('Invalid native lifecycle format');
}
