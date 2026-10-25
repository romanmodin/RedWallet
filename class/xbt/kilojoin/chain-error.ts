/** Fixed local-only diagnostics. Never include inputs, addresses or backend payloads. */
export const chainDiagnostics = {
  'KJ-CHAIN-OUTPUT': 'A pool input names an output absent from its verified parent transaction.',
  'KJ-CHAIN-VALUE': 'A pool input amount differs from the independently verified transaction output.',
  'KJ-CHAIN-SCRIPT': 'A pool input spending script differs from the independently verified transaction output.',
  'KJ-CHAIN-UNSPENT': 'The backend did not return exactly one matching unspent output for a pool input.',
  'KJ-CHAIN-UTXO-VALUE': 'The backend unspent amount differs from the pool input amount.',
  'KJ-CHAIN-CONFIRMATION': 'A pool input has no valid confirmed height from the backend.',
  'KJ-CHAIN-TIP-HEIGHT': 'A pool input confirmation height is above the backend chain tip.',
  'KJ-CHAIN-HISTORY': 'The backend did not return exactly one matching history entry for a pool input.',
  'KJ-CHAIN-HEIGHT-MISMATCH': 'The backend history and unspent confirmation heights disagree for a pool input.',
  'KJ-CHAIN-OBSERVATION': 'A pool input has no independent chain observation.',
  'KJ-CHAIN-SPENT': 'An independently observed pool input is not unspent.',
  'KJ-CHAIN-OBSERVATION-VALUE': 'The independent chain observation amount differs from a pool input.',
  'KJ-CHAIN-OBSERVATION-SCRIPT': 'The independent chain observation script differs from a pool input.',
  'KJ-CHAIN-TIME': 'A pool input chain observation has an invalid timestamp.',
  'KJ-CHAIN-FUTURE': 'A pool input chain observation is dated after the current verification time.',
  'KJ-CHAIN-STALE': 'A pool input chain observation is older than the allowed 60-second verification window.',
} as const;
export type ChainDiagnostic = keyof typeof chainDiagnostics;
export class ChainValidationError extends Error {
  constructor(
    readonly code: ChainDiagnostic,
    message: string,
  ) {
    super(message);
  }
}
