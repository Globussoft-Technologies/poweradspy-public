import elasticsearch from "elasticsearch";
import config from "config";
import logger from "../resources/logs/logger.log.js";

const createElasticClient = (serverData) => {
  logger.info(`Creating Elasticsearch client for ${serverData.host}`);
  const client = new elasticsearch.Client({
    host: serverData.host,
    httpAuth: serverData.username ? `${serverData.username}:${serverData.password}` : undefined,
  });
  return client;
};

const esServers = {
  server1: {
    host: config.get("SEARCH_HOSTS"),
    username: config.get("TEST_ELASTICSEARCH_USER"),
    password: config.get("TEST_ELASTICSEARCH_PASS"),
    indexes: ["search_mix", "youtube_ads_data"],
  },
  server2: {
    host: config.get("TEST_SEARCH_HOSTS"),
    username: config.get("TEST_ELASTICSEARCH_USER1"),
    password: config.get("TEST_ELASTICSEARCH_PASS1"),
    indexes: ["instagram_search_mix"],
  },
  server3: {
    host: config.get("TEST_SEARCH_HOSTS1"),
    username: config.get("TEST_ELASTICSEARCH_USER2"),
    password: config.get("TEST_ELASTICSEARCH_PASS2"),
    indexes: ["google_ads_data"],
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

export { esClient, esServers, checkElasticsearchHealth, closeClients };