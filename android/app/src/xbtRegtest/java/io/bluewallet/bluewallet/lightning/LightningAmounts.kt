package io.bluewallet.bluewallet.lightning

// Monetary-domain and arithmetic bounds, never a beta spending allowance.
internal object LightningAmounts {
    const val MAX_CHANNEL_OPEN_SATS = 10_000_000L
    const val MAX_SATS = 2_100_000_000_000_000L
    const val MAX_FEE_RATE = 3_002_399_751_580_330L // JS MAX_SAFE_INTEGER / 3
    fun valid(sats: Long, allowZero: Boolean = false) = sats in (if (allowZero) 0L else 1L)..MAX_SATS
    fun validFeeRate(rate: Long) = rate in 1L..MAX_FEE_RATE
}
