import { PNG } from 'pngjs';

// Measure the light balance glyphs in the left half of the disposable card.
// Use the native row width to convert screenshot pixels to points on any simulator.
export function balanceInkHeight(png, widthPoints) {
  const { width, height, data } = PNG.sync.read(png);
  if (!Number.isFinite(widthPoints) || widthPoints <= 0) throw new Error('Missing wallet card width');
  const scanWidth = Math.floor(width / 2);
  let run = 0;
  let longest = 0;
  for (let y = 0; y < height; y++) {
    let ink = 0;
    for (let x = 0; x < scanWidth; x++) {
      const i = (y * width + x) * 4;
      if (Math.min(data[i], data[i + 1], data[i + 2]) >= 165 && data[i + 3] >= 160) ink++;
    }
    run = ink >= 2 && ink < scanWidth * 0.9 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return (longest * widthPoints) / width;
}

export function checkBalanceSamples(samples) {
  const baseline = samples[0].inkHeight;
  for (const { phase, inkHeight } of samples) {
    if (inkHeight < 14 || Math.abs(inkHeight - baseline) > 2) {
      throw new Error(
        `Wallet card text at ${phase} measured ${inkHeight.toFixed(1)} pt against the ${baseline.toFixed(1)} pt opening sample`,
      );
    }
  }
}
