import { createPrivateKey, sign } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const APP_ID = "6817118871";
export const BUNDLE_ID = "com.romanmodin.redwallet";
export const VERSION = "8.0.1";
const ORIGIN = "https://api.appstoreconnect.apple.com";
const allowedPath =
  /^\/v1\/(?:apps\/6817118871(?:\/(?:appStoreVersions|appInfos))?|appInfos\/[A-Za-z0-9-]+\/appInfoLocalizations|appStoreVersions\/[A-Za-z0-9-]+\/(?:build|appStoreReviewDetail|appStoreVersionLocalizations)|appStoreVersionLocalizations\/[A-Za-z0-9-]+\/appScreenshotSets|appScreenshotSets\/[A-Za-z0-9-]+\/appScreenshots)$/;

export function makeToken(config, now = Math.floor(Date.now() / 1000)) {
  try {
    if (
      typeof config.key_id !== "string" ||
      typeof config.issuer_id !== "string" ||
      !/^[A-Za-z0-9]+$/.test(config.key_id) ||
      !/^[A-Za-z0-9-]+$/.test(config.issuer_id)
    )
      throw Error();
    const raw = config.is_key_content_base64
      ? Buffer.from(config.key, "base64").toString("utf8")
      : config.key;
    const key = createPrivateKey(raw);
    if (
      key.asymmetricKeyType !== "ec" ||
      key.asymmetricKeyDetails.namedCurve !== "prime256v1"
    )
      throw Error();
    const encode = (obj) =>
      Buffer.from(JSON.stringify(obj)).toString("base64url");
    const input =
      encode({ alg: "ES256", kid: config.key_id, typ: "JWT" }) +
      "." +
      encode({
        iss: config.issuer_id,
        iat: now - 5,
        exp: now + 600,
        aud: "appstoreconnect-v1",
      });
    return (
      input +
      "." +
      sign("sha256", Buffer.from(input), {
        key,
        dsaEncoding: "ieee-p1363",
      }).toString("base64url")
    );
  } catch {
    throw Error("Existing Apple API credential configuration is invalid");
  }
}

// There is intentionally no write method and redirects are rejected.
export function reader(token, request = fetch) {
  return async function get(path, query = {}, optional = false) {
    if (!allowedPath.test(path)) throw Error("Unexpected Apple resource");
    const url = new URL(path, ORIGIN);
    url.search = new URLSearchParams(query).toString();
    const response = await request(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
    });
    if (optional && response.status === 404) return { data: null };
    if (!response.ok) throw Error("Apple read failed: HTTP " + response.status);
    const result = await response.json();
    if (result.links?.next)
      throw Error("Incomplete Apple response; pagination requires review");
    return result;
  };
}

function resourceId(resource) {
  if (!resource || !/^[A-Za-z0-9-]+$/.test(resource.id))
    throw Error("Invalid Apple resource identity");
  return resource.id;
}
const present = (value) => typeof value === "string" && value.trim().length > 0;

export async function inspect(get, now = new Date().toISOString()) {
  const app = (await get("/v1/apps/" + APP_ID)).data;
  if (app?.id !== APP_ID || app.attributes?.bundleId !== BUNDLE_ID)
    throw Error("Wrong Apple app identity");
  const versions = (
    await get("/v1/apps/" + APP_ID + "/appStoreVersions", {
      "filter[platform]": "IOS",
      "filter[versionString]": VERSION,
      limit: "200",
    })
  ).data;
  const matches = versions.filter(
    (v) =>
      v.attributes?.platform === "IOS" &&
      v.attributes?.versionString === VERSION,
  );
  if (matches.length !== 1)
    throw Error("Expected exactly one RedWallet iOS 8.0.1 version");
  const version = matches[0],
    id = resourceId(version);
  const build = (await get("/v1/appStoreVersions/" + id + "/build", {}, true))
    .data;
  const details = (
    await get("/v1/appStoreVersions/" + id + "/appStoreReviewDetail", {}, true)
  ).data?.attributes;
  const locales = (
    await get("/v1/appStoreVersions/" + id + "/appStoreVersionLocalizations", {
      limit: "200",
    })
  ).data;
  const localizations = [];
  for (const locale of locales) {
    const attributes = locale.attributes || {};
    const sets = (
      await get(
        "/v1/appStoreVersionLocalizations/" +
          resourceId(locale) +
          "/appScreenshotSets",
        { limit: "200" },
      )
    ).data;
    const screenshots = [];
    for (const set of sets) {
      const images = (
        await get(
          "/v1/appScreenshotSets/" + resourceId(set) + "/appScreenshots",
          { limit: "200" },
        )
      ).data;
      screenshots.push({
        displayType: set.attributes?.screenshotDisplayType,
        count: images.length,
        images: images.map((image) => ({
          id: resourceId(image),
          state: image.attributes?.assetDeliveryState?.state || "UNKNOWN",
          checksum: image.attributes?.sourceFileChecksum || null,
          processingErrors: (
            image.attributes?.assetDeliveryState?.errors || []
          ).map((error) => ({
            code:
              typeof error.code === "string" &&
              /^[A-Za-z0-9_.-]{1,160}$/.test(error.code)
                ? error.code
                : "UNKNOWN",
            description:
              typeof error.description === "string"
                ? error.description
                    .replace(/https?:\/\/\S+/g, "[URL]")
                    .slice(0, 500)
                : "",
          })),
        })),
      });
    }
    localizations.push({
      id: locale.id,
      locale: attributes.locale,
      descriptionPresent: present(attributes.description),
      keywordsPresent: present(attributes.keywords),
      supportUrlPresent: present(attributes.supportUrl),
      screenshots,
    });
  }
  // App-wide metadata state is independent of a version's review state.
  // Retain only public policy information and resource identities.
  const infos = (
    await get("/v1/apps/" + APP_ID + "/appInfos", {
      limit: "200",
      "fields[appInfos]": "appStoreState,state",
    })
  ).data;
  const appInfos = [];
  for (const info of infos) {
    const localizations = (
      await get("/v1/appInfos/" + resourceId(info) + "/appInfoLocalizations", {
        limit: "200",
        "fields[appInfoLocalizations]": "locale,privacyPolicyUrl",
      })
    ).data;
    appInfos.push({
      id: resourceId(info),
      appStoreState: info.attributes?.appStoreState ?? null,
      state: info.attributes?.state ?? null,
      localizations: localizations.map((locale) => ({
        id: resourceId(locale),
        locale: locale.attributes?.locale ?? null,
        privacyPolicyUrl: locale.attributes?.privacyPolicyUrl ?? null,
      })),
    });
  }
  return {
    appInfos,
    checkedAt: now,
    appId: APP_ID,
    bundleId: BUNDLE_ID,
    version: VERSION,
    appStoreVersionId: id,
    appStoreState: version.attributes.appStoreState,
    releaseType: version.attributes.releaseType,
    selectedBuild: build
      ? {
          id: resourceId(build),
          build: build.attributes?.version,
          processingState: build.attributes?.processingState,
        }
      : null,
    review: {
      detailsPresent: !!details,
      contactComplete:
        !!details &&
        [
          "contactFirstName",
          "contactLastName",
          "contactPhone",
          "contactEmail",
        ].every((k) => present(details[k])),
      notesPresent: present(details?.notes),
      demoAccountRequired: details?.demoAccountRequired ?? null,
      demoCredentialsPresent:
        present(details?.demoAccountName) &&
        present(details?.demoAccountPassword),
    },
    localizations,
    readOnly: true,
    submittedByThisRun: false,
    limitation:
      "This snapshot does not qualify a build or establish complete App Review readiness. No app, metadata, screenshot, group, agreement, or submission was changed.",
  };
}

async function main() {
  try {
    const config = JSON.parse(
      process.env.APP_STORE_CONNECT_API_KEY_CONTENT || "",
    );
    const result = await inspect(reader(makeToken(config)));
    const report = JSON.stringify(result, null, 2) + "\n";
    writeFileSync("ios-store-readiness.json", report, { mode: 0o600 });
    process.stdout.write(report);
  } catch (error) {
    // Never include raw Apple responses, private review fields, credential values, or network diagnostics.
    const safe =
      /^(Existing Apple API credential configuration is invalid|Unexpected Apple resource|Apple read failed: HTTP \d+|Incomplete Apple response; pagination requires review|Invalid Apple resource identity|Wrong Apple app identity|Expected exactly one RedWallet iOS 8\.0\.1 version)$/;
    process.stderr.write(
      (safe.test(error.message)
        ? error.message
        : "Read-only Apple inspection failed") + "\n",
    );
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
