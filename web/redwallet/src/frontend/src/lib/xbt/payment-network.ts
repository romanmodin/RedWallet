/** Public signed bytes and status only; never accepts wallet keys. No automatic retries. */
import type { backendInterface } from "@/backend";
import { publicAddress } from "./key-material";
import type { PendingPayment } from "./pending-payment";
export type PaymentActor = Pick<
  backendInterface,
  | "getServerStatus"
  | "getAddressHistory"
  | "getRawTransaction"
  | "broadcastSignedTransaction"
>;
async function bounded<T>(call: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      call,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Error("Network reply timed out; transaction outcome is unknown"),
            ),
          35000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function status(actor: PaymentActor) {
  const result = await bounded(actor.getServerStatus());
  if (result.__kind__ !== "ok") throw Error("XBT status unavailable");
  const s = result.ok;
  if (
    !s.checkpointConfigured ||
    s.checkpointHeight !== 961640n ||
    s.checkpointHash !==
      "0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb" ||
    s.height < 961640n
  )
    throw Error("XBT checkpoint could not be verified");
  return s;
}
export async function submitOriginal(
  actor: PaymentActor,
  hex: string,
  txid: string,
  canSubmit: () => boolean,
  uncertain = false,
) {
  if ((await status(actor)).broadcastEnabled !== true)
    throw Error("Sending is disabled by the bridge operator");
  if (uncertain) {
    const existing = await bounded(actor.getRawTransaction(txid));
    if (existing.__kind__ !== "ok")
      throw Error(
        "Could not rule out the original transaction on this provider. No retry was sent; keep the saved receipt and check confirmation.",
      );
    if (existing.ok.hex !== hex)
      throw Error(
        "Existing transaction bytes do not match; no retry was sent.",
      );
    return { txid, outcome: "acknowledged" };
  }
  if (!canSubmit()) throw Error("Submission cancelled before dispatch");
  const result = await bounded(actor.broadcastSignedTransaction(hex, txid));
  if (result.__kind__ !== "ok")
    throw Error("Submission outcome unknown; reconcile the saved transaction");
  if (result.ok.txid !== txid)
    throw Error("Submission reply does not match the original transaction");
  return result.ok;
}
export async function confirmOriginal(
  actor: PaymentActor,
  payment: PendingPayment,
): Promise<boolean> {
  const before = await status(actor);
  const raw = await bounded(actor.getRawTransaction(payment.txid));
  if (raw.__kind__ !== "ok" || raw.ok.hex !== payment.hex) return false;
  const first = payment.inputs[0];
  const history = await bounded(
    actor.getAddressHistory(
      publicAddress(payment.accountXpub, first.branch, first.index),
    ),
  );
  if (history.__kind__ !== "ok") return false;
  const row = history.ok.entries.find((r) => r.txid === payment.txid);
  if (!row || row.height <= 0n || row.height > before.height) return false;
  const after = await status(actor);
  return after.height >= before.height;
}
