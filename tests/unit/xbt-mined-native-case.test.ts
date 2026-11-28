jest.mock('../../class/xbt/separation-http', () => require('../native/mined-ancestry-offline-http'));
import { verifySyntheticOneXbtRequest } from '../native/mined-ancestry-protected-case';

test('the simulator fixture accepts the funded request and rejects the replacement tip', async () => {
  await expect(verifySyntheticOneXbtRequest()).resolves.toEqual({ unsignedOneXbtVerified: true, replacedTipRejected: true });
});
