import Foundation

// Monetary-domain and arithmetic bounds only. LND owns liquidity, reserves,
// dust, peer limits and fee-floor validation.
enum LightningAmounts {
    static let maxChannelOpenSats: UInt64 = 10_000_000
    static let maxSats: UInt64 = 2_100_000_000_000_000
    // Signed LND fee product through 3x close negotiation and the maximum
    // consensus transaction size (1,000,000 vB), with 999 rounding headroom.
    static let maxFeeRate: UInt64 = 3_074_457_345 // (Int64.max - 999) / (3 * 1000 * 1_000_000)
    static func valid(_ sats: UInt64, allowZero: Bool = false) -> Bool {
        sats <= maxSats && (allowZero || sats > 0)
    }
    static func validFeeRate(_ rate: UInt64) -> Bool {
        rate > 0 && rate <= maxFeeRate
    }
}
