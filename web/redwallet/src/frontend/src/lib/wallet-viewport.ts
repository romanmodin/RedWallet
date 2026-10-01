/** Release Safari's retained password-focus zoom after a successful unlock.
 * The viewport clamp is temporary: restore the exact original setting so
 * ordinary pinch zoom remains available. Other browsers are left alone.
 */
export function restoreWalletViewport() {
  const ua = navigator.userAgent;
  if (
    !/iPhone|iPad|iPod/.test(ua) ||
    !/Version\/.*Safari\//.test(ua) ||
    !(window.visualViewport && window.visualViewport.scale > 1.01)
  ) {
    return;
  }
  const viewport = document.querySelector<HTMLMetaElement>(
    'meta[name="viewport"]',
  );
  if (!viewport) return;
  const original = viewport.content;
  const reset = `${original
    .split(",")
    .filter((part) => !/^\s*(initial|minimum|maximum)-scale\s*=/i.test(part))
    .join(",")}, initial-scale=1, minimum-scale=1, maximum-scale=1`;
  viewport.content = reset;
  window.setTimeout(() => {
    // Do not overwrite a subsequent viewport change by another owner.
    if (viewport.content === reset) viewport.content = original;
  }, 350);
}
