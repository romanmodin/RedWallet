package io.bluewallet.bluewallet.lightning

// Monetary-domain and arithmetic bounds, never a beta spending allowance.
internal object LightningAmounts {
    const val MAX_CHANNEL_OPEN_SATS = 10_000_000L
    const val MAX_SATS = 2_100_000_000_000_000L
    // Signed LND intermediate: 3x close rate * 1000 * max consensus vsize,
    // plus 999 for rounding. This is an arithmetic bound, not a beta allowance.
    const val MAX_FEE_RATE = 3_074_457_345L // (Long.MAX_VALUE - 999) / (3 * 1000 * 1_000_000)
    fun valid(sats: Long, allowZero: Boolean = false) = sats in (if (allowZero) 0L else 1L)..MAX_SATS
    fun validFeeRate(rate: Long) = rate in 1L..MAX_FEE_RATE
}
