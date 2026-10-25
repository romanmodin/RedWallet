import { ChainValidationError } from './chain-error';
import { participantFailure, relayFailureMessage } from './relay-error';

export const rejectionDetails = {
  'pool-not-open': 'The pool is no longer open.',
  'pool-full': 'The pool is full.',
  'wrong-password': 'The pool rejected the password.',
  'malformed-request': 'The pool could not validate the join request.',
  'duplicate-coin': 'The pool received the same coin more than once.',
  'coin-already-seated': 'A selected coin already has a seat in this pool.',
  'missing-proof': 'The pool requires an ownership proof for every coin.',
  'invalid-proof': 'The pool rejected a coin ownership signature.',
  'coin-too-small': 'The selected coin amount is too small for this pool.',
  'invalid-change': 'The change does not match the pool fee.',
  'change-script': 'The change has another address type.',
  'change-signature': 'The pool rejected the change authorization signature.',
  'coin-not-unspent': 'The pool reports that a selected coin is not unspent on its chain view.',
  unknown: 'The pool creator rejected this participation attempt.',
} as const;
export type RejectionReason = keyof typeof rejectionDetails;
const upstreamReasons: Record<string, RejectionReason> = {
  'the pool is no longer open': 'pool-not-open',
  'the pool is full': 'pool-full',
  'wrong password': 'wrong-password',
  'malformed request': 'malformed-request',
  'the same coin twice': 'duplicate-coin',
  'that coin already has a seat': 'coin-already-seated',
  'one proof per coin is needed': 'missing-proof',
  "the coin's signature is wrong": 'invalid-proof',
  'the coin is too small for this pool': 'coin-too-small',
  "the change does not match the pool's fee": 'invalid-change',
  'the change is of another address type': 'change-script',
  "the change's signature is wrong": 'change-signature',
  'that coin is not unspent on the chain': 'coin-not-unspent',
};
export function rejectionReason(raw: unknown): RejectionReason {
  return typeof raw === 'string' && Object.prototype.hasOwnProperty.call(upstreamReasons, raw) ? upstreamReasons[raw] : 'unknown';
}
/** Derived only from the existing fixed diagnostic classifier, never a peer property. */
export function rosterFailureCode(error: unknown): string {
  return /^Participant message rejected \[(KJ-[A-Z-]+)\]$/.exec(participantFailure(error).message)?.[1] ?? 'KJ-PROCESS';
}

export function safeRosterFailureCode(code: unknown): string {
  if (typeof code !== 'string' || !/^KJ-[A-Z-]+$/.test(code)) return 'KJ-PROCESS';
  const message = relayFailureMessage(new Error('Participant message rejected [' + code + ']'));
  return message.includes('Diagnostic: ' + code + '.') ? code : 'KJ-PROCESS';
}

/** Local observation location, never peer text or a full transaction identifier. */
export class RosterInputFailure extends ChainValidationError {
  constructor(
    failure: ChainValidationError,
    readonly seat: number,
    readonly coinPrefix: string,
  ) {
    super(failure.code, failure.message, failure.inputIndex);
  }
}
export function rosterInputDetail(location: { seat: number; coinPrefix: string } | undefined): string {
  return location &&
    Number.isSafeInteger(location.seat) &&
    location.seat >= 1 &&
    location.seat <= 200 &&
    typeof location.coinPrefix === 'string' &&
    /^[a-f0-9]{12}:[0-9]{1,10}$/.test(location.coinPrefix)
    ? ' Seat ' + location.seat + ', coin ' + location.coinPrefix + '….'
    : '';
}
