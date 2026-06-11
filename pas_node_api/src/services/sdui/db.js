'use strict';

const { MongoClient } = require('mongodb');
const config = require('../../config');
const logger = require('../../logger');

const log = logger.createChild('sdui-db');

let client = null;
let db = null;

/**
 * Get or create the MongoDB connection to the pas_ui database.
 * Uses the same MongoDB URI as the main config but targets the `pas_ui` database.
 */
async function getDB() {
  if (db) return db;

  const mongoConfig = config.databases && config.databases.mongo;
  const uri = (mongoConfig && mongoConfig.uri) || 'mongodb://localhost:27017/';
  const poolSize = (mongoConfig && mongoConfig.poolSize) || 10;

  try {
    client = new MongoClient(uri, {
      maxPoolSize: poolSize,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 10000,
    });

    await client.connect();
    db = client.db(config.databases.mongo.database);
    await db.command({ ping: 1 });
    log.info('SDUI MongoDB connected → ' + config.databases.mongo.database);
    return db;
  } catch (err) {
    log.error('SDUI MongoDB connection failed', { error: err.message });
    throw err;
  }
}

async function closeDB() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    log.info('SDUI MongoDB connection closed');
  }
}

module.exports = { getDB, closeDB };
