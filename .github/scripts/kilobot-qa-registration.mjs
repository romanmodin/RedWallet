import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { makeToken } from "./inspect-ios-store.mjs";

const bundle = "dev.kilowallet.tests.KilobotWallet";
const team = "PPG9C98EY9";
const origin = "https://api.appstoreconnect.apple.com";
const parent = "6824331953";
function single(result, type, attribute) {
  if (result.links?.next || !Array.isArray(result.data) || result.data.length > 1)
    throw Error("Apple returned an incomplete or ambiguous match");
  if (!result.data.length) return null;
  const item = result.data[0];
  if (item.type !== type || !/^[A-Za-z0-9-]+$/.test(item.id) ||
      item.attributes?.[attribute] !== bundle)
    throw Error("Apple returned another app identity");
  return item;
}

export async function ensureRegistration(request, register = false) {
  const owner = await request("/v1/apps/" + parent);
  if (owner.data?.id !== parent || owner.data?.attributes?.bundleId !== "com.kilombino.kilowallet")
    throw Error("The publishing account could not be verified");
  const findBundle = () => request("/v1/bundleIds?" + new URLSearchParams({"filter[identifier]":bundle,limit:"2"}));
  const findApp = () => request("/v1/apps?" + new URLSearchParams({"filter[bundleId]":bundle,limit:"2"}));
  const app = single(await findApp(), "apps", "bundleId");
  let identifier = single(await findBundle(), "bundleIds", "identifier");
  let created = false;
  if (!identifier && register) {
    try {
      const receipt = await request("/v1/bundleIds", {data:{type:"bundleIds",attributes:{
        identifier:bundle, name:"Kilobot QA", platform:"IOS"
      }}});
      single({data:[receipt.data]}, "bundleIds", "identifier");
      created = true;
    } catch (error) {
      if (error.status !== 409) throw error;
    }
    identifier = single(await findBundle(), "bundleIds", "identifier");
    if (!identifier) throw Error("Apple has not confirmed registration of the QA identifier");
  }
  if (identifier && (!["IOS","UNIVERSAL"].includes(identifier.attributes.platform) ||
      identifier.attributes.seedId !== team)) throw Error("Unexpected QA identifier platform or team prefix");
  return {observedAt:new Date().toISOString(),bundle,registeredBundleId:identifier?.id ?? null,
          createdBundle:created,appStoreConnectId:app?.id ?? null};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.TEAM_ID !== team) throw Error("Unexpected team");
  const token = makeToken(JSON.parse(process.env.APP_STORE_CONNECT_API_KEY_CONTENT));
  const request = async (path, body) => {
    const response = await fetch(new URL(path, origin), {
      method:body ? "POST":"GET", redirect:"error", signal:AbortSignal.timeout(30000),
      headers:{Authorization:"Bearer "+token, "Content-Type":"application/json"},
      body:body ? JSON.stringify(body):undefined
    });
    if (!response.ok) throw Object.assign(Error("Apple returned HTTP "+response.status),{status:response.status});
    return response.json();
  };
  const result = await ensureRegistration(request, process.env.REGISTER_QA === "true");
  writeFileSync("kilobot-qa-registration.json", JSON.stringify(result,null,2)+"\n");
  console.log(JSON.stringify(result));
}
