// Classify only known local errors; never retain or display raw peer payloads.
export function participantFailure(error: unknown): Error {
  const codes: Record<string, string> = {
    'Invalid welcome': 'KJ-WELCOME',
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
  };
  const code = error instanceof Error && Object.prototype.hasOwnProperty.call(codes, error.message) ? codes[error.message] : 'KJ-PROCESS';
  return new Error('Participant message rejected [' + code + ']');
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
  ]) {
    messages['Participant message rejected [' + code + ']'] = messages['Participant message rejected'] + ' Diagnostic: ' + code + '.';
  }
  const detail = Object.prototype.hasOwnProperty.call(messages, error.message)
    ? messages[error.message]
    : 'CoinJoin relay communication failed.';
  return detail + ' Coins remain reserved until the round is resolved.';
}
