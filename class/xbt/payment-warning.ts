import confirm from '../../helpers/confirm';

export const XBT_PAYMENT_WARNING = 'BTC and XBT addresses look the same. Confirm that every recipient expects XBT before continuing.';

/** Shared preparation gate for camera, imported image, pasted URI and typed addresses. */
export function confirmXbtPayment(): Promise<boolean> {
  return confirm('Confirm XBT payment', XBT_PAYMENT_WARNING);
}
