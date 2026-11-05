# RC4 final candidate handoff — November 5, 2026

Candidate: romanmodin/kilowallet-ios PR12, source556fe57656c9ccac193023466c104ef324b08770, branch release/v100rc4-preserve-wallets-20261105. Published and read back; PR remains draft and unmerged. Original RC2db16f258 worktree is preserved.

The candidate includes the supported US-only encryption declaration (explicit Boolean NO, no compliance code), peer-independent SERVER_ACTIVE tower registration with actual registry readback, honest registration status, all seven language translations, and restore readiness after UI frames. The strict restore OCR expectation is 0 words: the actual Welcome screen also contains recovery words, which failed to distinguish the screen in the first two macOS runs.

Actual local evidence:91appdesktop tests passed after adding translations;166coreJVM XML records passed (four optional external no-ops). Twenty-three capture/runtime/startup checker cases passed. An isolated desktop render and eight RPC tests passed on the same shared code before the later translation/checker-only changes. JSON tables were reformatted surgically afterwards with full semantic equality verified. None of this is physical-iPhone or funded-recovery evidence.

Actual source556fe57 standalone macOS checker42069148471/attempt1/job127391845642 PASSED. Actual checkout and negative Welcome/positive Restore tests verified from the log. Automatic PR checker42069725055 and full native42069725060/attempt1/job127394003433 were started by the single guarded PR source push and are pending. Do not dispatch duplicate native jobs.

Independent Tor clients could not reach the supplied Lightning peer or watchtower at16:31Z and16:56Z. The Tor client bootstrapped100% and returned SOCKS host-unreachable/descriptor unavailable. This is TCP reachability evidence, not a statement that the service is permanently down. All actual onion-peer and tower-registration gates remain required. Device compilation now runs if the simulator built even if a live endpoint check fails; a failed runtime step still fails the job and blocks signing.

NEXT: collect new native/checker actual artifacts/API hashes/CRC, exact checkout tree, native runtime results, all68images (especially the actual iOS restore field), and unsigned arm64 Release. Collect exact-source old0.4/0.4.1 migration and isolation runs in qualification-556fe57-migrations. Preserve evidence on failure, resolve the concrete cause and do not substitute an old source or clearnet connection for onion proof.

The signing workflow and verify_gates pins are deliberately STILL HISTORICAL/INACTIVE (59b13da and its old run IDs). They must be updated from successful exact current receipts only after full qualification, tested, checked in hosted CI and merged with current publisher main through the existing guarded process. This handoff does not activate signing or upload.

The package checker prepared in3bc63ed must require Booleanfalse and no export compliance code for this US-only release, while retaining all team/bundle/version/signature/architecture/framework/background/source checks. Its20local release tests already passed. Today’s Apple questionnaire explicitly required no document upload for standard outside-OS encryption and FranceNo; no ECCN, CCATS or approved code exists. Do not reinstate the obsolete documentation blocker or reuse rejected1.0build5.

Verify an actual corrected signed IPA, upload, Apple processingVALID, beta review and original-group access before claiming1.0TestFlight availability. Preserve existing0.4public review until the replacement qualifies. No signing/upload/Apple writes or real funds were used during this handoff preparation.

## US-only upload preflight

The corrected 1.0 package is supported by the US-only/FranceNo questionnaire scope. Before Transporter runs, verify_territories.py now performs GET-only Apple identity/availability reads, requires exactly USA with automatic new-territory availability disabled, and follows bounded validated pagination. Unexpected, missing or expanded territory state blocks upload. Its receipt binds the exact package/run/source and is retained with release evidence. It changes no App Store settings. Thirty-two offline release-verification tests pass (twelve territory cases plus existing twenty). Hosted verifier-only qualification remains separate from final app native/runtime qualification. Historical source/run pins remain INACTIVE and must be advanced only from fully qualified receipts.
