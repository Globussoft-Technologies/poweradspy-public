import fs from "fs";
import { Client } from "@elastic/elasticsearch";
import config from "config";
import logger from "../resources/logs/logger.log.js";
import {
  getNetworkIndexAliases,
  resolveNetworkIndex,
} from "./networkIndexes.js";

function withResolvedIndex(client) {
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;

      return (...args) => {
        const [params, ...rest] = args;

        // Services retain legacy names for field-selection branches, while
        // Elasticsearch always receives the configured physical index name.
        if (params && typeof params === "object" && params.index) {
          return value.call(target, { ...params, index: resolveNetworkIndex(params.index) }, ...rest);
        }

        return value.call(target, ...args);
      };
    },
  });
}

// ES 9 serves HTTPS with a self-signed CA; trust it when a CA path is configured.
const caCertPath = config.has("ELASTICSEARCH_CA_CERT") ? config.get("ELASTICSEARCH_CA_CERT") : null;

// Options shared by every @elastic/elasticsearch client in this service.
function buildClientOptions({ host, username, password, caCert }) {
  const ca = caCert || caCertPath;
  return {
    node: host,
    ...(username ? { auth: { username, password } } : {}),
    ...(ca ? { tls: { ca: fs.readFileSync(ca) } } : {}),
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
