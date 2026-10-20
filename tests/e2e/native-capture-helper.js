import { createHash } from 'node:crypto';

// Native local bounds describe the UIKit layout, unlike fixed-orientation
// simulator framebuffer pixels. Missing or ambiguous attributes fail closed.
export function nativeCaptureEvidence(png, before, after, orientation) {
  if (!['portrait', 'landscape'].includes(orientation)) throw new Error('Invalid requested orientation');
  if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || png.toString('ascii', 12, 16) !== 'IHDR')
    throw new Error('Invalid native PNG capture');
  const pixels = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  const bounds = attributes => {
    const value = attributes.elementBounds;
    if (!value || !Number.isFinite(value.width) || !Number.isFinite(value.height) || value.width <= 0 || value.height <= 0)
      throw new Error('Missing native surface bounds');
    return { width: value.width, height: value.height };
  };
  if (!pixels.width || !pixels.height) throw new Error('Invalid native PNG dimensions');
  return { orientation, pixels, before: bounds(before), after: bounds(after), sha256: createHash('sha256').update(png).digest('hex') };
}

export function matchesNativeOrientation(evidence) {
  return [evidence.before, evidence.after].every(bounds =>
    evidence.orientation === 'landscape' ? bounds.width > bounds.height : bounds.height > bounds.width,
  );
}

// One harmless repeat only after a positive, stable observation that UIKit did
// not rotate. Keep both requests inside the original 15-second settling budget.
export function shouldRepeatOrientation(evidence, elapsed, requests) {
  return (
    requests === 1 &&
    elapsed >= 5000 &&
    elapsed < 10000 &&
    !matchesNativeOrientation(evidence) &&
    evidence.before.width === evidence.after.width &&
    evidence.before.height === evidence.after.height &&
    evidence.before.width !== evidence.before.height
  );
}
