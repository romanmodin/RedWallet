import Foundation

class Balance {
    static func formatBalance(_ balance: Decimal, toUnit: BitcoinUnit, withFormatting: Bool = false, completion: @escaping (String) -> Void) {
      switch toUnit {
      case .sats:
        if withFormatting {
          completion(NumberFormatter.localizedString(from: balance as NSNumber, number: .decimal) + " SATS")
        } else {
          completion("\(balance) SATS")
        }
      case .localCurrency:
        fetchLocalCurrencyEquivalent(satoshi: balance, completion: completion)
        
      default:
        let value = balance / Decimal(100_000_000)
        completion("\(value) XBT") // Localize unit names as needed.
      }
    }

    private static func fetchLocalCurrencyEquivalent(satoshi _: Decimal, completion: @escaping (String) -> Void) {
        // Cached native market data may contain BTC prices.
        completion("N/A")
    }
}

extension Decimal {
  func formatted(as unit: BitcoinUnit, withFormatting: Bool = false) -> String {
        switch unit {
        case .sats:
            return withFormatting ? NumberFormatter.localizedString(from: self as NSNumber, number: .decimal) + " SATS" : "\(self) SATS"
        case .localCurrency:
            // Do not convert XBT with inherited or cached BTC market data.
            return "N/A"
        default:
            let value = self / Decimal(100_000_000)
            return "\(value) XBT"
        }
    }
}
