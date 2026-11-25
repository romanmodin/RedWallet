import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

export const connectionClockDiameter = 70;
const tickCount = 36;
const tickPaths = Array.from({ length: tickCount }, (_, index) => {
  const angle = -Math.PI / 2 - (2 * Math.PI * index) / tickCount;
  const innerRadius = index % 9 === 0 ? 10.2 : 11.4;
  const x = Math.cos(angle);
  const y = Math.sin(angle);
  return `M${(18 + innerRadius * x).toFixed(2)} ${(18 + innerRadius * y).toFixed(2)} L${(18 + 16.5 * x).toFixed(2)} ${(18 + 16.5 * y).toFixed(2)}`;
});
const track = tickPaths.join(' ');
const wrappedTicks = [...tickPaths, ...tickPaths];

function secondsLabel(milliseconds: number) {
  const seconds = Math.max(1, Math.ceil(milliseconds / 1000));
  return seconds === 1 ? '1 second' : seconds + ' seconds';
}

export default function LndConnectionClock({ startedAt, averageMs }: { startedAt: number; averageMs?: number }) {
  const [now, setNow] = useState(() => performance.now());
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let useInitialPreference = true;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', enabled => {
      useInitialPreference = false;
      setReduceMotion(enabled);
    });
    AccessibilityInfo.isReduceMotionEnabled().then(
      enabled => {
        if (useInitialPreference) setReduceMotion(enabled);
      },
      () => {}, // Keep a stationary indicator if the preference is unavailable.
    );
    return () => {
      useInitialPreference = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const timer = setInterval(() => setNow(performance.now()), 500);
    return () => clearInterval(timer);
  }, [reduceMotion]);

  const elapsed = Math.max(0, now - startedAt);
  let value = 'Learning your usual connection time.';
  let count = 5;
  let offset = reduceMotion ? 0 : Math.floor(elapsed / 500) % tickCount;
  if (averageMs !== undefined) {
    const remaining = averageMs - elapsed;
    if (reduceMotion) {
      value = `Recent connections averaged about ${secondsLabel(averageMs)}.`;
    } else if (remaining > 0) {
      value = `About ${secondsLabel(remaining)} left, based on recent connections.`;
      count = Math.max(1, Math.ceil((remaining / averageMs) * (tickCount - 1)));
      offset = 0;
    } else {
      value = 'Still connecting. This is taking longer than your recent average.';
    }
  }
  const litTicks = wrappedTicks.slice(offset, offset + count).join(' ');
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Connecting to Lightning" accessibilityValue={{ text: value }}>
      <Svg width={connectionClockDiameter} height={connectionClockDiameter} viewBox="0 0 36 36" accessible={false}>
        <Path d={track} fill="none" stroke="#C4C9D0" strokeOpacity={0.45} strokeWidth={1.5} />
        <Path d={litTicks} fill="none" stroke="#D8E2F2" strokeOpacity={0.28} strokeWidth={2.8} />
        <Path d={litTicks} fill="none" stroke="#F3F6FB" strokeWidth={1.5} />
      </Svg>
    </View>
  );
}
