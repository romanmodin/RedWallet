/** Exact display arithmetic. A manual quote is never a current market feed. */
export function manualUsdEstimate(satoshis: bigint, price: number): string {
  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    price > 1e12 ||
    satoshis < 0n ||
    satoshis > 2100000000000000n
  )
    throw Error("Invalid manual estimate");
  const [mantissa, exponent = "0"] = price.toString().toLowerCase().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const coefficient = BigInt(whole + fraction);
  const scale = fraction.length - Number(exponent);
  const numerator =
    satoshis * coefficient * (scale < 0 ? 10n ** BigInt(-scale) : 1n);
  const denominator = 1000000n * (scale > 0 ? 10n ** BigInt(scale) : 1n);
  const cents = (numerator + denominator / 2n) / denominator;
  if (cents < 100n && numerator > 0n) {
    // For very small manual prices, preserve fractional USD instead of 0.00.
    const micros = (numerator * 10000n + denominator / 2n) / denominator;
    if (micros === 0n) return "<0.000001 USD";
    return `${micros / 1000000n}.${(micros % 1000000n).toString().padStart(6, "0").replace(/0+$/, "") || "00"} USD`;
  }
  return `${(cents / 100n).toLocaleString("en-US")}.${(cents % 100n).toString().padStart(2, "0")} USD`;
}
