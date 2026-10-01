/** Suppress Safari's automatic focus zoom before the password field is used.
 * Safari still permits manual pinch zoom. Restore the exact viewport on exit;
 * never apply this setting to browsers that enforce maximum-scale for pinch.
 */
export function preventWalletFocusZoom() {
  const ua = navigator.userAgent;
  if (!/iPhone|iPad|iPod/.test(ua) || !/Version\/.*Safari\//.test(ua)) {
    return;
  }
  const viewport = document.querySelector<HTMLMetaElement>(
    'meta[name="viewport"]',
  );
  if (!viewport) return;
  const original = viewport.content;
  const guarded = `${original
    .split(",")
    .filter((part) => !/^\s*maximum-scale\s*=/i.test(part))
    .join(",")}, maximum-scale=1`;
  viewport.content = guarded;
  return () => {
    // Do not overwrite a subsequent viewport change by another owner.
    if (viewport.content === guarded) viewport.content = original;
  };
}
