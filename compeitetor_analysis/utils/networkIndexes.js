import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// These values preserve the existing competitor behavior only when a network
// is absent from the API's resolved configuration.
const FALLBACK_NETWORK_INDEXES = Object.freeze({
  facebook: "search_mix",
  instagram: "instagram_search_mix",
  youtube: "youtube_ads_data",
  google: "google_ads_data_v2",
  gdn: "gdn_search_mix_v2",
  native: "native_search_mix_v2",
  linkedin: "linkedin_ads_data",
  reddit: "reddit_search_mix",
  quora: "quora_search_mix",
  pinterest: "pinterest_search_mix",
  tiktok: "tiktok_ads",
});

// Use the same resolved `src/config/networks` contract as API scripts. The
// override supports deployments where the two services are not sibling dirs.
const API_ROOT = process.env.PAS_NODE_API_ROOT
  ? path.resolve(process.env.PAS_NODE_API_ROOT)
  : path.resolve(__dirname, "../../pas_node_api");

function loadApiNetworks() {
  try {
    const apiRequire = createRequire(path.join(API_ROOT, "package.json"));
    return apiRequire("./src/config/networks");
  } catch (error) {
    throw new Error(
      `Unable to load pas_node_api network configuration from ${API_ROOT}. `
      + "Set PAS_NODE_API_ROOT to the API project directory.",
      { cause: error },
    );
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function loadNetworkIndexes(networksConfig = loadApiNetworks()) {
  return Object.fromEntries(
    Object.entries(FALLBACK_NETWORK_INDEXES).map(([network, fallbackIndex]) => {
      const database = networksConfig[network]?.database || {};
      const configuredIndex = database.elastic?.index || database.elastic_tiktok?.index;
      return [network, isNonEmptyString(configuredIndex) ? configuredIndex.trim() : fallbackIndex];
    }),
  );
}

const NETWORK_INDEXES = Object.freeze(loadNetworkIndexes());

function getNetworkIndexAliases(network) {
  const fallbackIndex = FALLBACK_NETWORK_INDEXES[network];
  const configuredIndex = NETWORK_INDEXES[network];
  return [...new Set([configuredIndex, fallbackIndex].filter(Boolean))];
}

function resolveNetworkIndex(index) {
  const network = Object.keys(FALLBACK_NETWORK_INDEXES)
    .find((key) => FALLBACK_NETWORK_INDEXES[key] === index || NETWORK_INDEXES[key] === index);

  return network ? NETWORK_INDEXES[network] : index;
}

export {
  API_ROOT,
  FALLBACK_NETWORK_INDEXES,
  NETWORK_INDEXES,
  getNetworkIndexAliases,
  loadNetworkIndexes,
  resolveNetworkIndex,
};
