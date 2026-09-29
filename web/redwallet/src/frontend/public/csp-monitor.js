// Runs before deferred app code. Records only one browser enforcement event;
// no requests, identifiers, wallet data, persistence, or reporting endpoint.
(() => {
  document.documentElement.dataset.remoteScriptProtection = "waiting";
  document.addEventListener("securitypolicyviolation", (event) => {
    if (
      event.isTrusted &&
      event.disposition === "enforce" &&
      (event.effectiveDirective === "script-src-elem" ||
        event.effectiveDirective === "script-src") &&
      (event.blockedURI === "https://cdn.caffeine.ai/scripts/umami-script.js" ||
        event.blockedURI === "https://cdn.caffeine.ai")
    ) {
      document.documentElement.dataset.remoteScriptProtection = "blocked";
    }
  });
})();
