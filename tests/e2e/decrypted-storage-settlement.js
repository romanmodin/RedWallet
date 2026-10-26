// Check real wallet visibility before restart, and persistent decryption after it.
// A dismissed native password modal can remain mounted during iOS navigation.
export async function verifyDecryptedStorage({ home, wallet, restart, passwordAbsent }) {
  await home();
  await wallet();
  await restart();
  await passwordAbsent();
  await home();
  await wallet();
}
