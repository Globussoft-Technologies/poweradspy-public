require('dotenv').config();
const queryDatabase = require('../db-connections/connection');

// DS-team query mapping (see QUERIES_DOCUMENTATION.md, Q2 & Q3).
// firstSeenCol → Q2 (Pinterest / YouTube use created_date instead of first_seen)
// gdnQ3Quirk   → Q3 has extra `AND first_seen < to` clause for GDN

// DS expresses a day's window as 12am→12am with an EXCLUSIVE next-midnight upper
// bound (`col >= <day> AND col < <day+1>`). Add one calendar day to a YYYY-MM-DD
// string; UTC-safe so there's no local-offset drift.
function nextDay(dateStr) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
}

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

        // 12am→12am window: inclusive start midnight, exclusive next-midnight end.
        // DS maps `yesterday`→fromTs and `today`→toTs; we generalise that to any
        // selected range. DS's "Total Ads" query is open-ended (`last_seen >= from`)
        // only because their cron runs at ~midnight, capping it at "now" ≈ today's
        // 12am. The admin panel can be called any time for any range, so we make
        // that upper bound EXPLICIT — otherwise the count ignores `range.to` and
        // includes everything still seen up to the request moment.
        const fromTs = `${range.from} 00:00:00`;
        const toTs   = `${nextDay(range.to)} 00:00:00`;

        // Q2 (Unique Ads card): new ads first seen inside the window.
        const newCountSql    = `SELECT COUNT(id) AS cnt FROM ${mainTable} WHERE ${firstSeenCol} >= ? AND ${firstSeenCol} < ?`;
        // Q3 (Total Ads card): ads still active inside the window — last_seen in
        // [from, to). GDN keeps the DS per-network shape (bounds first_seen instead).
        const activeCountSql = gdnQ3Quirk
            ? `SELECT COUNT(id) AS cnt FROM ${mainTable} WHERE ${lastSeenCol} >= ? AND ${firstSeenCol} < ?`
            : `SELECT COUNT(id) AS cnt FROM ${mainTable} WHERE ${lastSeenCol} >= ? AND ${lastSeenCol} < ?`;

        const newCountParams    = [fromTs, toTs];
        const activeCountParams = [fromTs, toTs];

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
