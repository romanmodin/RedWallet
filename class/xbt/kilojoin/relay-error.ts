const participantStages = ['KJ-ROSTER-PARSE', 'KJ-BACKEND', 'KJ-WALLET-INPUTS', 'KJ-ROSTER-CHECK'] as const;
type ParticipantStage = (typeof participantStages)[number];
class ParticipantStageError extends Error {
  readonly code: string;
  constructor(stage: ParticipantStage) {
    super('Participant stage failed');
    this.code = participantStages.includes(stage) ? stage : 'KJ-PROCESS';
  }
}
// Classify only known local errors; never retain or display raw peer payloads.
export function participantFailure(error: unknown): Error {
  const codes: Record<string, string> = {
    'Invalid welcome': 'KJ-WELCOME',
    'Invalid roster object': 'KJ-ROSTER-SHAPE',
    'Invalid seats': 'KJ-ROSTER-SHAPE',
    'Invalid roster size': 'KJ-ROSTER-SHAPE',
    'Invalid seat input count': 'KJ-ROSTER-SHAPE',
    'Ambiguous first coin': 'KJ-ROSTER-SHAPE',
    'Invalid integer/amount': 'KJ-COIN-FORMAT',
    'Invalid coin public key': 'KJ-COIN-FORMAT',
    'Unsupported script type': 'KJ-COIN-FORMAT',
    'Duplicate seat identity': 'KJ-ROSTER-DUPLICATE',
    'Duplicate change script': 'KJ-ROSTER-DUPLICATE',
    'Duplicate roster input': 'KJ-ROSTER-DUPLICATE',
    'Unselected wallet input': 'KJ-WALLET-INPUTS',
    'Invalid observation request': 'KJ-OBSERVATION',
    'Invalid observation time': 'KJ-OBSERVATION',
    'Electrum returned a raw transaction that does not match the requested txid': 'KJ-PARENT',
    'Invalid canonical hex': 'KJ-HEX',
    'Replayed message': 'KJ-REPLAY',
    'Unauthorized message route': 'KJ-ROUTE',
    'Unauthorized message type': 'KJ-TYPE',
    'Invalid or stale message': 'KJ-ENVELOPE',
    'Invalid ownership proof': 'KJ-PROOF',
    'Missing ownership proofs': 'KJ-PROOF',
    'Invalid seat change': 'KJ-CHANGE',
    'Own seat missing or changed': 'KJ-OWN-SEAT',
    'Invalid or replayed roster sequence': 'KJ-ROSTER-SEQ',
    'Invalid roster sequence': 'KJ-ROSTER-SEQ',
    'Missing, stale or mismatched chain observation': 'KJ-CHAIN',
    'CoinJoin requires a verified confirmed unspent coin': 'KJ-CHAIN',
    'Unverified chain tip': 'KJ-TIP',
    'Immature CoinJoin coinbase': 'KJ-MATURITY',
    'Session action pending': 'KJ-BUSY',
    'Invalid or expired session phase': 'KJ-PHASE',
    'Invalid vote caller': 'KJ-VOTE',
    'Invalid round/vote identifier': 'KJ-ROUND-ID',
    'Conflicting initial vote': 'KJ-ORDER',
    'Conflicting initial vote identity': 'KJ-ORDER',
    'Session persistence failed': 'KJ-STORAGE',
    'Invalid NIP44 payload': 'KJ-DECRYPT',
    'Invalid NIP44 version/encoding': 'KJ-DECRYPT',
    'Invalid NIP44 MAC': 'KJ-DECRYPT',
    'Invalid NIP44 padding': 'KJ-DECRYPT',
    'Invalid UTF8': 'KJ-DECRYPT',
  };
  const code =
    error instanceof ParticipantStageError
      ? error.code
      : error instanceof Error && Object.prototype.hasOwnProperty.call(codes, error.message)
        ? codes[error.message]
        : 'KJ-PROCESS';
  return new Error('Participant message rejected [' + code + ']');
}

/** Preserve recognized validation failures; replace unknown details with a fixed stage only. */
export function participantStageFailure(error: unknown, stage: ParticipantStage): Error {
  if (participantFailure(error).message !== 'Participant message rejected [KJ-PROCESS]') return error as Error;
  return new ParticipantStageError(stage);
}

// Never display raw peer messages or exception details: they may contain private data.
export function relayFailureMessage(error: Error): string {
  const messages: Record<string, string> = {
    'Relay connection error': 'Could not connect to the CoinJoin relay.',
    'Relay disconnected': 'The CoinJoin relay connection was lost.',
    'Relay rejected the subscription. Try again.': 'The relay rejected the CoinJoin subscription.',
    'Participant message rejected': 'A CoinJoin participant message could not be validated or processed.',
    'Relay message queue exceeded': 'The CoinJoin relay sent more messages than the app could safely process.',
  };
  for (const code of [
    ...participantStages,
    'KJ-ROSTER-SHAPE',
    'KJ-COIN-FORMAT',
    'KJ-ROSTER-DUPLICATE',
    'KJ-OBSERVATION',
    'KJ-PARENT',
    'KJ-WELCOME',
    'KJ-HEX',
    'KJ-REPLAY',
    'KJ-ROUTE',
    'KJ-TYPE',
    'KJ-ENVELOPE',
    'KJ-PROCESS',
    'KJ-PROOF',
    'KJ-CHANGE',
    'KJ-OWN-SEAT',
    'KJ-ROSTER-SEQ',
    'KJ-CHAIN',
    'KJ-TIP',
    'KJ-MATURITY',
    'KJ-BUSY',
    'KJ-PHASE',
    'KJ-VOTE',
    'KJ-ROUND-ID',
    'KJ-ORDER',
    'KJ-STORAGE',
    'KJ-DECRYPT',
  ]) {
    messages['Participant message rejected [' + code + ']'] = messages['Participant message rejected'] + ' Diagnostic: ' + code + '.';
  }
  const detail = Object.prototype.hasOwnProperty.call(messages, error.message)
    ? messages[error.message]
    : 'CoinJoin relay communication failed.';
  return detail + ' Coins remain reserved until the round is resolved.';
}
