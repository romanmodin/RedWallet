/**
 * Apply delayed input events to the current destination, never a render snapshot.
 * The stable key also prevents an event for a removed recipient changing another.
 */
export function updatePaymentDestination<T extends { key: string }>(destinations: T[], key: string, update: (current: T) => T): T[] {
  const index = destinations.findIndex(destination => destination.key === key);
  if (index === -1) return destinations;
  const next = [...destinations];
  next[index] = update({ ...destinations[index] });
  return next;
}
