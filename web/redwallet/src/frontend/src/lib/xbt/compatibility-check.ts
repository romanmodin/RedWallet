/** Published unfunded regtest fixture only. No storage, API calls or broadcast. */
import fixture from "./compatibility-fixture.json";
import { XbtKeySession } from "./key-material";
import type { SpendPlan } from "./spend-plan";
import { SpendReview } from "./spend-review";
import { openVault, sealVault } from "./vault";
export async function checkWalletCompatibility(): Promise<string> {
  const mnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const password = "Disposable public compatibility fixture";
  const vault = await sealVault(
    { mnemonic, passphrase: "" },
    password,
    globalThis.crypto,
  );
  const recovered = await openVault(
    JSON.stringify(vault),
    password,
    globalThis.crypto,
  );
  if (recovered.mnemonic !== mnemonic || recovered.passphrase !== "")
    throw Error("Local encryption round-trip failed");
  const keys = new XbtKeySession(mnemonic);
  try {
    const signed = new SpendReview(fixture.plan as SpendPlan).sign(keys);
    if (signed.hex !== fixture.hex || signed.txid !== fixture.txid)
      throw Error("XBT signing fixture did not match");
    return "Local encryption and XBT signing self-test passed. No transaction was broadcast.";
  } finally {
    keys.destroy();
  }
}
