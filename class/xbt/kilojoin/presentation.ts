import { chainDiagnostics, ChainDiagnostic } from './chain-error';
import type { Journal } from './round';
import type { SessionState } from './session';

export function coinjoinProgress(session: SessionState, journal: Journal): { title: string; detail: string } {
  if (journal.phase === 'complete') return { title: 'Confirmed', detail: 'The joint transaction is confirmed.' };
  if (journal.phase === 'uncertain')
    return {
      title: 'Stopped · coins reserved',
      detail: 'A signature may have been shared. Check confirmation before reusing these coins.',
    };
  if (journal.phase === 'aborted') {
    if (session.terminalCause === 'creator-rejected')
      return { title: 'Rejected by pool', detail: 'The pool creator rejected this participation attempt.' };
    if (session.terminalCause === 'creator-aborted') return { title: 'Aborted by pool', detail: 'The pool creator aborted the round.' };
    return { title: 'Stopped', detail: 'Participation has ended.' };
  }
  switch (session.phase) {
    case 'joining':
      return { title: 'Joining pool', detail: 'Waiting for the pool creator to accept the join request.' };
    case 'open':
      return session.seats.length
        ? { title: 'In pool', detail: 'The participant list has been validated. Waiting for round closing.' }
        : {
            title: 'Accepted · validating participants',
            detail: 'The pool welcomed you. Its participant list has not passed validation yet.',
          };
    case 'voting':
      return { title: 'Round closing vote', detail: 'Waiting for participants to accept or decline closing.' };
    case 'closing':
      return { title: 'Registering outputs', detail: 'Preparing the round for transaction review.' };
    case 'review':
      return { title: 'Ready for review', detail: 'Review the transaction and fee before choosing whether to sign.' };
    case 'signed':
      return { title: 'Signed · awaiting confirmation', detail: 'Coins remain reserved while the signed transaction is resolved.' };
    default:
      return { title: 'Participation ended', detail: 'Check the coin reservation status below.' };
  }
}

export function coinjoinIssue(message: string): { category: string; detail: string } {
  // Fixed diagnostic codes affect presentation only, never participation or reservations.
  const code = /Diagnostic: (KJ-[A-Z-]+)\./.exec(message)?.[1];
  if (code && Object.prototype.hasOwnProperty.call(chainDiagnostics, code))
    return { category: 'Coin validation', detail: chainDiagnostics[code as ChainDiagnostic] };
  if (code === 'KJ-WALLET-INVENTORY')
    return { category: 'Wallet check', detail: 'RedWallet could not read the coin inventory across its saved wallets.' };
  if (code === 'KJ-WALLET-INPUTS')
    return {
      category: 'Coin protection',
      detail: 'The pool assigns a coin from one of your saved wallets outside your selected participation.',
    };
  if (code === 'KJ-STORAGE') return { category: 'Wallet storage', detail: 'RedWallet could not securely save the participation state.' };
  if (code && ['KJ-BACKEND', 'KJ-OBSERVATION', 'KJ-PARENT', 'KJ-TIP'].includes(code))
    return {
      category: 'Blockchain connection',
      detail: 'RedWallet could not independently verify the pool inputs with the configured backend.',
    };
  if (code && ['KJ-CHAIN', 'KJ-MATURITY', 'KJ-COIN-FORMAT', 'KJ-PROOF', 'KJ-CHANGE', 'KJ-OWN-SEAT'].includes(code))
    return {
      category: 'Coin validation',
      detail: 'A pool input or its ownership, confirmation, or change information did not pass validation.',
    };
  if (
    message.startsWith('Selected coins ') ||
    message === 'Selected coin spending key unavailable' ||
    message === 'Invalid coin selection or fee limit'
  )
    return { category: 'Coin selection', detail: 'The selected coins or fee limit cannot be used for this attempt.' };
  if (code)
    return {
      category: 'Pool message validation',
      detail: 'A pool message did not pass the protocol checks. No automatic signing is allowed.',
    };
  if (/relay/i.test(message))
    return {
      category: 'Relay connection',
      detail: 'Communication with the pool relay failed. The displayed participant list may no longer be current.',
    };
  return { category: 'Participation action', detail: 'The requested action did not complete. Check the message and reservation status.' };
}
