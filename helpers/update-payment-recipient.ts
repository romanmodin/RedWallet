/** Apply a delayed input event to the current recipient, never its render snapshot. */
export function updatePaymentRecipient<T extends { key: string }>(recipients: T[], key: string, update: (recipient: T) => void): T[] {
  const index = recipients.findIndex(recipient => recipient.key === key);
  // A removed recipient must not be resurrected or overwrite the next recipient.
  if (index === -1) return recipients;
  const current = { ...recipients[index] };
  update(current);
  const next = [...recipients];
  next[index] = current;
  return next;
}
