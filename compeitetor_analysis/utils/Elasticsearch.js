import { Client, Transport } from "@elastic/elasticsearch";
import config from "config";
import logger from "../resources/logs/logger.log.js";
import {
  getNetworkIndexAliases,
  resolveNetworkIndex,
} from "./networkIndexes.js";

// ── ES 6.x / 9.x compatibility ───────────────────────────────────────────────
// Queries are written for ES 9.x. When a server is ES 6.x, search/count/msearch bodies get
// `calendar_interval` / `fixed_interval` renamed to `interval` (ES 6 knows only `interval`).
// ES 9.x requests are sent unchanged. The server version is read once per client.
const LEGACY_SEARCH_METHODS = new Set(["search", "count", "msearch"]);
const esMajorByClient = new WeakMap();

function esMajorOf(client) {
  if (!esMajorByClient.has(client)) {
    const probe = typeof client.info === "function"
      ? Promise.resolve(client.info())
        .then((info) => parseInt(String(info?.version?.number || ""), 10) || null)
        .catch(() => null)
      : Promise.resolve(null);
    esMajorByClient.set(client, probe);
  }
  return esMajorByClient.get(client);
}

function renameIntervals(value) {
  if (Array.isArray(value)) return value.map(renameIntervals);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    out[key === "calendar_interval" || key === "fixed_interval" ? "interval" : key] = renameIntervals(v);
  }
  return out;
}

function toLegacyBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const out = { ...body };
  if (out.aggs) out.aggs = renameIntervals(out.aggs);
  if (out.aggregations) out.aggregations = renameIntervals(out.aggregations);
  return out;
}

function toLegacyParams(method, params) {
  if (!params || typeof params !== "object") return params;
  if (method === "msearch") {
    const key = Array.isArray(params.searches) ? "searches" : "body";
    return Array.isArray(params[key]) ? { ...params, [key]: params[key].map(toLegacyBody) } : params;
  }
  const out = toLegacyBody(params);
  if (out.body) out.body = toLegacyBody(out.body);
  return out;
}

function withResolvedIndex(client) {
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;

      return (...args) => {
        let [params, ...rest] = args;

        // Services retain legacy names for field-selection branches, while
        // Elasticsearch always receives the configured physical index name.
        if (params && typeof params === "object" && params.index) {
          params = { ...params, index: resolveNetworkIndex(params.index) };
        }

        if (LEGACY_SEARCH_METHODS.has(property)) {
          return esMajorOf(target).then((major) =>
            value.call(target, major != null && major < 7 ? toLegacyParams(property, params) : params, ...rest));
        }

        return value.call(target, ...(args.length ? [params, ...rest] : args));
      };
    },
  });
}

// Client v9 sends `compatible-with=9` headers, which ES 6.x rejects. Send plain
// application/json instead (as the legacy client did) — ES 6.x and ES 9.x both accept it.
class PlainJsonTransport extends Transport {
  constructor(opts) {
    super({
      ...opts,
      // ES 6.x responses carry no `x-elastic-product` header; skip that check so 6.x connects.
      productCheck: null,
      vendoredHeaders: {
        jsonContentType: "application/json",
        ndjsonContentType: "application/x-ndjson",
        accept: "application/json, text/plain",
      },
    });
  }
}

// Options shared by every @elastic/elasticsearch client in this service.
function buildClientOptions({ host, username, password }) {
  return {
    Transport: PlainJsonTransport,
    node: host,
    ...(username ? { auth: { username, password } } : {}),
    // Client v9 has no default request timeout; keep the legacy client's 30s.
    requestTimeout: 30000,
  };
}

const createElasticClient = (serverData) => {
  logger.info(`Creating Elasticsearch client for ${serverData.host}`);
  const client = new Client(buildClientOptions(serverData));
  return withResolvedIndex(client);
};

const esServers = {
  server1: {
    host: config.get("SEARCH_HOSTS"),
    username: config.get("TEST_ELASTICSEARCH_USER"),
    password: config.get("TEST_ELASTICSEARCH_PASS"),
    indexes: [
      ...getNetworkIndexAliases("facebook"),
      ...getNetworkIndexAliases("youtube"),
    ],
  },
  server2: {
    host: config.get("TEST_SEARCH_HOSTS"),
    username: config.get("TEST_ELASTICSEARCH_USER1"),
    password: config.get("TEST_ELASTICSEARCH_PASS1"),
    indexes: getNetworkIndexAliases("instagram"),
  },
  server3: {
    host: config.get("TEST_SEARCH_HOSTS1"),
    username: config.get("TEST_ELASTICSEARCH_USER2"),
    password: config.get("TEST_ELASTICSEARCH_PASS2"),
    indexes: getNetworkIndexAliases("google"),
  },
  server4: {
    host: config.get("TEST_SEARCH_HOSTS2"),
    username: config.get("TEST_ELASTICSEARCH_USER3"),
    password: config.get("TEST_ELASTICSEARCH_PASS3"),
    indexes: ["category"],
  },
};

const esClient = {};
for (const [serverName, serverData] of Object.entries(esServers)) {
  esClient[serverName] = createElasticClient(serverData);
}

async function checkElasticsearchHealth() {
  for (const [serverName, client] of Object.entries(esClient)) {
    try {
      await client.ping();
      logger.info(`Elasticsearch ${serverName} is up`);
    } catch (error) {
      logger.error(`Elasticsearch ${serverName} is down:`, error);
      throw error;
    }
  }
}

async function closeClients() {
  for (const [serverName, client] of Object.entries(esClient)) {
    try {
      await client.close();
      logger.info(`Closed Elasticsearch client for ${serverName}`);
    } catch (error) {
      logger.error(`Error closing Elasticsearch client for ${serverName}:`, error);
    }
  }
}

export { esClient, esServers, checkElasticsearchHealth, closeClients, buildClientOptions };
