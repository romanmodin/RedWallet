// Offline release preparation gate. No transport, credentials, CLI or Apple writes.
import assert from "node:assert/strict";
import { APP, GROUPS } from "./kilowallet-v1-beta-plan.mjs";
const SOURCE = "68461ec5b6d5bde5a92533a78b15a6594605cb2f";
const IPA = "afb6ddb5f9685eacb0256c62cdeea76731739f823c43fa34a1c8eef596ae582d";
const BUILD = "efc0adfd-12df-4c95-8fa5-479b1e516563";
const BUNDLE = "com.kilombino.kilowallet";
function fresh(value, now) {
  const t = Date.parse(value);
  assert.ok(Number.isFinite(t) && t <= now && now - t <= 300000, "Fresh live evidence required");
}
export function publicReadiness({beta, listing, metadata, visual, privacy}, now = Date.now()) {
  const blockers = [];
  fresh(beta.observedAt, now); fresh(listing.observedAt, now);
  assert.equal(beta.complete, true); assert.equal(beta.readOnly, true);
  assert.equal(beta.app, APP); assert.equal(beta.buildId, BUILD);
  assert.equal(beta.marketingVersion, "1.0.0"); assert.equal(beta.build, "8");
  assert.equal(beta.sourceCommit, SOURCE); assert.equal(beta.ipaSha256, IPA);
  assert.equal(beta.uploadRunId, 42137139153); assert.equal(beta.uploadRunAttempt, 1);
  assert.deepEqual(beta.writes, []);
  assert.equal(beta.memberships?.length, GROUPS.length);
  assert.equal(new Set(beta.memberships.map(m => m.id)).size, GROUPS.length);
  for (const group of GROUPS) {
    const m = beta.memberships.find(m => m.id === group.id);
    assert.ok(m, "Exact original groups required");
    if (m.buildSide !== true || m.groupSide !== true) blockers.push("Tester group membership not verified in both directions: " + group.id);
  }
  assert.equal(beta.review?.buildId, BUILD);
  if (beta.internalState !== "IN_BETA_TESTING" || beta.externalState !== "IN_BETA_TESTING" || beta.review.state !== "APPROVED" || beta.available !== true)
    blockers.push("Exact build8 is not yet installable by both original groups");
  assert.equal(listing.mode, "read-only"); assert.equal(listing.inspectionComplete, true);
  assert.deepEqual(listing.errors, []); assert.equal(listing.appId, APP);
  assert.equal(listing.app?.id, APP); assert.equal(listing.app?.bundleId, BUNDLE);
  assert.deepEqual(listing.availability?.territories, ["USA"]);
  assert.equal(listing.availability.availableInNewTerritories, false);
  // The preflight's historical uploadedBuild3 is deliberately not candidate proof.
  const versions = listing.appStoreVersions;
  assert.ok(Array.isArray(versions) && versions.length > 0);
  assert.equal(new Set(versions.map(v => v.id)).size, versions.length);
  const existing = versions.find(v => v.id === "1ca23695-4563-4a0e-b20e-d1a6457f4f8b");
  assert.equal(existing?.version, "0.4.0"); assert.equal(existing.platform, "IOS");
  if (!["WAITING_FOR_REVIEW", "IN_REVIEW"].includes(existing.state))
    blockers.push("Existing public version changed; reconcile without deleting or withdrawing it");
  if (versions.some(v => v.id !== existing.id)) blockers.push("Additional public version requires reconciliation");
  for (const [key, expected] of Object.entries({app:APP,bundleId:BUNDLE,marketingVersion:"1.0.0",build:"8",appleBuildId:BUILD,sourceCommit:SOURCE,ipaSha256:IPA})) assert.equal(metadata[key], expected);
  assert.equal(metadata.submittedToApple, false); assert.equal(metadata.legalAttestations, null);
  for (const key of ["agreementAcceptance", "deletePublicVersion", "withdrawOtherApps"]) assert.equal(metadata[key], false);
  assert.equal(metadata.proposedMetadata?.locale, "en-US");
  for (const key of ["description", "reviewNotes"]) assert.ok(typeof metadata.proposedMetadata[key] === "string" && metadata.proposedMetadata[key].trim() && metadata.proposedMetadata[key].length <= 4000);
  const n = metadata.additionalNativeVerification;
  assert.equal(n.run, 42136946441); assert.equal(n.attempt, 2); assert.equal(n.job, 127672233917);
  assert.equal(n.sameTreeAsSignedSource, true); assert.equal(n.runtimeAllEightPassed, true);
  assert.equal(n.arm64ReleasePassed, true); assert.equal(n.unitXmlRecords, 429); assert.equal(n.unsuccessful, 0);
  if (n.visualApproved !== true || n.publicAdvanceApproved !== true || visual?.run !== 42163150260 || visual?.attempt !== 1 || visual?.job !== 127713335608 || visual?.capturePassed !== true || visual?.nativeQualificationPassed !== true || visual?.framesReviewed !== 4 || visual?.allTextRendered !== true || !/^[0-9a-f]{64}$/.test(visual?.artifactSha256 || ""))
    blockers.push("Live Lightning visual hold is unresolved");
  if (privacy?.app !== APP || privacy?.sourceCommit !== SOURCE || privacy?.buildId !== BUILD || privacy?.labelsReconciled !== true || privacy?.actualHttpsBridgeDisclosed !== true || privacy?.arkRetentionDisclosed !== true || privacy?.legalAttestations !== null)
    blockers.push("Live privacy labels and service disclosures still require reconciliation");
  return {app:APP,buildId:BUILD,build:"8",sourceCommit:SOURCE,readyForPublicPreparation:blockers.length===0,blockers,existingVersion:existing,appleWrites:[],preserveExistingReview:true,submissionAuthorizedByThisReport:false};
}
