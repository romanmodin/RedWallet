import { type ReactNode, useEffect, useRef, useState } from "react";

// Deliberately independent of the release number: upgrades do not replay it.
const SEEN_KEY = "redwallet.intro.seen";

export function FirstLaunchSplash({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) !== "1";
    } catch {
      // Storage unavailable: never trap users in an intro on every launch.
      return false;
    }
  });
  const skip = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!visible) return;
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      setVisible(false);
      return;
    }
    skip.current?.focus();
    const timer = window.setTimeout(() => setVisible(false), 15000);
    return () => window.clearTimeout(timer);
  }, [visible]);
  if (!visible) return <>{children}</>;
  return (
    <main
      aria-label="Welcome to RedWallet"
      className="fixed inset-0 z-[100] flex min-h-dvh flex-col items-center justify-center gap-6 bg-black text-white"
    >
      <video
        src="/assets/intro/redwallet-intro.mp4"
        aria-label="XBT BLAKE2B introduction"
        autoPlay
        muted
        playsInline
        disablePictureInPicture
        disableRemotePlayback
        preload="auto"
        onEnded={() => setVisible(false)}
        onError={() => setVisible(false)}
        style={{
          width: "min(80vw, 46dvh)",
          height: "60dvh",
          objectFit: "contain",
        }}
      />
      <button
        ref={skip}
        type="button"
        onClick={() => setVisible(false)}
        className="rounded-full border border-white/30 px-6 py-3 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      >
        Continue to RedWallet
      </button>
      <p className="text-xs text-white/50">RedWallet 0.40 · Preview</p>
    </main>
  );
}
