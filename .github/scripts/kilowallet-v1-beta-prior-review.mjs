import assert from "node:assert/strict";
import { APP } from "./kilowallet-v1-beta-plan.mjs";

// Previous qualified 1.0.0 build, already submitted to external beta review.
// This module accepts a GET reader only and never withdraws or changes a review.
export const PRIOR_BUILD = "efc0adfd-12df-4c95-8fa5-479b1e516563";
export const PRIOR_PATH = "/v1/builds/" + PRIOR_BUILD +
  "?include=app,preReleaseVersion,buildBetaDetail,betaAppReviewSubmission";

export async function readPriorReview(get, now = () => Date.now()) {
  const body = await get(PRIOR_PATH), build = body?.data;
  assert.equal(build?.type, "builds");
  assert.equal(build.id, PRIOR_BUILD);
  assert.equal(build.attributes?.version, "8");
  assert.ok(Array.isArray(body.included));
  const included = (name, type) => {
    const ref = build.relationships?.[name]?.data;
    assert.equal(ref?.type, type);
    const matches = body.included.filter(x => x.type === type && x.id === ref.id);
    assert.equal(matches.length, 1, "Missing or duplicate related resource");
    return matches[0];
  };
  const app = included("app", "apps");
  assert.equal(app.id, APP);
  assert.equal(app.attributes?.bundleId, "com.kilombino.kilowallet");
  const train = included("preReleaseVersion", "preReleaseVersions");
  assert.equal(train.attributes?.version, "1.0.0");
  assert.equal(train.attributes?.platform, "IOS");
  const detail = included("buildBetaDetail", "buildBetaDetails");
  assert.equal(typeof detail.attributes?.externalBuildState, "string");
  assert.ok(Object.hasOwn(build.relationships || {}, "betaAppReviewSubmission"));
  const reviewRef = build.relationships.betaAppReviewSubmission.data;
  const review = reviewRef === null ? null :
    included("betaAppReviewSubmission", "betaAppReviewSubmissions");
  if (review) assert.ok(["WAITING_FOR_REVIEW", "IN_REVIEW", "REJECTED", "APPROVED"]
    .includes(review.attributes?.betaReviewState), "Unknown beta review state");
  const state = review?.attributes?.betaReviewState || null;
  const active = ["WAITING_FOR_REVIEW", "IN_REVIEW"].includes(state);
  // Do not treat an inconsistent or unknown relationship as permission to retry.
  assert.equal(active, ["WAITING_FOR_BETA_REVIEW", "IN_BETA_REVIEW"]
    .includes(detail.attributes.externalBuildState), "Inconsistent prior review status");
  return { complete: true, readOnly: true, observedAt: new Date(now()).toISOString(),
    appId: APP, buildId: PRIOR_BUILD, version: "1.0.0", build: "8",
    externalState: detail.attributes.externalBuildState, reviewId: review?.id || null,
    reviewState: state, blocksAnotherBuildReview: active };
}
