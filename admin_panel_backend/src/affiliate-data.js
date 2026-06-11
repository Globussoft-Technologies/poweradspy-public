require('dotenv').config();
const queryDatabase = require('../db-connections/connection');

// DS Q16: SELECT affiliate_data, COUNT(<fk>) AS num
//         FROM <net>_ad_meta_data
//         WHERE built_with_date >= yesterday AND built_with_date < today
//         GROUP BY affiliate_data
//
// LinkedIn reads from linkedin_ad_built_with (footnote §).
// Response key is `e_commerce` (kept for frontend compat, even though this
// endpoint returns affiliate networks not e-commerce platforms — the frontend
// filters `data.data.filter(item => item.e_commerce !== "")`).
const DB_DATA = {
    bing:      { tableName: 'bing_text_ad_meta_data',   fk: 'bing_text_ad_id', db_id: 10, index: process.env.BING_DATABASE },
    facebook:  { tableName: 'facebook_ad_meta_data',    fk: 'facebook_ad_id',  db_id: 0,  index: process.env.FB_DATABASE },
    gdn:       { tableName: 'gdn_ad_meta_data',         fk: 'id',              db_id: 5,  index: process.env.GDN_DATABASE },
    google:    { tableName: 'google_text_ad_meta_data', fk: 'id',              db_id: 9,  index: process.env.GT_DATABASE },
    instagram: { tableName: 'instagram_ad_meta_data',   fk: 'id',              db_id: 8,  index: process.env.INSTA_DATABASE },
    linkedin:  { tableName: 'linkedin_ad_built_with',   fk: 'linkedin_ad_id',  db_id: 2,  index: process.env.LINKEDIN_DATABASE },
    native:    { tableName: 'native_ad_meta_data',      fk: 'id',              db_id: 3,  index: process.env.NATIVE_DATABASE },
    pinterest: { tableName: 'pinterest_ad_meta_data',   fk: 'id',              db_id: 6,  index: process.env.PINT_DATABASE },
    quora:     { tableName: 'quora_ad_meta_data',       fk: 'id',              db_id: 7,  index: process.env.QUORA_DATABASE },
    reddit:    { tableName: 'reddit_ad_meta_data',      fk: 'id',              db_id: 4,  index: process.env.REDDIT_DATABASE },
    youtube:   { tableName: 'youtube_ad_meta_data',     fk: 'id',              db_id: 1,  index: process.env.YT_DATABASE },
};

const affiliateWithFilter = async (req, res) => {
    try {
        const { built_with, range, network } = req.body;
        if (!network || !DB_DATA[network]) {
            return res.status(400).json({ message: 'Please provide valid network' });
        }

        const { tableName, fk, db_id, index } = DB_DATA[network];
        const hasRange = range && range.from && range.to;
        const fromTs = hasRange ? `${range.from} 00:00:00` : null;
        const toTs   = hasRange ? `${range.to} 23:59:59`   : null;

        if (built_with) {
            let sql = `SELECT COUNT(${fk}) AS cnt FROM ${tableName} WHERE affiliate_data = ?`;
            const params = [built_with];
            if (hasRange) {
                sql += ' AND built_with_date BETWEEN ? AND ?';
                params.push(fromTs, toTs);
            }
            const rows = await queryDatabase(db_id, index, sql, params);
            return res.status(200).json({
                type: 'count',
                total: Number(rows?.[0]?.cnt || 0),
                data: [],
                search_after: null,
            });
        }

        let sql = `SELECT affiliate_data, COUNT(${fk}) AS num FROM ${tableName}`;
        const params = [];
        if (hasRange) {
            sql += ' WHERE built_with_date BETWEEN ? AND ?';
            params.push(fromTs, toTs);
        }
        sql += ' GROUP BY affiliate_data ORDER BY num DESC';

        const rows = await queryDatabase(db_id, index, sql, params);
        const data = (rows || []).map((r) => ({ e_commerce: r.affiliate_data, count: Number(r.num || 0) }));
        const total = data.reduce((acc, r) => acc + r.count, 0);

        return res.status(200).json({
            type: 'agg',
            total: { value: total, relation: 'eq' },
            data,
            search_after: null,
        });
    } catch (error) {
        console.error('Error fetching affiliate stats:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = { affiliateWithFilter };
