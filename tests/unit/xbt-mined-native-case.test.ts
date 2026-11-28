import { verifySyntheticOneXbtRequest } from '../native/mined-ancestry-protected-case';
jest.mock('../../class/xbt/separation-http', () => require('../native/mined-ancestry-offline-http'));

test('the simulator fixture accepts the funded request and rejects the replacement tip', async () => {
  await expect(verifySyntheticOneXbtRequest()).resolves.toEqual({ unsignedOneXbtVerified: true, replacedTipRejected: true });
});
