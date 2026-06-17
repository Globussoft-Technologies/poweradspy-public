require('dotenv').config();
const elasticsearch = require('elasticsearch');

// Define multiple independent Elasticsearch instances
const environment = process.env.ENVIRONMENT || 'DEV';
let esClients = [];

if (environment === 'PROD') {
    esClients = [
        { host: process.env.ELASTICSEARCH_HOST1, auth: { username: process.env.ELASTICSEARCH_USER1, password: process.env.ELASTICSEARCH_PASS1 } },
        { host: process.env.ELASTICSEARCH_HOST2, auth: { username: process.env.ELASTICSEARCH_USER2, password: process.env.ELASTICSEARCH_PASS2 } },
        { host: process.env.ELASTICSEARCH_HOST3, auth: { username: process.env.ELASTICSEARCH_USER3, password: process.env.ELASTICSEARCH_PASS3 } },
        { host: process.env.ELASTICSEARCH_HOST4, auth: { username: process.env.ELASTICSEARCH_USER4, password: process.env.ELASTICSEARCH_PASS4 } },
        { host: process.env.ELASTICSEARCH_HOST5, auth: { username: process.env.ELASTICSEARCH_USER5, password: process.env.ELASTICSEARCH_PASS5 } }
    ];
} else {
    esClients = [
        { host: process.env.ELASTICSEARCH_HOST, auth: { username: process.env.ELASTICSEARCH_USER, password: process.env.ELASTICSEARCH_PASS } },
    ];
}

// Build a single Elasticsearch client from a config entry.
// Extracted so the no-auth branch is unit-testable; behavior is unchanged.
function buildClient(config) {
    const clientConfig = {
        host: config.host,
        log: 'error',
    };

    // Add authentication only if it's provided
    if (config.auth) {
        clientConfig.httpAuth = `${config.auth.username}:${config.auth.password}`;
    }

    return new elasticsearch.Client(clientConfig);
}

// Create a client for each Elasticsearch instance
const clients = esClients.map(buildClient);

// Function to check health of all Elasticsearch instances.
// clientList/configList are injectable to make the health-check unit-testable;
// they default to the module-level clients/esClients built above.
async function checkAllInstances(clientList = clients, configList = esClients) {
    for (let i = 0; i < clientList.length; i++) {
        try {
            const health = await clientList[i].cluster.health();
            console.log(`✅ Elasticsearch connected: Node ${i + 1} (${configList[i].host}) — status: ${health.status}`);
        } catch (error) {
            console.error(`❌ Elasticsearch connection FAILED: Node ${i + 1} (${configList[i].host}) — ${error.message}`);
        }
    }
}

checkAllInstances();




async function searchAllInstances(index, query, es_id, search_type) { 
    let results = {};
    if (environment === 'DEV') es_id = 0;
    try {
        let response;
        
        if (search_type === 'count') {
            response = await clients[es_id].count({
                index,
                body: query
            });
        } else {
            response = await clients[es_id].search({
                index,
                body: query
            });
        }
        results = {
            node: esClients[es_id].host,
            type: search_type,
            data: search_type === 'count' ? response.count : response
        };
    } catch (error) {
        console.error(`Search failed on ${esClients[es_id].host}:`, error.message);
    }

    return results;
}





// Keep the default export callable as a function (existing consumers do
// `const searchAllInstances = require('.../connection')`), while also exposing
// checkAllInstances for health-check tasks and unit tests.
searchAllInstances.checkAllInstances = checkAllInstances;
searchAllInstances.buildClient = buildClient;
module.exports = searchAllInstances