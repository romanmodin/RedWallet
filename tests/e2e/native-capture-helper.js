import { createHash } from 'node:crypto';

// open may reuse a running Simulator process and ignore its launch arguments.
// Start a dedicated GUI instance for the exact Detox device after app resets.
// This is driver setup, not proof of rotation: native bounds still must pass.
export function attachSimulatorForRotation(run, deviceId) {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(deviceId)) throw new Error('Invalid simulator UUID');
  const inventory = JSON.parse(
    run('xcrun', ['simctl', 'list', 'devices', '-j'], {
      encoding: 'utf8',
      timeout: 15000,
    }),
  );
  const booted = Object.values(inventory.devices)
    .flat()
    .filter(candidate => candidate.state === 'Booted');
  if (booted.length !== 1 || booted[0].udid !== deviceId) throw new Error('Rotation requires only the exact selected simulator booted');
  run('open', ['-n', '-a', 'Simulator', '--args', '-CurrentDeviceUDID', deviceId], { timeout: 15000 });
  return {
    requestedDeviceId: deviceId,
    bootedDeviceIds: booted.map(candidate => candidate.udid),
    newGuiInstanceRequested: true,
  };
}

// Native local bounds describe the UIKit layout, unlike fixed-orientation
// simulator framebuffer pixels. Missing or ambiguous attributes fail closed.
export function nativeCaptureEvidence(png, before, after, orientation, preCapture) {
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
  return {
    orientation,
    pixels,
    ...(preCapture ? { preCapture: bounds(preCapture) } : {}),
    before: bounds(before),
    after: bounds(after),
    sha256: createHash('sha256').update(png).digest('hex'),
  };
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

// A rotation is deliberately a non-idle UI transition. Observe the real native
// bounds directly instead of adding Detox idle drains to every probe. Restore
// normal synchronization even when observation or the transport fails.
export async function observeNativeRotation(device, observation) {
  try {
    await device.disableSynchronization();
    return await observation();
  } finally {
    await device.enableSynchronization();
  }
}
