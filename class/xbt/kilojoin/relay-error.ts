// Never display raw peer messages or exception details: they may contain private data.
export function relayFailureMessage(error: Error): string {
  const messages: Record<string, string> = {
    'Relay connection error': 'Could not connect to the CoinJoin relay.',
    'Relay disconnected': 'The CoinJoin relay connection was lost.',
    'Relay rejected the subscription. Try again.': 'The relay rejected the CoinJoin subscription.',
    'Participant message rejected': 'A CoinJoin participant message could not be validated or processed.',
    'Relay message queue exceeded': 'The CoinJoin relay sent more messages than the app could safely process.',
  };
  const detail = Object.prototype.hasOwnProperty.call(messages, error.message)
    ? messages[error.message]
    : 'CoinJoin relay communication failed.';
  return detail + ' Coins remain reserved until the round is resolved.';
}
