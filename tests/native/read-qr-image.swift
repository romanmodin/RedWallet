import Foundation
import CoreImage

guard CommandLine.arguments.count == 2,
      let image = CIImage(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])),
      let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: CIContext(), options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]) else {
    fputs("Cannot read QR image\n", stderr)
    exit(1)
}
let values = detector.features(in: image).compactMap { ($0 as? CIQRCodeFeature)?.messageString }
let data = try JSONSerialization.data(withJSONObject: values)
print(String(decoding: data, as: UTF8.self))
