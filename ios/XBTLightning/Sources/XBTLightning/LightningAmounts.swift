import Foundation

// Monetary-domain and arithmetic bounds only. LND owns liquidity, reserves,
// dust, peer limits and fee-floor validation.
enum LightningAmounts {
    static let maxChannelOpenSats: UInt64 = 10_000_000
    static let maxSats: UInt64 = 2_100_000_000_000_000
    // 3x cooperative-close negotiation, then sat/vB -> sat/kvB.
    static let maxFeeRate: UInt64 = 3_002_399_751_580_330 // JS MAX_SAFE_INTEGER / 3
    static func valid(_ sats: UInt64, allowZero: Bool = false) -> Bool {
        sats <= maxSats && (allowZero || sats > 0)
    }
    static func validFeeRate(_ rate: UInt64) -> Bool {
        rate > 0 && rate <= maxFeeRate
    }
}
