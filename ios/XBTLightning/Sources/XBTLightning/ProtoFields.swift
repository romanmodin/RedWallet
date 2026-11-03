import Foundation

// Small wire reader for the pinned lnrpc messages used by the mobile test node.
// Unknown fields are skipped, and malformed/truncated messages fail closed.
struct ProtoFields {
    private(set) var integers: [UInt64: UInt64] = [:]
    private(set) var bytes: [UInt64: [Data]] = [:]

    init(_ message: Data) throws {
        var offset = message.startIndex
        func readInteger() throws -> UInt64 {
            var result: UInt64 = 0
            for shift in stride(from: 0, through: 63, by: 7) {
                guard offset < message.endIndex else { throw NodeFailure.invalidReply }
                let b = message[offset]
                offset += 1
                if shift == 63 && b > 1 { throw NodeFailure.invalidReply }
                result |= UInt64(b & 127) << shift
                if b < 128 { return result }
            }
            throw NodeFailure.invalidReply
        }
        func take(_ size: UInt64) throws -> Data {
            guard size <= UInt64(message.endIndex - offset) else { throw NodeFailure.invalidReply }
            let end = offset + Int(size)
            defer { offset = end }
            return message.subdata(in: offset..<end)
        }
        while offset < message.endIndex {
            let tag = try readInteger(), field = tag >> 3
            guard field > 0 && field <= 0x1fffffff else { throw NodeFailure.invalidReply }
            switch tag & 7 {
            case 0: integers[field] = try readInteger()
            case 1: _ = try take(8)
            case 2: bytes[field, default: []].append(try take(readInteger()))
            case 5: _ = try take(4)
            default: throw NodeFailure.invalidReply
            }
        }
    }

    static func integer(_ value: UInt64) -> Data {
        var current = value, result = Data()
        while current >= 128 {
            result.append(UInt8(current & 127) | 128)
            current >>= 7
        }
        result.append(UInt8(current))
        return result
    }

    static func field(_ number: UInt64, data: Data) -> Data {
        integer(number << 3 | 2) + integer(UInt64(data.count)) + data
    }
}
