'use strict';

/**
 * Network specific configurations and database mappings.
 * Reads from config.json first, then falls back to .env variables, then to default DB config.
 */

const config = require('./index');

// In development, all networks share the default DB connection.
// In production, each network gets its own connection params from config / env.
const isProduction = config.env === 'production';

// Helper: get network-specific value from config.json networks section, env, or default.
// connectionParam=true → in dev, skip network-specific override and always use shared default.
// connectionParam=false (default) → always read from network config first (e.g. enabled, index, poolSize).
function netVal(networkJson, field, envKey, defaultVal, connectionParam = false) {
  if (isProduction || !connectionParam) {
    // 1. Check config.json network-specific value
    if (networkJson && networkJson[field] !== undefined && networkJson[field] !== null && networkJson[field] !== '') {
      return networkJson[field];
    }
    // 2. Check env variable
    const envVal = process.env[envKey];
    if (envVal !== undefined && envVal !== null && envVal !== '') {
      return envVal;
    }
  }
  // 3. Use default from main config (always in dev, fallback in prod)
  return defaultVal;
}

function toBool(v) {
  return v === true || v === 'true';
}

// Get network configs from config.json
const netCfg = config.getRawFileConfig()?.networks || {};

module.exports = {
   user_activity: {
    name: 'User Activity',
    slug: 'user_activity',
    enabled: true,
    database: {
      elastic: {
        enabled: toBool(netVal(netCfg.user_activity?.elastic, 'enabled', 'UA_ELASTIC_ENABLED', true)),
        index:   netVal(netCfg.user_activity?.elastic, 'index', 'UA_ELASTIC_INDEX', 'user_activities'),
        node:    netVal(netCfg.user_activity?.elastic, 'node',     'UA_ELASTIC_NODE',     config.databases.elastic.node,               true),
        auth: {
          username: netVal(netCfg.user_activity?.elastic, 'username', 'UA_ELASTIC_USERNAME', config.databases.elastic.auth.username, true),
          password: netVal(netCfg.user_activity?.elastic, 'password', 'UA_ELASTIC_PASSWORD', config.databases.elastic.auth.password, true),
        },
      },
    },
  },
  facebook: {
    name: 'Facebook',
    slug: 'facebook',
    enabled: toBool(netVal(netCfg.facebook, 'enabled', 'FB_ENABLED', true)),
    insertion: { enabled: toBool(netVal(netCfg.facebook?.insertion, 'enabled', 'FB_INSERTION_ENABLED', true)) },
    database: {
      sql: {
        // enabled/poolSize — non-connection params, always read from network config
        enabled:  toBool(netVal(netCfg.facebook?.sql, 'enabled',  'FB_SQL_ENABLED',   false)),
        poolSize: netVal(netCfg.facebook?.sql, 'poolSize', 'FB_SQL_POOL_SIZE', config.databases.sql.poolSize),
        // server connection params — dev: always use shared default; prod: use network override
        host:     netVal(netCfg.facebook?.sql, 'host',     'FB_SQL_HOST',      config.databases.sql.host,     true),
        port:     netVal(netCfg.facebook?.sql, 'port',     'FB_SQL_PORT',      config.databases.sql.port,     true),
        user:     netVal(netCfg.facebook?.sql, 'user',     'FB_SQL_USER',      config.databases.sql.user,     true),
        password: netVal(netCfg.facebook?.sql, 'password', 'FB_SQL_PASSWORD',  config.databases.sql.password, true),
        // database name is always per-network (pasdev_facebook / pasdev_instagram) in both dev and prod
        database: netVal(netCfg.facebook?.sql, 'database', 'FB_SQL_DATABASE',  config.databases.sql.database),
      },
      mongo: {
        enabled:  toBool(netVal(netCfg.facebook?.mongo, 'enabled',  'FB_MONGO_ENABLED',   false)),
        poolSize: netVal(netCfg.facebook?.mongo, 'poolSize', 'FB_MONGO_POOL_SIZE', config.databases.mongo.poolSize),
        // connection params — note: in dev both networks share the same mongo server + database
        database: netVal(netCfg.facebook?.mongo, 'database', 'FB_MONGO_DATABASE',  config.databases.mongo.database || 'pas_dev', true),
        uri:      netVal(netCfg.facebook?.mongo, 'uri',      'FB_MONGO_URI',       config.databases.mongo.uri,                    true),
      },
      elastic: {
        enabled: toBool(netVal(netCfg.facebook?.elastic, 'enabled', 'FB_ELASTIC_ENABLED', false)),
        // index is non-connection — always network-specific in both dev and prod
        index:   netVal(netCfg.facebook?.elastic, 'index', 'FB_ELASTIC_INDEX', 'search_mix'),
        // connection params — note: auth lives under config.databases.elastic.auth (not flat)
        node:    netVal(netCfg.facebook?.elastic, 'node',     'FB_ELASTIC_NODE',     config.databases.elastic.node,               true),
        auth: {
          username: netVal(netCfg.facebook?.elastic, 'username', 'FB_ELASTIC_USERNAME', config.databases.elastic.auth.username, true),
          password: netVal(netCfg.facebook?.elastic, 'password', 'FB_ELASTIC_PASSWORD', config.databases.elastic.auth.password, true),
        },
      },
    },
  },
  youtube: {
    name: 'YouTube',
    slug: 'youtube',
    enabled: toBool(netVal(netCfg.youtube, 'enabled', 'YT_ENABLED', true)),
    insertion: { enabled: toBool(netVal(netCfg.youtube?.insertion, 'enabled', 'YT_INSERTION_ENABLED', true)) },
    database: {
      sql: {
        enabled:  toBool(netVal(netCfg.youtube?.sql, 'enabled',  'YT_SQL_ENABLED',   false)),
        poolSize: netVal(netCfg.youtube?.sql, 'poolSize', 'YT_SQL_POOL_SIZE', config.databases.sql.poolSize),
        host:     netVal(netCfg.youtube?.sql, 'host',     'YT_SQL_HOST',      config.databases.sql.host,     true),
        port:     netVal(netCfg.youtube?.sql, 'port',     'YT_SQL_PORT',      config.databases.sql.port,     true),
        user:     netVal(netCfg.youtube?.sql, 'user',     'YT_SQL_USER',      config.databases.sql.user,     true),
        password: netVal(netCfg.youtube?.sql, 'password', 'YT_SQL_PASSWORD',  config.databases.sql.password, true),
        database: netVal(netCfg.youtube?.sql, 'database', 'YT_SQL_DATABASE',  config.databases.sql.database),
      },
      mongo: {
        enabled:  toBool(netVal(netCfg.youtube?.mongo, 'enabled',  'YT_MONGO_ENABLED',   false)),
        poolSize: netVal(netCfg.youtube?.mongo, 'poolSize', 'YT_MONGO_POOL_SIZE', config.databases.mongo.poolSize),
        database: netVal(netCfg.youtube?.mongo, 'database', 'YT_MONGO_DATABASE',  config.databases.mongo.database || 'pas_dev', true),
        uri:      netVal(netCfg.youtube?.mongo, 'uri',      'YT_MONGO_URI',       config.databases.mongo.uri,                    true),
      },
      elastic: {
        enabled: toBool(netVal(netCfg.youtube?.elastic, 'enabled', 'YT_ELASTIC_ENABLED', false)),
        index:   netVal(netCfg.youtube?.elastic, 'index', 'YT_ELASTIC_INDEX', 'youtube_ads_data'),
        node:    netVal(netCfg.youtube?.elastic, 'node',     'YT_ELASTIC_NODE',     config.databases.elastic.node,               true),
        auth: {
          username: netVal(netCfg.youtube?.elastic, 'username', 'YT_ELASTIC_USERNAME', config.databases.elastic.auth.username, true),
          password: netVal(netCfg.youtube?.elastic, 'password', 'YT_ELASTIC_PASSWORD', config.databases.elastic.auth.password, true),
        },
      },
    },
  },
  gdn: {
    name: 'GDN',
    slug: 'gdn',
    enabled: toBool(netVal(netCfg.gdn, 'enabled', 'GDN_ENABLED', true)),
    insertion: { enabled: toBool(netVal(netCfg.gdn?.insertion, 'enabled', 'GDN_INSERTION_ENABLED', true)) },
    database: {
      sql: {
        enabled:  toBool(netVal(netCfg.gdn?.sql, 'enabled',  'GDN_SQL_ENABLED',   false)),
        poolSize: netVal(netCfg.gdn?.sql, 'poolSize', 'GDN_SQL_POOL_SIZE', config.databases.sql.poolSize),
        host:     netVal(netCfg.gdn?.sql, 'host',     'GDN_SQL_HOST',      config.databases.sql.host,     true),
        port:     netVal(netCfg.gdn?.sql, 'port',     'GDN_SQL_PORT',      config.databases.sql.port,     true),
        user:     netVal(netCfg.gdn?.sql, 'user',     'GDN_SQL_USER',      config.databases.sql.user,     true),
        password: netVal(netCfg.gdn?.sql, 'password', 'GDN_SQL_PASSWORD',  config.databases.sql.password, true),
        database: netVal(netCfg.gdn?.sql, 'database', 'GDN_SQL_DATABASE',  config.databases.sql.database),
      },
      mongo: {
        enabled:  toBool(netVal(netCfg.gdn?.mongo, 'enabled',  'GDN_MONGO_ENABLED',   false)),
        poolSize: netVal(netCfg.gdn?.mongo, 'poolSize', 'GDN_MONGO_POOL_SIZE', config.databases.mongo.poolSize),
        database: netVal(netCfg.gdn?.mongo, 'database', 'GDN_MONGO_DATABASE',  config.databases.mongo.database || 'pas_dev', true),
        uri:      netVal(netCfg.gdn?.mongo, 'uri',      'GDN_MONGO_URI',       config.databases.mongo.uri,                    true),
      },
      elastic: {
        enabled: toBool(netVal(netCfg.gdn?.elastic, 'enabled', 'GDN_ELASTIC_ENABLED', false)),
        index:   netVal(netCfg.gdn?.elastic, 'index', 'GDN_ELASTIC_INDEX', 'gdn_search_mix_v2'),
        node:    netVal(netCfg.gdn?.elastic, 'node',     'GDN_ELASTIC_NODE',     config.databases.elastic.node,               true),
        auth: {
          username: netVal(netCfg.gdn?.elastic, 'username', 'GDN_ELASTIC_USERNAME', config.databases.elastic.auth.username, true),
          password: netVal(netCfg.gdn?.elastic, 'password', 'GDN_ELASTIC_PASSWORD', config.databases.elastic.auth.password, true),
        },
      },
    },
  },
  instagram: {
    name: 'Instagram',
    slug: 'instagram',
    enabled: toBool(netVal(netCfg.instagram, 'enabled', 'IG_ENABLED', true)),
    insertion: { enabled: toBool(netVal(netCfg.instagram?.insertion, 'enabled', 'IG_INSERTION_ENABLED', true)) },
    database: {
      sql: {
        enabled:  toBool(netVal(netCfg.instagram?.sql, 'enabled',  'IG_SQL_ENABLED',   false)),
        poolSize: netVal(netCfg.instagram?.sql, 'poolSize', 'IG_SQL_POOL_SIZE', config.databases.sql.poolSize),
        host:     netVal(netCfg.instagram?.sql, 'host',     'IG_SQL_HOST',      config.databases.sql.host,     true),
        port:     netVal(netCfg.instagram?.sql, 'port',     'IG_SQL_PORT',      config.databases.sql.port,     true),
        user:     netVal(netCfg.instagram?.sql, 'user',     'IG_SQL_USER',      config.databases.sql.user,     true),
        password: netVal(netCfg.instagram?.sql, 'password', 'IG_SQL_PASSWORD',  config.databases.sql.password, true),
        database: netVal(netCfg.instagram?.sql, 'database', 'IG_SQL_DATABASE',  config.databases.sql.database),
      },
      mongo: {
        enabled:  toBool(netVal(netCfg.instagram?.mongo, 'enabled',  'IG_MONGO_ENABLED',   false)),
        poolSize: netVal(netCfg.instagram?.mongo, 'poolSize', 'IG_MONGO_POOL_SIZE', config.databases.mongo.poolSize),
        database: netVal(netCfg.instagram?.mongo, 'database', 'IG_MONGO_DATABASE',  config.databases.mongo.database || 'pas_dev', true),
        uri:      netVal(netCfg.instagram?.mongo, 'uri',      'IG_MONGO_URI',       config.databases.mongo.uri,                    true),
      },
      elastic: {
        enabled: toBool(netVal(netCfg.instagram?.elastic, 'enabled', 'IG_ELASTIC_ENABLED', false)),
        index:   netVal(netCfg.instagram?.elastic, 'index', 'IG_ES_INDEX', 'search_mix'),
        node:    netVal(netCfg.instagram?.elastic, 'node',     'IG_ELASTIC_NODE',     config.databases.elastic.node,               true),
        auth: {
          username: netVal(netCfg.instagram?.elastic, 'username', 'IG_ELASTIC_USERNAME', config.databases.elastic.auth.username, true),
          password: netVal(netCfg.instagram?.elastic, 'password', 'IG_ELASTIC_PASSWORD', config.databases.elastic.auth.password, true),
        },
      },
    },
  },
  pinterest: {
    name: 'Pinterest',
    slug: 'pinterest',
    enabled: toBool(netVal(netCfg.pinterest, 'enabled', 'PIN_ENABLED', true)),
    insertion: { enabled: toBool(netVal(netCfg.pinterest?.insertion, 'enabled', 'PIN_INSERTION_ENABLED', true)) },
    database: {
      sql: {
        enabled:  toBool(netVal(netCfg.pinterest?.sql, 'enabled',  'PIN_SQL_ENABLED',   false)),
        poolSize: netVal(netCfg.pinterest?.sql, 'poolSize', 'PIN_SQL_POOL_SIZE', config.databases.sql.poolSize),
        host:     netVal(netCfg.pinterest?.sql, 'host',     'PIN_SQL_HOST',      config.databases.sql.host,     true),
        port:     netVal(netCfg.pinterest?.sql, 'port',     'PIN_SQL_PORT',      config.databases.sql.port,     true),
        user:     netVal(netCfg.pinterest?.sql, 'user',     'PIN_SQL_USER',      config.databases.sql.user,     true),
        password: netVal(netCfg.pinterest?.sql, 'password', 'PIN_SQL_PASSWORD',  config.databases.sql.password, true),
        database: netVal(netCfg.pinterest?.sql, 'database', 'PIN_SQL_DATABASE',  config.databases.sql.database),
      },
      mongo: {
        enabled:  toBool(netVal(netCfg.pinterest?.mongo, 'enabled',  'PIN_MONGO_ENABLED',   false)),
        poolSize: netVal(netCfg.pinterest?.mongo, 'poolSize', 'PIN_MONGO_POOL_SIZE', config.databases.mongo.poolSize),
        database: netVal(netCfg.pinterest?.mongo, 'database', 'PIN_MONGO_DATABASE',  config.databases.mongo.database || 'pas_dev', true),
        uri:      netVal(netCfg.pinterest?.mongo, 'uri',      'PIN_MONGO_URI',       config.databases.mongo.uri,                    true),
      },
      elastic: {
        enabled: toBool(netVal(netCfg.pinterest?.elastic, 'enabled', 'PIN_ELASTIC_ENABLED', false)),
        index:   netVal(netCfg.pinterest?.elastic, 'index', 'PIN_ELASTIC_INDEX', 'pinterest_search_mix'),
        node:    netVal(netCfg.pinterest?.elastic, 'node',     'PIN_ELASTIC_NODE',     config.databases.elastic.node,               true),
        auth: {
          username: netVal(netCfg.pinterest?.elastic, 'username', 'PIN_ELASTIC_USERNAME', config.databases.elastic.auth.username, true),
          password: netVal(netCfg.pinterest?.elastic, 'password', 'PIN_ELASTIC_PASSWORD', config.databases.elastic.auth.password, true),
        },
      },
    },
  },
  google: {
    name: 'Google',
    slug: 'google',
    enabled: toBool(netVal(netCfg.google, 'enabled', 'GOOG_ENABLED', true)),
    insertion: { enabled: toBool(netVal(netCfg.google?.insertion, 'enabled', 'GOOG_INSERTION_ENABLED', true)) },
    database: {
      sql: {
        enabled:  toBool(netVal(netCfg.google?.sql, 'enabled',  'GOOG_SQL_ENABLED',   false)),
        poolSize: netVal(netCfg.google?.sql, 'poolSize', 'GOOG_SQL_POOL_SIZE', config.databases.sql.poolSize),
        host:     netVal(netCfg.google?.sql, 'host',     'GOOG_SQL_HOST',      config.databases.sql.host,     true),
        port:     netVal(netCfg.google?.sql, 'port',     'GOOG_SQL_PORT',      config.databases.sql.port,     true),
        user:     netVal(netCfg.google?.sql, 'user',     'GOOG_SQL_USER',      config.databases.sql.user,     true),
        password: netVal(netCfg.google?.sql, 'password', 'GOOG_SQL_PASSWORD',  config.databases.sql.password, true),
        database: netVal(netCfg.google?.sql, 'database', 'GOOG_SQL_DATABASE',  config.databases.sql.database),
      },
      mongo: {
        enabled:  toBool(netVal(netCfg.google?.mongo, 'enabled',  'GOOG_MONGO_ENABLED',   false)),
        poolSize: netVal(netCfg.google?.mongo, 'poolSize', 'GOOG_MONGO_POOL_SIZE', config.databases.mongo.poolSize),
        database: netVal(netCfg.google?.mongo, 'database', 'GOOG_MONGO_DATABASE',  config.databases.mongo.database || 'pas_dev', true),
        uri:      netVal(netCfg.google?.mongo, 'uri',      'GOOG_MONGO_URI',       config.databases.mongo.uri,                    true),
      },
      elastic: {
        enabled: toBool(netVal(netCfg.google?.elastic, 'enabled', 'GOOG_ELASTIC_ENABLED', false)),
        index:   netVal(netCfg.google?.elastic, 'index', 'GOOG_ELASTIC_INDEX', 'google_ads_data'),
        node:    netVal(netCfg.google?.elastic, 'node',     'GOOG_ELASTIC_NODE',     config.databases.elastic.node,               true),
        auth: {
          username: netVal(netCfg.google?.elastic, 'username', 'GOOG_ELASTIC_USERNAME', config.databases.elastic.auth.username, true),
          password: netVal(netCfg.google?.elastic, 'password', 'GOOG_ELASTIC_PASSWORD', config.databases.elastic.auth.password, true),
        },
      },
    },
  },
  native: {
    name: 'Native',
    slug: 'native',
    enabled: toBool(netVal(netCfg.native, 'enabled', 'NAT_ENABLED', true)),
    insertion: { enabled: toBool(netVal(netCfg.native?.insertion, 'enabled', 'NAT_INSERTION_ENABLED', true)) },
    database: {
      sql: {
        enabled:  toBool(netVal(netCfg.native?.sql, 'enabled',  'NAT_SQL_ENABLED',   false)),
        poolSize: netVal(netCfg.native?.sql, 'poolSize', 'NAT_SQL_POOL_SIZE', config.databases.sql.poolSize),
        host:     netVal(netCfg.native?.sql, 'host',     'NAT_SQL_HOST',      config.databases.sql.host,     true),
        port:     netVal(netCfg.native?.sql, 'port',     'NAT_SQL_PORT',      config.databases.sql.port,     true),
        user:     netVal(netCfg.native?.sql, 'user',     'NAT_SQL_USER',      config.databases.sql.user,     true),
        password: netVal(netCfg.native?.sql, 'password', 'NAT_SQL_PASSWORD',  config.databases.sql.password, true),
        database: netVal(netCfg.native?.sql, 'database', 'NAT_SQL_DATABASE',  config.databases.sql.database),
      },
      mongo: {
        enabled:  toBool(netVal(netCfg.native?.mongo, 'enabled',  'NAT_MONGO_ENABLED',   false)),
        poolSize: netVal(netCfg.native?.mongo, 'poolSize', 'NAT_MONGO_POOL_SIZE', config.databases.mongo.poolSize),
        database: netVal(netCfg.native?.mongo, 'database', 'NAT_MONGO_DATABASE',  config.databases.mongo.database || 'pas_dev', true),
        uri:      netVal(netCfg.native?.mongo, 'uri',      'NAT_MONGO_URI',       config.databases.mongo.uri,                    true),
      },
      elastic: {
        enabled: toBool(netVal(netCfg.native?.elastic, 'enabled', 'NAT_ELASTIC_ENABLED', false)),
        index:   netVal(netCfg.native?.elastic, 'index', 'NAT_ELASTIC_INDEX', 'native_search_mix'),
        node:    netVal(netCfg.native?.elastic, 'node',     'NAT_ELASTIC_NODE',     config.databases.elastic.node,               true),
        auth: {
          username: netVal(netCfg.native?.elastic, 'username', 'NAT_ELASTIC_USERNAME', config.databases.elastic.auth.username, true),
          password: netVal(netCfg.native?.elastic, 'password', 'NAT_ELASTIC_PASSWORD', config.databases.elastic.auth.password, true),
        },
      },
    },
  },
  linkedin: {
    name: 'LinkedIn',
    slug: 'linkedin',
    enabled: toBool(netVal(netCfg.linkedin, 'enabled', 'LI_ENABLED', true)),
    insertion: { enabled: toBool(netVal(netCfg.linkedin?.insertion, 'enabled', 'LI_INSERTION_ENABLED', true)) },
    database: {
      sql: {
        enabled:  toBool(netVal(netCfg.linkedin?.sql, 'enabled',  'LI_SQL_ENABLED',   false)),
        poolSize: netVal(netCfg.linkedin?.sql, 'poolSize', 'LI_SQL_POOL_SIZE', config.databases.sql.poolSize),
        host:     netVal(netCfg.linkedin?.sql, 'host',     'LI_SQL_HOST',      config.databases.sql.host,     true),
        port:     netVal(netCfg.linkedin?.sql, 'port',     'LI_SQL_PORT',      config.databases.sql.port,     true),
        user:     netVal(netCfg.linkedin?.sql, 'user',     'LI_SQL_USER',      config.databases.sql.user,     true),
        password: netVal(netCfg.linkedin?.sql, 'password', 'LI_SQL_PASSWORD',  config.databases.sql.password, true),
        database: netVal(netCfg.linkedin?.sql, 'database', 'LI_SQL_DATABASE',  config.databases.sql.database),
      },
      mongo: {
        enabled:  toBool(netVal(netCfg.linkedin?.mongo, 'enabled',  'LI_MONGO_ENABLED',   false)),
        poolSize: netVal(netCfg.linkedin?.mongo, 'poolSize', 'LI_MONGO_POOL_SIZE', config.databases.mongo.poolSize),
        database: netVal(netCfg.linkedin?.mongo, 'database', 'LI_MONGO_DATABASE',  config.databases.mongo.database || 'pas_dev', true),
        uri:      netVal(netCfg.linkedin?.mongo, 'uri',      'LI_MONGO_URI',       config.databases.mongo.uri,                    true),
      },
      elastic: {
        enabled: toBool(netVal(netCfg.linkedin?.elastic, 'enabled', 'LI_ELASTIC_ENABLED', false)),
        index:   netVal(netCfg.linkedin?.elastic, 'index', 'LI_ELASTIC_INDEX', 'linkedin_ads_data'),
        node:    netVal(netCfg.linkedin?.elastic, 'node',     'LI_ELASTIC_NODE',     config.databases.elastic.node,               true),
        auth: {
          username: netVal(netCfg.linkedin?.elastic, 'username', 'LI_ELASTIC_USERNAME', config.databases.elastic.auth.username, true),
          password: netVal(netCfg.linkedin?.elastic, 'password', 'LI_ELASTIC_PASSWORD', config.databases.elastic.auth.password, true),
        },
      },
    },
  },
  reddit: {
    name: 'Reddit',
    slug: 'reddit',
    enabled: toBool(netVal(netCfg.reddit, 'enabled', 'RED_ENABLED', true)),
    insertion: { enabled: toBool(netVal(netCfg.reddit?.insertion, 'enabled', 'RED_INSERTION_ENABLED', true)) },
    database: {
      sql: {
        enabled:  toBool(netVal(netCfg.reddit?.sql, 'enabled',  'RED_SQL_ENABLED',   false)),
        poolSize: netVal(netCfg.reddit?.sql, 'poolSize', 'RED_SQL_POOL_SIZE', config.databases.sql.poolSize),
        host:     netVal(netCfg.reddit?.sql, 'host',     'RED_SQL_HOST',      config.databases.sql.host,     true),
        port:     netVal(netCfg.reddit?.sql, 'port',     'RED_SQL_PORT',      config.databases.sql.port,     true),
        user:     netVal(netCfg.reddit?.sql, 'user',     'RED_SQL_USER',      config.databases.sql.user,     true),
        password: netVal(netCfg.reddit?.sql, 'password', 'RED_SQL_PASSWORD',  config.databases.sql.password, true),
        database: netVal(netCfg.reddit?.sql, 'database', 'RED_SQL_DATABASE',  config.databases.sql.database),
      },
      mongo: {
        enabled:  toBool(netVal(netCfg.reddit?.mongo, 'enabled',  'RED_MONGO_ENABLED',   false)),
        poolSize: netVal(netCfg.reddit?.mongo, 'poolSize', 'RED_MONGO_POOL_SIZE', config.databases.mongo.poolSize),
        database: netVal(netCfg.reddit?.mongo, 'database', 'RED_MONGO_DATABASE',  config.databases.mongo.database || 'pas_dev', true),
        uri:      netVal(netCfg.reddit?.mongo, 'uri',      'RED_MONGO_URI',       config.databases.mongo.uri,                    true),
      },
      elastic: {
        enabled: toBool(netVal(netCfg.reddit?.elastic, 'enabled', 'RED_ELASTIC_ENABLED', false)),
        index:   netVal(netCfg.reddit?.elastic, 'index', 'RED_ELASTIC_INDEX', 'reddit_search_mix'),
        node:    netVal(netCfg.reddit?.elastic, 'node',     'RED_ELASTIC_NODE',     config.databases.elastic.node,               true),
        auth: {
          username: netVal(netCfg.reddit?.elastic, 'username', 'RED_ELASTIC_USERNAME', config.databases.elastic.auth.username, true),
          password: netVal(netCfg.reddit?.elastic, 'password', 'RED_ELASTIC_PASSWORD', config.databases.elastic.auth.password, true),
        },
      },
    },
  },
  quora: {
    name: 'Quora',
    slug: 'quora',
    enabled: toBool(netVal(netCfg.quora, 'enabled', 'QR_ENABLED', true)),
    insertion: { enabled: toBool(netVal(netCfg.quora?.insertion, 'enabled', 'QR_INSERTION_ENABLED', true)) },
    database: {
      sql: {
        enabled:  toBool(netVal(netCfg.quora?.sql, 'enabled',  'QR_SQL_ENABLED',   false)),
        poolSize: netVal(netCfg.quora?.sql, 'poolSize', 'QR_SQL_POOL_SIZE', config.databases.sql.poolSize),
        host:     netVal(netCfg.quora?.sql, 'host',     'QR_SQL_HOST',      config.databases.sql.host,     true),
        port:     netVal(netCfg.quora?.sql, 'port',     'QR_SQL_PORT',      config.databases.sql.port,     true),
        user:     netVal(netCfg.quora?.sql, 'user',     'QR_SQL_USER',      config.databases.sql.user,     true),
        password: netVal(netCfg.quora?.sql, 'password', 'QR_SQL_PASSWORD',  config.databases.sql.password, true),
        database: netVal(netCfg.quora?.sql, 'database', 'QR_SQL_DATABASE',  config.databases.sql.database),
      },
      mongo: {
        enabled:  toBool(netVal(netCfg.quora?.mongo, 'enabled',  'QR_MONGO_ENABLED',   false)),
        poolSize: netVal(netCfg.quora?.mongo, 'poolSize', 'QR_MONGO_POOL_SIZE', config.databases.mongo.poolSize),
        database: netVal(netCfg.quora?.mongo, 'database', 'QR_MONGO_DATABASE',  config.databases.mongo.database || 'pas_dev', true),
        uri:      netVal(netCfg.quora?.mongo, 'uri',      'QR_MONGO_URI',       config.databases.mongo.uri,                    true),
      },
      elastic: {
        enabled: toBool(netVal(netCfg.quora?.elastic, 'enabled', 'QR_ELASTIC_ENABLED', false)),
        index:   netVal(netCfg.quora?.elastic, 'index', 'QR_ELASTIC_INDEX', 'quora_search_mix'),
        node:    netVal(netCfg.quora?.elastic, 'node',     'QR_ELASTIC_NODE',     config.databases.elastic.node,               true),
        auth: {
          username: netVal(netCfg.quora?.elastic, 'username', 'QR_ELASTIC_USERNAME', config.databases.elastic.auth.username, true),
          password: netVal(netCfg.quora?.elastic, 'password', 'QR_ELASTIC_PASSWORD', config.databases.elastic.auth.password, true),
        },
      },
    },
  },
  tiktok: {
    name: 'TikTok',
    slug: 'tiktok',
    enabled: toBool(netVal(netCfg.tiktok, 'enabled', 'TT_ENABLED', true)),
    insertion: { enabled: toBool(netVal(netCfg.tiktok?.insertion, 'enabled', 'TT_INSERTION_ENABLED', true)) },
    database: {
      sql: {
        enabled: toBool(netVal(netCfg.tiktok?.sql, 'enabled', 'TT_SQL_ENABLED', false)),
        poolSize: netVal(netCfg.tiktok?.sql, 'poolSize', 'TT_SQL_POOL_SIZE', config.databases.sql.poolSize),
        host: netVal(netCfg.tiktok?.sql, 'host', 'TT_SQL_HOST', config.databases.sql.host, true),
        port: netVal(netCfg.tiktok?.sql, 'port', 'TT_SQL_PORT', config.databases.sql.port, true),
        user: netVal(netCfg.tiktok?.sql, 'user', 'TT_SQL_USER', config.databases.sql.user, true),
        password: netVal(netCfg.tiktok?.sql, 'password', 'TT_SQL_PASSWORD', config.databases.sql.password, true),
        database: netVal(netCfg.tiktok?.sql, 'database', 'TT_SQL_DATABASE', config.databases.sql.tiktokdatabase),
      },
      mongo: {
        enabled: toBool(netVal(netCfg.tiktok?.mongo, 'enabled', 'TT_MONGO_ENABLED', false)),
        poolSize: netVal(netCfg.tiktok?.mongo, 'poolSize', 'TT_MONGO_POOL_SIZE', config.databases.mongo.poolSize),
        database: netVal(netCfg.tiktok?.mongo, 'database', 'TT_MONGO_DATABASE', config.databases.mongo.database || 'pas_dev', true),
        uri: netVal(netCfg.tiktok?.mongo, 'uri', 'TT_MONGO_URI', config.databases.mongo.uri, true),
      },
      elastic_tiktok: {
        enabled: toBool(netVal(netCfg.tiktok?.elastic_tiktok, 'enabled', 'TT_ELASTIC_ENABLED', false)),
        index: netVal(netCfg.tiktok?.elastic_tiktok, 'index', 'TT_ELASTIC_INDEX', 'tiktok_ads'),
        node: netVal(netCfg.tiktok?.elastic_tiktok, 'node', 'TT_ELASTIC_NODE', config.databases.elastic_tiktok.node, true),
        auth: {
          username: netVal(netCfg.tiktok?.elastic_tiktok, 'username', 'TT_ELASTIC_USERNAME', config.databases.elastic_tiktok.auth.username, true),
          password: netVal(netCfg.tiktok?.elastic_tiktok, 'password', 'TT_ELASTIC_PASSWORD', config.databases.elastic_tiktok.auth.password, true),
        },
      },
    },
  },
};
