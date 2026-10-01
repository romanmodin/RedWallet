# 0.35 — stabilize iPhone control text sizing

Prepared source; publication and iPhone verification pending. User verified0.34
connection switching works and phone unlock preserves history. User reports
slight viewport enlargement after wallet lock/unlock and moving between views;
screenshot shows content extending beyond the left edge. Exact Safari behavior
cannot be reproduced by desktop Chromium and is not claimed fixed yet.

Touch-device text/password/number controls, textareas and selects now use at
least16CSSpx, including wider layouts with coarse pointers. This overrides the
shared input desktop14px breakpoint and small inherited scan-select text.
HTML text-size-adjust stays100% across wallet-panel and route changes. The
viewport remains device-width/initial-scale1; pinch zoom and user page zoom
remain available. No zoom-reset scripts or viewport scale restrictions added.

Typecheck PASS; Biome217 PASS; production build PASS; existing metadata/CSP/
network display22tests PASS. Generated CSS includes the coarse-pointer override
and100% text-size-adjust. Existing RN ancestor-config/Browserslist warnings.
No backend, bridge, networking, key/vault, scan/history or native app changes.
Caffeine exact export comparison and unchanged backend hash required before
publication. Backend expected SHA256
6726b411d9be5eb91b8a7f31ad18c9e415da13dc4b948b49fe027ec005a05001.
Final iPhone check: refresh0.35, unlock/lock and switch app views; verify no
unrequested enlargement while manual pinch zoom remains usable.
