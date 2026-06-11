require('dotenv').config();
const queryDatabase = require('../db-connections/connection');

// DS Q7: SELECT ad_position, COUNT(id) AS num FROM <net>_ad
//        WHERE first_seen >= yesterday AND first_seen < today GROUP BY ad_position
// All networks follow the standard pattern.
const DB_DATA = {
    bing:      { mainTable: 'bing_text_ad',   db_id: 10, index: process.env.BING_DATABASE },
    facebook:  { mainTable: 'facebook_ad',    db_id: 0,  index: process.env.FB_DATABASE },
    gdn:       { mainTable: 'gdn_ad',         db_id: 5,  index: process.env.GDN_DATABASE },
    google:    { mainTable: 'google_text_ad', db_id: 9,  index: process.env.GT_DATABASE },
    instagram: { mainTable: 'instagram_ad',   db_id: 8,  index: process.env.INSTA_DATABASE },
    linkedin:  { mainTable: 'linkedin_ad',    db_id: 2,  index: process.env.LINKEDIN_DATABASE },
    native:    { mainTable: 'native_ad',      db_id: 3,  index: process.env.NATIVE_DATABASE },
    pinterest: { mainTable: 'pinterest_ad',   db_id: 6,  index: process.env.PINT_DATABASE },
    quora:     { mainTable: 'quora_ad',       db_id: 7,  index: process.env.QUORA_DATABASE },
    reddit:    { mainTable: 'reddit_ad',      db_id: 4,  index: process.env.REDDIT_DATABASE },
    youtube:   { mainTable: 'youtube_ad',     db_id: 1,  index: process.env.YT_DATABASE },
};

const adPositionFilter = async (req, res) => {
    try {
        const { position, range, network } = req.body;
        if (!network || !DB_DATA[network]) {
            return res.status(400).json({ message: 'Please provide valid network' });
        }

        const { mainTable, db_id, index } = DB_DATA[network];
        const hasRange = range && range.from && range.to;
        const fromTs = hasRange ? `${range.from} 00:00:00` : null;
        const toTs   = hasRange ? `${range.to} 23:59:59`   : null;

        if (position) {
            let sql = `SELECT COUNT(id) AS cnt FROM ${mainTable} WHERE ad_position = ?`;
            const params = [position];
            if (hasRange) {
                sql += ' AND first_seen BETWEEN ? AND ?';
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

        let sql = `SELECT ad_position, COUNT(id) AS num FROM ${mainTable}`;
        const params = [];
        if (hasRange) {
            sql += ' WHERE first_seen BETWEEN ? AND ?';
            params.push(fromTs, toTs);
        }
        sql += ' GROUP BY ad_position ORDER BY num DESC';

        const rows = await queryDatabase(db_id, index, sql, params);
        const data = (rows || []).map((r) => ({ position: r.ad_position, count: Number(r.num || 0) }));
        const total = data.reduce((acc, r) => acc + r.count, 0);

        return res.status(200).json({
            type: 'agg',
            total: { value: total, relation: 'eq' },
            data,
            search_after: null,
        });
    } catch (error) {
        console.error('Error fetching ad position counts:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = { adPositionFilter };
