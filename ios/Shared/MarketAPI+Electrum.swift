//
//  MarketAPI+Electrum.swift
//  BlueWallet
//
//  Created by Marcos Rodriguez on 11/8/20.
//  Copyright © 2020 BlueWallet. All rights reserved.
//

import Foundation

struct APIError: LocalizedError {
  var errorDescription: String = "Failed to fetch Electrum data..."
}

extension MarketAPI {

    static func fetchNextBlockFee() async throws -> MarketData {
        // The inherited native client has BTC peers and no XBT checkpoint check.
        throw APIError(errorDescription: "XBT market fee data is unavailable.")
    }

    static func fetchMarketData(currency: String) async throws -> MarketData {
        var marketDataEntry = MarketData(nextBlock: "...", sats: "...", price: "...", rate: 0)
        
        do {
            if let priceResult = try await fetchPrice(currency: currency) {
                marketDataEntry.rate = priceResult.rateDouble
                marketDataEntry.price = priceResult.formattedRate ?? "!"
                print("Fetched price data: rateDouble=\(priceResult.rateDouble), formattedRate=\(priceResult.formattedRate ?? "nil")") 
            }
        } catch {
            print("Error fetching price: \(error.localizedDescription)")
        }

        do {
            let nextBlockData = try await fetchNextBlockFee()
            marketDataEntry.nextBlock = nextBlockData.nextBlock
            print("Fetched next block fee data: nextBlock=\(nextBlockData.nextBlock)")
        } catch {
            print("Error fetching next block fee: \(error.localizedDescription)") 
            marketDataEntry.nextBlock = "!"
        }

        marketDataEntry.sats = numberFormatter.string(from: NSNumber(value: Double(10 / marketDataEntry.rate) * 10000000)) ?? "!"
        print("Calculated sats: \(marketDataEntry.sats)") 
        
        return marketDataEntry
    }

    static func fetchMarketData(currency: String, completion: @escaping (Result<MarketData, Error>) -> ()) {
        Task {
            do {
                let marketData = try await fetchMarketData(currency: currency)
                completion(.success(marketData))
            } catch {
                completion(.failure(error))
            }
        }
    }
}

