require('dotenv').config()
const queryDatabase = require('../db-connections/connection');

const DB_DATA = {
    facebook: {
        createdAt: 'created_date',
        tableName: 'facebook_ad',
        userTable: 'facebook_users',
        db_id: 0,
        index: process.env.FB_DATABASE,
        accountFields: { name: 'u.name', id: 'u.facebook_id' },
        platformFilterField: 'a.platform',
        systemField: 'u.system_id',
        activitiesTable: 'facebook_accounts_activities',
        // Geo enrichment (System-Info table). country on the user table; IP in
        // the user_meta table keyed by the user PK.
        countryField: 'current_country',
        ipConfig: { metaTable: 'user_meta', metaKey: 'user_id', metaIpCol: 'ip' }
    },
    youtube: {
        createdAt: "created_date",
        tableName: "youtube_ad",
        userTable: '',
        db_id: 1,
        index: process.env.YT_DATABASE,
        accountFields: { name: "'N/A'", id: "'N/A'" },
        metaJoin: { table: 'youtube_ad_meta_data', on: 'a.id = m.youtube_ad_id' },
        platformFilterField: 'm.platform',
        systemField: 'a.system_id',
        activitiesTable: 'youtube_accounts_activities'
    },
    linkedin: {
        createdAt: "created_at",
        tableName: "linkedin_ad",
        userTable: 'linkedin_users',
        db_id: 2,
        index: process.env.LINKEDIN_DATABASE,
        accountFields: { name: 'u.name', id: 'u.linkedin_id' },
        metaJoin: { table: 'linkedin_ad_meta_data', on: 'a.id = m.linkedin_ad_id' },
        platformFilterField: 'm.platform',
        systemField: 'u.system_id',
        activitiesTable: 'linkedin_account_activities',
        // country on the user table; no IP column stored for linkedin.
        countryField: 'current_country',
        ipConfig: null
    },
    instagram: {
        createdAt: "created_date",
        tableName: "instagram_ad",
        userTable: 'instagram_user',
        metaTable: "instagram_ad_meta_data",
        db_id: 8,
        index: process.env.INSTA_DATABASE,
        accountFields: { name: 'u.name', id: 'u.instagram_id' },
        metaJoin: { table: 'instagram_ad_meta_data', on: 'a.id = m.instagram_ad_id' },
        platformFilterField: 'm.platform',
        systemField: 'u.system_id',
        activitiesTable: 'instagram_accounts_activities',
        // country on the user table; no IP column stored for instagram.
        countryField: 'country',
        ipConfig: null
    },
    gtext: {
        createdAt: "created_date",
        tableName: "google_text_ad",
        userTable: '',
        db_id: 9,
        index: process.env.GT_DATABASE,
        accountFields: { name: "'N/A'", id: "'N/A'" },
        metaJoin: { table: 'google_text_ad_meta_data', on: 'a.id = m.google_text_ad_id' },
        platformFilterField: 'm.platform',
        systemField: 'a.system_id',
        activitiesTable: 'google_account_activities'
    },
    reddit: {
        createdAt: "created_date",
        tableName: "reddit_ad",
        userTable: 'reddit_user',
        db_id: 4,
        index: process.env.REDDIT_DATABASE,
        accountFields: { name: "'N/A'", id: "u.reddit_username" },
        metaJoin: { table: 'reddit_ad_meta_data', on: 'a.id = m.reddit_ad_id' },
        platformFilterField: 'm.platform',
        systemField: 'a.System_id',
        activitiesTable: 'reddit_accounts_activities',
        // country + IP both on the user table directly (reddit_user.ip_address).
        countryField: 'current_country',
        ipConfig: { col: 'ip_address' }
    },
    quora: {
        createdAt: "created_date",
        tableName: "quora_ad",
        userTable: 'quora_user',
        db_id: 7,
        index: process.env.QUORA_DATABASE,
        accountFields: { name: 'u.name', id: 'u.quora_id' },
        metaJoin: { table: 'quora_ad_meta_data', on: 'a.id = m.quora_ad_id' },
        platformFilterField: 'm.platform',
        systemField: 'a.System_id',
        activitiesTable: 'quora_accounts_activities',
        // country on the user table; IP in quora_user_meta keyed by the user PK.
        countryField: 'current_country',
        ipConfig: { metaTable: 'quora_user_meta', metaKey: 'user_id', metaIpCol: 'ip' }
    },
    gdn: {
        createdAt: "created_date",
        tableName: "gdn_ad",
        userTable: '',
        db_id: 5,
        index: process.env.GDN_DATABASE,
        accountFields: { name: "'N/A'", id: "'N/A'" },
        metaJoin: { table: ' gdn_ad_meta_data', on: 'a.id = m.gdn_ad_id' },
        platformFilterField: 'm.platform',
        systemField: 'a.system_id',
        activitiesTable: 'gdn_account_activities'
    },
    native: {
        createdAt: "created_date",
        tableName: "native_ad",
        userTable: '',
        db_id: 3,
        index: process.env.NATIVE_DATABASE,
        accountFields: { name: "'N/A'", id: "'N/A'" },
        metaJoin: { table: ' native_ad_meta_data', on: 'a.id = m.native_ad_id' },
        platformFilterField: 'm.platform',
        systemField: 'a.system_id',
        activitiesTable: 'native_account_activities'
    },
    tiktok: {
        createdAt: "createdAt",
        tableName: "tiktok_ads",
        userTable: 'tiktok_users',
        db_id: 11,
        index: process.env.TIKTOK_DATABASE,
        accountFields: { name: 'u.tiktok_account_name', id: 'u.tiktok_account_id' },
        metaJoin: null,
        platformFilterField: null,
        systemField: 'a.system_id' // Updated to match queries directly from tiktok_ads
    }
};

const adCountAcrossSelectedNetworks = async (range, networks, required = null, platform = null) => {
    if (!range?.from || !range?.to || !Array.isArray(networks) || networks.length === 0) {
        return [];
    }

    const fromDate = `${range.from} 00:00:00`;
    const toDate = `${range.to} 23:59:59`;

    const buildTikTokQuery1 = (networkData) => {
        return `
            SELECT 
                system_id, 
                DATE(createdAt) AS ad_date,
                COUNT(*) AS ads_count
            FROM 
                tiktok_ads
            WHERE 
                createdAt BETWEEN '${fromDate}' AND '${toDate}'
            GROUP BY 
                system_id, ad_date
        `;
    };

    const buildTikTokQuery2 = (networkData) => {
        return `
            SELECT 
                ads.system_id AS system_id,
                ads.tiktok_account_id AS account_id,
                users.tiktok_account_name AS account_name,
                COUNT(*) AS total_ads
            FROM 
                tiktok_ads AS ads
            JOIN 
                tiktok_users AS users ON ads.tiktok_account_id = users.tiktok_account_id
            WHERE 
                ads.createdAt BETWEEN '${fromDate}' AND '${toDate}'
            GROUP BY 
                ads.system_id, ads.tiktok_account_id, users.tiktok_account_name
        `;
    };

    const buildTikTokQuery3 = (networkData) => {
        return `
            SELECT 
                tiktok_account_id, 
                COUNT(*) AS total_ads_count
            FROM 
                tiktok_ads
            WHERE 
                createdAt BETWEEN '${fromDate}' AND '${toDate}'
            GROUP BY 
                tiktok_account_id
        `;
    };

    const buildQuery = (networkData, network) => {
        if (network === 'tiktok') {
            return buildTikTokQuery2(networkData);
        }
        const dateField = `a.${networkData.createdAt}`;
        /* v8 ignore start -- every DB_DATA network defines systemField + accountFields, so these `||`/`?.` fallbacks are defensive */
        const systemField = networkData.systemField || 'u.system_id';
        const accountNameField = networkData.accountFields?.name || `'N/A'`;
        const accountIdField = networkData.accountFields?.id || `'N/A'`;
        /* v8 ignore stop */
        let joinClause = networkData.userTable 
            ? ` LEFT JOIN ${networkData.userTable} u ON a.discoverer_user_id = u.id`
            : '';
        
        if (networkData.metaJoin) {
            joinClause += ` LEFT JOIN ${networkData.metaJoin.table} m ON ${networkData.metaJoin.on}`;
        }
    
        let platformCondition = '';
        if (platform !== null && platform !== undefined) {
            platformCondition = networkData.platformFilterField ? ` AND ${networkData.platformFilterField} = ${platform}` : '';
        } else {
            platformCondition = networkData.platformFilterField ? ` AND ${networkData.platformFilterField} IN (10, 12)` : '';
        }
    
        return `
            SELECT 
                ${systemField} AS system_name,
                '${network}' AS network,
                ${accountNameField} AS account_name,
                ${accountIdField} AS account_id,
                COUNT(*) AS unqiue_ads
            FROM ${networkData.tableName} a
            ${joinClause}
            WHERE ${dateField} BETWEEN '${fromDate}' AND '${toDate}'
            ${platformCondition}
            GROUP BY system_name, account_name, account_id
        `;
    };

    const buildQuery2 = (networkData, network) => {
        if (network === 'tiktok') {
            return buildTikTokQuery1(networkData);
        }
        let joinClause = networkData.userTable
            ? ` LEFT JOIN ${networkData.userTable} u ON a.discoverer_user_id = u.id`
            : '';
        
        if (networkData.metaJoin) {
            joinClause += ` LEFT JOIN ${networkData.metaJoin.table} m ON ${networkData.metaJoin.on}`;
        }
        
        /* v8 ignore next -- every DB_DATA network defines systemField; the `|| 'u.system_id'` fallback is defensive */
        const systemField = networkData.systemField || 'u.system_id';

        let platformCondition = '';
        if (platform !== null && platform !== undefined) {
            platformCondition = networkData.platformFilterField ? ` AND ${networkData.platformFilterField} = ${platform}` : '';
        } else {
            platformCondition = networkData.platformFilterField ? ` AND ${networkData.platformFilterField} IN (10, 12)` : '';
        }

        return `
            SELECT
                ${systemField} AS system_name,
                DATE(a.${networkData.createdAt}) AS ad_date,
                COUNT(*) AS ads_count
            FROM ${networkData.tableName} a
            ${joinClause}
            WHERE a.${networkData.createdAt} BETWEEN '${fromDate}' AND '${toDate}'
            ${platformCondition}
            GROUP BY ${systemField}, DATE(a.${networkData.createdAt})
            ORDER BY ${systemField}, ad_date
        `;
    };

    const buildQuery3 = (networkData, network) => {
        if (network === 'tiktok') {
            return buildTikTokQuery3(networkData);
        }
        /* v8 ignore next 3 -- every DB_DATA network defines activitiesTable, so this null-return is defensive */
        if (!networkData.activitiesTable) {
            return null;
        }

        let platformCondition = '';
        if (platform !== null && platform !== undefined) {
            platformCondition = ` AND platform = ${platform}`;
        } else {
            platformCondition = ` AND platform IN (10, 12)`;
        }

        if (["gtext", "gdn", "youtube", "native"].includes(network)) {
            return `
            SELECT 
                system_id,
                COUNT(*) AS total_ads 
            FROM ${networkData.activitiesTable} 
            WHERE created_at BETWEEN '${fromDate}' AND '${toDate}'
            ${platformCondition}
            GROUP BY system_id
        `;
        }

        return `
            SELECT 
                account_id,
                COUNT(*) AS total_ads 
            FROM ${networkData.activitiesTable} 
            WHERE created_at BETWEEN '${fromDate}' AND '${toDate}'
            ${platformCondition}
            GROUP BY account_id
        `;
    };

    const buildSystemOnlyQuery = (networkData, network) => {
        if (network === 'tiktok') {
            return `
            SELECT DISTINCT system_id AS system_name
            FROM ${networkData.tableName}
            WHERE ${networkData.createdAt} BETWEEN '${fromDate}' AND '${toDate}'
        `;
        }
        let joinClause = networkData.userTable
            ? ` LEFT JOIN ${networkData.userTable} u ON a.discoverer_user_id = u.id`
            : '';

        if (networkData.metaJoin) {
            joinClause += ` LEFT JOIN ${networkData.metaJoin.table} m ON ${networkData.metaJoin.on}`;
        }

        const systemField = networkData.systemField || 'u.system_id';

        let platformCondition = '';
        if (platform !== null && platform !== undefined) {
            platformCondition = networkData.platformFilterField ? ` AND ${networkData.platformFilterField} = ${platform}` : '';
        } else {
            platformCondition = networkData.platformFilterField ? ` AND ${networkData.platformFilterField} IN (10, 12)` : '';
        }

        return `
            SELECT DISTINCT ${systemField} AS system_name
            FROM ${networkData.tableName} a
            ${joinClause}
            WHERE a.${networkData.createdAt} BETWEEN '${fromDate}' AND '${toDate}'
            ${platformCondition}
        `;
    };

    try {
        const results = await Promise.all(networks.map(async (network) => {
            const networkData = DB_DATA[network];
            if (!networkData) return null;
            
            if (required === 'systemActive') {
                const systemQuery = buildSystemOnlyQuery(networkData, network);
                const rows = await queryDatabase(networkData.db_id, networkData.index, systemQuery);
                return rows.map(row => row.system_name);
            }
            
            if (required === 'accountMetrics') {
                const query = buildQuery(networkData, network);
                const query3 = buildQuery3(networkData, network);
                const promises = [
                    queryDatabase(networkData.db_id, networkData.index, query),
                    /* v8 ignore next -- buildQuery3 is non-null for every non-tiktok DB_DATA network (all define activitiesTable); the Promise.resolve([]) fallback is defensive */
                    query3 ? queryDatabase(networkData.db_id, networkData.index, query3) : Promise.resolve([])
                ];

                const [queryResult, query3result] = await Promise.all(promises);
                return {
                    network,
                    query: queryResult,
                    /* v8 ignore next -- query3result is always an array; the `|| []` fallback is defensive */
                    query3: query3result || []
                };
            }
            
            const query = buildQuery(networkData, network);
            if (required) {
                const query3 = buildQuery3(networkData, network);
                const promises = [
                    queryDatabase(networkData.db_id, networkData.index, query),
                    queryDatabase(networkData.db_id, networkData.index, buildQuery2(networkData, network))
                ];
                
                /* v8 ignore start -- buildQuery3 is non-null for every non-tiktok DB_DATA network; the else is defensive */
                if (query3) {
                    promises.push(queryDatabase(networkData.db_id, networkData.index, query3));
                } else {
                    promises.push(Promise.resolve([]));
                }
                /* v8 ignore stop */

                const [queryResult, query2Result, query3result] = await Promise.all(promises);

                return {
                    network,
                    query: queryResult,
                    query2: query2Result,
                    /* v8 ignore next -- query3result is always an array; the `|| []` fallback is defensive */
                    query3: query3result || []
                };
            } else {
                const rows = await queryDatabase(networkData.db_id, networkData.index, query);
                return rows;
            }
        }));

        return results.flat().filter(Boolean);
    } catch (error) {
        console.error("Error fetching ad counts for selected networks:", error);
        return [];
    }
};

const networkConfig = {
    facebook: {
      table: 'facebook_ad_domains', 
      dateField: 'dod_date', 
      totalCountTable: 'facebook_ad_meta_data', 
      totalCountField: 'facebook_ad_id', 
      totalCountDateField: 'white_lander_date', 
      db_id: 0,
      index: process.env.FB_DATABASE,
    },
    instagram: {
      table: 'instagram_ad_domain', 
      dateField: 'dod_date', 
      totalCountTable: 'instagram_ad_meta_data', 
      totalCountField: 'instagram_ad_id', 
      totalCountDateField: 'white_lander_date', 
      db_id: 8,
      index: process.env.INSTA_DATABASE
    },
    linkedin: {
      table: 'linkedin_ad_domains',
      dateField: 'created',
      totalCountTable: 'linkedin_ad',
      totalCountDateField: 'created_at',
      db_id: 2,
      index: process.env.LINKEDIN_DATABASE
    },
    gtext: {
      table: 'google_text_ad_domains',
      dateField: 'created_date',
      totalCountTable: 'google_text_ad',
      totalCountDateField: 'created_date',
      db_id: 9,
      index: process.env.GT_DATABASE,
    },
    youtube: {
      table: 'youtube_ad_domains',
      dateField: 'created_date',
      totalCountTable: 'youtube_ad',
      totalCountDateField: 'created_date',
      db_id: 1,
      index: process.env.YT_DATABASE
    }
  };

async function getDomainMetrics(network, range) {
    const config = networkConfig[network];
    /* v8 ignore next 3 -- both paths are exercised by tests (valid networks return data, unknown networks throw), but v8 does not credit the non-throw continuation here */
    if (!config) {
      throw new Error(`Unsupported network: ${network}`);
    }

    const { table, dateField, db_id, index, totalCountTable, totalCountField, totalCountDateField } = config;
    const fromStart = `${range.from} 00:00:00`;
    const toEnd = `${range.to} 23:59:59`;

    const detailedQuery = `
      SELECT COUNT(id) as total_domain_date_updated 
      FROM ${table}
      WHERE ${dateField} BETWEEN '${fromStart}' AND '${toEnd}'
    `;

    const totalCount = `
      SELECT COUNT(${totalCountField}) AS total_lander_ad_processed
      FROM ${totalCountTable}
      WHERE ${totalCountDateField} BETWEEN '${fromStart}' AND '${toEnd}'
    `;

    try {
      const [details, count] = await Promise.all([
        queryDatabase(db_id, index, detailedQuery), 
        queryDatabase(db_id, index, totalCount)     
      ]);

      return {
        network,
        total_domain_date_updated: details[0]?.total_domain_date_updated || 0, 
        total_lander_ad_processed: count[0]?.total_lander_ad_processed || 0 
      };
    } catch (err) {
      console.error('Error fetching metrics:', err);
      return null;
    }
}

// Per-account Country + IP enrichment for the System-Info "Account Wise
// Performance" table. Pulled SEPARATELY from the ad-count aggregation on
// purpose: for some networks the IP lives in a 1-to-many *_user_meta table,
// and LEFT JOINing that into the COUNT(*) ad query would multiply the ad
// totals. Keeping it standalone leaves the counts untouched.
//
//   country → per-network user table (current_country / country)
//   ip      → a column on the user table (reddit) or a meta table keyed by the
//             user PK (facebook/quora). Networks with neither return country-only.
//
// Always GROUP BY the account id so exactly one row comes back per account
// (user tables can hold duplicate rows for the same external account id).
const fetchAccountGeo = async (network, accountIds) => {
    const cfg = DB_DATA[network];
    if (!cfg?.userTable || !cfg.countryField || !cfg.accountFields?.id) return new Map();

    const ids = [...new Set((accountIds || []).map(String).filter(Boolean))];
    if (!ids.length) return new Map();

    const idCol = cfg.accountFields.id.replace(/^u\./, '');
    const ph = ids.map(() => '?').join(',');
    const ipCfg = cfg.ipConfig;

    let sql;
    if (ipCfg?.col) {
        // IP is a column on the user table itself (e.g. reddit_user.ip_address).
        sql = `SELECT \`${idCol}\` AS account_id, MAX(\`${cfg.countryField}\`) AS country, MAX(\`${ipCfg.col}\`) AS ip
               FROM \`${cfg.userTable}\` WHERE \`${idCol}\` IN (${ph}) GROUP BY \`${idCol}\``;
    } else if (ipCfg?.metaTable) {
        // IP lives in a meta table keyed by the user PK (e.g. user_meta.ip).
        sql = `SELECT u.\`${idCol}\` AS account_id, MAX(u.\`${cfg.countryField}\`) AS country, MAX(m.\`${ipCfg.metaIpCol}\`) AS ip
               FROM \`${cfg.userTable}\` u
               LEFT JOIN \`${ipCfg.metaTable}\` m ON m.\`${ipCfg.metaKey}\` = u.id
               WHERE u.\`${idCol}\` IN (${ph}) GROUP BY u.\`${idCol}\``;
    } else {
        // No IP source for this network — country only.
        sql = `SELECT \`${idCol}\` AS account_id, MAX(\`${cfg.countryField}\`) AS country, NULL AS ip
               FROM \`${cfg.userTable}\` WHERE \`${idCol}\` IN (${ph}) GROUP BY \`${idCol}\``;
    }

    try {
        const rows = await queryDatabase(cfg.db_id, cfg.index, sql, ids);
        const clean = (v) => {
            const s = (v ?? '').toString().trim();
            // Some user rows carry literal junk like "undefined"/"null".
            return s && !['undefined', 'null', 'n/a'].includes(s.toLowerCase()) ? s : null;
        };
        const map = new Map();
        for (const r of rows) {
            map.set(String(r.account_id), { country: clean(r.country), ip: clean(r.ip) });
        }
        return map;
    } catch (err) {
        console.error(`fetchAccountGeo(${network}) failed:`, err.message);
        return new Map();
    }
};

module.exports = { adCountAcrossSelectedNetworks,getDomainMetrics, fetchAccountGeo };