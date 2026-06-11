require('dotenv').config();
const queryDatabase = require('../db-connections/connection');

// DS-team query mapping (see QUERIES_DOCUMENTATION.md, Q2 & Q3).
// firstSeenCol → Q2 (Pinterest / YouTube use created_date instead of first_seen)
// gdnQ3Quirk   → Q3 has extra `AND first_seen < to` clause for GDN
const DB_DATA = {
    bing:      { mainTable: 'bing_text_ad',   firstSeenCol: 'first_seen',   lastSeenCol: 'last_seen', db_id: 10, index: process.env.BING_DATABASE },
    facebook:  { mainTable: 'facebook_ad',    firstSeenCol: 'first_seen',   lastSeenCol: 'last_seen', db_id: 0,  index: process.env.FB_DATABASE },
    gdn:       { mainTable: 'gdn_ad',         firstSeenCol: 'first_seen',   lastSeenCol: 'last_seen', db_id: 5,  index: process.env.GDN_DATABASE, gdnQ3Quirk: true },
    google:    { mainTable: 'google_text_ad', firstSeenCol: 'first_seen',   lastSeenCol: 'last_seen', db_id: 9,  index: process.env.GT_DATABASE },
    instagram: { mainTable: 'instagram_ad',   firstSeenCol: 'first_seen',   lastSeenCol: 'last_seen', db_id: 8,  index: process.env.INSTA_DATABASE },
    linkedin:  { mainTable: 'linkedin_ad',    firstSeenCol: 'first_seen',   lastSeenCol: 'last_seen', db_id: 2,  index: process.env.LINKEDIN_DATABASE },
    native:    { mainTable: 'native_ad',      firstSeenCol: 'first_seen',   lastSeenCol: 'last_seen', db_id: 3,  index: process.env.NATIVE_DATABASE },
    pinterest: { mainTable: 'pinterest_ad',   firstSeenCol: 'created_date', lastSeenCol: 'last_seen', db_id: 6,  index: process.env.PINT_DATABASE },
    quora:     { mainTable: 'quora_ad',       firstSeenCol: 'first_seen',   lastSeenCol: 'last_seen', db_id: 7,  index: process.env.QUORA_DATABASE },
    reddit:    { mainTable: 'reddit_ad',      firstSeenCol: 'first_seen',   lastSeenCol: 'last_seen', db_id: 4,  index: process.env.REDDIT_DATABASE },
    youtube:   { mainTable: 'youtube_ad',     firstSeenCol: 'created_date', lastSeenCol: 'last_seen', db_id: 1,  index: process.env.YT_DATABASE },
};

const rangeCountsFilter = async (req, res) => {
    try {
        const { network, range } = req.body;

        if (!network || !DB_DATA[network] || !range || !range.from || !range.to) {
            return res.status(400).json({ message: 'Please provide valid network and range' });
        }

        const { mainTable, firstSeenCol, lastSeenCol, db_id, index, gdnQ3Quirk } = DB_DATA[network];

        // Treat `range.from` and `range.to` as inclusive day boundaries.
        const fromTs = `${range.from} 00:00:00`;
        const toTs   = `${range.to} 23:59:59`;

        // Q2: COUNT(id) FROM <main> WHERE <firstSeenCol> BETWEEN from AND to
        const newCountSql    = `SELECT COUNT(id) AS cnt FROM ${mainTable} WHERE ${firstSeenCol} BETWEEN ? AND ?`;
        // Q3: COUNT(id) FROM <main> WHERE last_seen >= from (open-ended per DS doc).
        // GDN quirk: extra `first_seen < to` clause.
        const activeCountSql = gdnQ3Quirk
            ? `SELECT COUNT(id) AS cnt FROM ${mainTable} WHERE ${lastSeenCol} >= ? AND ${firstSeenCol} < ?`
            : `SELECT COUNT(id) AS cnt FROM ${mainTable} WHERE ${lastSeenCol} >= ?`;

        const newCountParams    = [fromTs, toTs];
        const activeCountParams = gdnQ3Quirk ? [fromTs, toTs] : [fromTs];

        const [newRows, activeRows] = await Promise.all([
            queryDatabase(db_id, index, newCountSql, newCountParams),
            queryDatabase(db_id, index, activeCountSql, activeCountParams),
        ]);

        const newCount    = Number(newRows?.[0]?.cnt || 0);
        const activeCount = Number(activeRows?.[0]?.cnt || 0);

        return res.status(200).json({
            code: 200,
            message: 'success',
            data: { newCount, activeCount },
        });
    } catch (error) {
        console.error('Error fetching range counts:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = { rangeCountsFilter };
