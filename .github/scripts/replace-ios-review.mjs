// Prepared for the v4 replacement. No CLI/credential access: wire only after
// actual new signed/uploaded/TestFlight receipt pins have been verified.
// Apple documents `canceled: boolean` on ReviewSubmissionUpdateRequest.Data.Attributes.
export const REPLACEMENT_SOURCE = "814c1ebaccb9ba45544344b3cb7b8534a10ae2a9";
export const OLD_REVIEW = "f0c09fab-a918-4dd4-8a65-1a2c355b1e79";
export const OLD_BUILD = "0f7add33-d28d-4d33-905d-bddbb1faad67";
const APP = "6817118871";
const VERSION = "65cd6bc4-9962-4b77-a3ca-78c115f3a615";
const GROUPS = [
  "0bc2722a-48b6-4520-871d-dd5a4a8988cb",
  "463ff340-3283-4f17-949d-39c7aa929da2",
];
export class ReplacementError extends Error {}
function check(ok, message) {
  if (!ok) throw new ReplacementError(message);
}
async function ready(api, candidate) {
  check(
    candidate.sourceCommit === REPLACEMENT_SOURCE &&
      /^[A-Za-z0-9-]+$/.test(candidate.appleBuildId || "") &&
      candidate.appleBuildId !== OLD_BUILD &&
      /^\d+$/.test(candidate.build || "") &&
      BigInt(candidate.build) > 1792915404n,
    "Replacement does not identify the new qualified release",
  );
  const root = "/v1/builds/" + candidate.appleBuildId;
  const build = (await api("GET", root)).data;
  check(
    build?.id === candidate.appleBuildId &&
      build.attributes?.version === candidate.build &&
      build.attributes.processingState === "VALID" &&
      build.attributes.expired === false &&
      build.attributes.usesNonExemptEncryption === false,
    "Replacement build is not ready",
  );
  const app = (await api("GET", root + "/app")).data;
  const release = (await api("GET", root + "/preReleaseVersion")).data;
  check(
    app?.id === APP &&
      release?.attributes?.version === "8.0.1" &&
      release.attributes.platform === "IOS",
    "Replacement belongs to another app or version",
  );
  const beta = (await api("GET", root + "/buildBetaDetail")).data;
  // Apple exposes beta groups through the build's include relationship. The
  // direct /builds/{id}/betaGroups route returned 403 for this app, while the
  // documented build-details query is also used by our verified beta delivery.
  const groupInfo = await api("GET", root, undefined, {
    include: "betaGroups",
  });
  const relation = groupInfo.data?.relationships?.betaGroups;
  const groupIds = relation?.data;
  check(
    groupInfo.data?.id === candidate.appleBuildId &&
      groupInfo.data.attributes?.version === candidate.build &&
      Array.isArray(groupIds) &&
      !relation.links?.next &&
      (!relation.meta?.paging || relation.meta.paging.total <= groupIds.length),
    "Incomplete TestFlight group relationship for replacement build",
  );
  const groups = (groupInfo.included || []).filter(
    (x) =>
      x.type === "betaGroups" &&
      groupIds.some((g) => g.type === "betaGroups" && g.id === x.id),
  );
  check(
    beta?.attributes?.internalBuildState === "IN_BETA_TESTING" &&
      beta.attributes.externalBuildState === "IN_BETA_TESTING" &&
      Array.isArray(groups) &&
      GROUPS.every((g) => groups.some((x) => x.id === g)),
    "Replacement TestFlight delivery is not verified",
  );
}
async function snapshot(api) {
  const version = (await api("GET", "/v1/appStoreVersions/" + VERSION)).data;
  check(
    version?.id === VERSION &&
      version.attributes?.versionString === "8.0.1" &&
      version.attributes.platform === "IOS" &&
      version.attributes.releaseType === "AFTER_APPROVAL",
    "Unexpected release identity or mode",
  );
  const selected = (
    await api("GET", "/v1/appStoreVersions/" + VERSION + "/build")
  ).data;
  return { state: version.attributes.appStoreState, selected: selected?.id };
}
// Caller must first validate the exact-source gates and signed receipt artifacts.
// This function additionally reads live Apple readiness; it never selects or submits a build.
// No mutation retries, including after uncertain HTTP outcomes.
export async function withdrawSupersededReview(
  api,
  candidate,
  report,
  { readOnly = false } = {},
) {
  await ready(api, candidate);
  let live = await snapshot(api);
  if (
    live.selected === candidate.appleBuildId &&
    ["WAITING_FOR_REVIEW", "IN_REVIEW"].includes(live.state)
  ) {
    report.replacementStatus = "REPLACEMENT_ALREADY_SUBMITTED";
    return report;
  }
  check(
    [OLD_BUILD, candidate.appleBuildId].includes(live.selected),
    "Preserve unexpectedly selected build",
  );
  const reviews = (
    await api("GET", "/v1/apps/" + APP + "/reviewSubmissions", undefined, {
      limit: "200",
    })
  ).data;
  const old = reviews.filter((r) => r.id === OLD_REVIEW);
  check(old.length === 1, "Expected superseded review is missing");
  const active = reviews.filter(
    (r) => !["COMPLETE", "CANCELED"].includes(r.attributes?.state),
  );
  check(
    active.length <= 1 && active.every((r) => r.id === OLD_REVIEW),
    "Another review must be preserved",
  );
  const review = (await api("GET", "/v1/reviewSubmissions/" + OLD_REVIEW)).data;
  check(
    review?.id === OLD_REVIEW &&
      review.attributes?.state === old[0].attributes?.state,
    "Superseded review changed during inspection",
  );
  const items = (
    await api(
      "GET",
      "/v1/reviewSubmissions/" + OLD_REVIEW + "/items",
      undefined,
      {
        limit: "200",
        include: "appStoreVersion",
        "fields[appStoreVersions]": "versionString,platform",
      },
    )
  ).data;
  check(
    items.length === 1 &&
      items[0].relationships?.appStoreVersion?.data?.id === VERSION,
    "Refuse to remove other review items",
  );
  const state = review.attributes.state;
  if (["CANCELING", "COMPLETING"].includes(state)) {
    report.replacementStatus = "WAITING_FOR_OLD_REVIEW_REMOVAL";
    return report;
  }
  if (["COMPLETE", "CANCELED"].includes(state)) {
    check(
      ["DEVELOPER_REJECTED", "PREPARE_FOR_SUBMISSION"].includes(live.state),
      "Completed review is not an editable withdrawal",
    );
    report.replacementStatus = "OLD_REVIEW_REMOVAL_VERIFIED";
    return report;
  }
  check(
    live.selected === OLD_BUILD &&
      ["WAITING_FOR_REVIEW", "IN_REVIEW"].includes(live.state) &&
      ["WAITING_FOR_REVIEW", "IN_REVIEW"].includes(state),
    "Old review is not safely replaceable",
  );
  check(
    !report.withdrawalRequested,
    "Prior withdrawal outcome remains unresolved; inspect the retained receipt before another attempt",
  );
  // Recheck the replacement and selected version immediately before the single write.
  await ready(api, candidate);
  const last = await snapshot(api);
  const lastReview = (await api("GET", "/v1/reviewSubmissions/" + OLD_REVIEW))
    .data;
  check(
    last.selected === OLD_BUILD &&
      last.state === live.state &&
      lastReview?.attributes?.state === state,
    "Release changed before withdrawal",
  );
  if (readOnly) {
    report.replacementStatus = "WITHDRAWAL_PREFLIGHT_PASSED";
    report.readOnly = true;
    return report;
  }
  report.supersededReviewId = OLD_REVIEW;
  report.withdrawalRequested = true;
  await api("PATCH", "/v1/reviewSubmissions/" + OLD_REVIEW, {
    data: {
      type: "reviewSubmissions",
      id: OLD_REVIEW,
      attributes: { canceled: true },
    },
  });
  const result = (await api("GET", "/v1/reviewSubmissions/" + OLD_REVIEW)).data;
  live = await snapshot(api);
  check(live.selected === OLD_BUILD, "Selected build changed after withdrawal");
  report.supersededReviewState = result?.attributes?.state;
  report.appStoreState = live.state;
  if (
    ["COMPLETE", "CANCELED"].includes(report.supersededReviewState) &&
    ["DEVELOPER_REJECTED", "PREPARE_FOR_SUBMISSION"].includes(live.state)
  ) {
    report.replacementStatus = "OLD_REVIEW_REMOVAL_VERIFIED";
  } else {
    report.replacementStatus = "WAITING_FOR_OLD_REVIEW_REMOVAL";
  }
  return report;
}
