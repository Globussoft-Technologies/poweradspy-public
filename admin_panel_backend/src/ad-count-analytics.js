require('dotenv').config();
const queryDatabase = require('../db-connections/connection');

// DS Q5: SELECT platform, COUNT(<fk>) AS num FROM <net>_ad_meta_data
//        WHERE created_date >= yesterday AND created_date < today GROUP BY platform
//
// Per-network deviations (QUERIES_DOCUMENTATION.md):
//   - Facebook Q5 reads from facebook_ad (main table), not _meta_data — footnote †
//   - LinkedIn uses created_at, not created_date — footnote ‡
//   - Bing / Facebook / LinkedIn count their FK column (bing_text_ad_id /
//     facebook_ad_id / linkedin_ad_id); everyone else counts id.
//
// The frontend hits this endpoint once per platform (3, 10, 12, 15) and reads
// data[0].total_ads, so we keep the per-platform filter shape rather than
// switching to GROUP BY.
const DB_DATA = {
    bing:      { tableName: 'bing_text_ad_meta_data',   createdAt: 'created_date', fk: 'bing_text_ad_id', db_id: 10, index: process.env.BING_DATABASE },
    facebook:  { tableName: 'facebook_ad',              createdAt: 'created_date', fk: 'id',              db_id: 0,  index: process.env.FB_DATABASE },
    gdn:       { tableName: 'gdn_ad_meta_data',         createdAt: 'created_date', fk: 'id',              db_id: 5,  index: process.env.GDN_DATABASE },
    google:    { tableName: 'google_text_ad_meta_data', createdAt: 'created_date', fk: 'id',              db_id: 9,  index: process.env.GT_DATABASE },
    instagram: { tableName: 'instagram_ad_meta_data',   createdAt: 'created_date', fk: 'id',              db_id: 8,  index: process.env.INSTA_DATABASE },
    linkedin:  { tableName: 'linkedin_ad_meta_data',    createdAt: 'created_at',   fk: 'linkedin_ad_id',  db_id: 2,  index: process.env.LINKEDIN_DATABASE },
    native:    { tableName: 'native_ad_meta_data',      createdAt: 'created_date', fk: 'id',              db_id: 3,  index: process.env.NATIVE_DATABASE },
    pinterest: { tableName: 'pinterest_ad_meta_data',   createdAt: 'created_date', fk: 'id',              db_id: 6,  index: process.env.PINT_DATABASE },
    quora:     { tableName: 'quora_ad_meta_data',       createdAt: 'created_date', fk: 'id',              db_id: 7,  index: process.env.QUORA_DATABASE },
    reddit:    { tableName: 'reddit_ad_meta_data',      createdAt: 'created_date', fk: 'id',              db_id: 4,  index: process.env.REDDIT_DATABASE },
    youtube:   { tableName: 'youtube_ad_meta_data',     createdAt: 'created_date', fk: 'id',              db_id: 1,  index: process.env.YT_DATABASE },
};

const adCountFilter = async (req, res) => {
    try {
        const { platform, range, network } = req.body;
        if (!network || !DB_DATA[network] || !platform || !range) {
            return res.status(400).json({ message: 'Please provide valid network details' });
        }

        const { tableName, createdAt, fk, db_id, index } = DB_DATA[network];

        const sql = `SELECT platform, COUNT(${fk}) AS total_ads
                     FROM ${tableName}
                     WHERE ${createdAt} BETWEEN ? AND ?
                     AND platform = ?`;
        const params = [`${range.from} 00:00:00`, `${range.to} 23:59:59`, platform];

        const adCount = await queryDatabase(db_id, index, sql, params);

        return res.status(200).json({
            code: 200,
            message: 'success',
            data: adCount,
        });
    } catch (error) {
        console.error('Error fetching ad counts:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = { adCountFilter };
