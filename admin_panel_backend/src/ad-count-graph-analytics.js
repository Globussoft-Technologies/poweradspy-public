require('dotenv').config()
const queryDatabase = require('../db-connections/connection');
const Redis = require("ioredis");
const memCache = require('../utils/cache'); // in-memory fallback — keeps working if Redis is down
const DB_DATA = {
    facebook: { createdAt: 'first_seen', tableName: 'facebook_ad', db_id: 0, index: process.env.FB_DATABASE },
    youtube: { createdAt: "created_date", tableName: "youtube_ad_meta_data", db_id: 1, index: process.env.YT_DATABASE },
    linkedin: { createdAt: "created_at", tableName: "linkedin_ad_meta_data", db_id: 2, index: process.env.LINKEDIN_DATABASE },
    native: { createdAt: "created_date", tableName: "native_ad_meta_data", db_id: 3, index: process.env.NATIVE_DATABASE },
    reddit: { createdAt: "created_date", tableName: "reddit_ad_meta_data", db_id: 4, index: process.env.REDDIT_DATABASE },
    gdn: { createdAt: "created_date", tableName: "gdn_ad_meta_data", db_id: 5, index: process.env.GDN_DATABASE },
    pinterest: { createdAt: "created_date", tableName: "pinterest_ad_meta_data", db_id: 6, index: process.env.PINT_DATABASE },
    quora: { createdAt: "created_date", tableName: "quora_ad_meta_data", db_id: 7, index: process.env.QUORA_DATABASE },
    instagram: { createdAt: "created_date", tableName: "instagram_ad_meta_data", db_id: 8, index: process.env.INSTA_DATABASE },
    google: { createdAt: "created_date", tableName: "google_text_ad_meta_data", db_id: 9, index: process.env.GT_DATABASE },
    bing: { createdAt: "created_date", tableName: "bing_text_ad_meta_data", db_id: 10, index: process.env.BING_DATABASE },
    
}

const redisClient = new Redis({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    password: process.env.REDIS_PASSWORD,
    retryStrategy: () => null,
    // When Redis is down, fail fast (don't queue/hang the request — that was a
    // big cause of the backend resource spike). We fall back to in-memory cache.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
});
// Swallow connection errors so a dead Redis never crashes the process or spams;
// reads/writes below are wrapped to degrade to the in-memory cache gracefully.
redisClient.on('error', () => {});
const redisGet = async (k) => { try { return await redisClient.get(k); } catch (e) { return null; } };
const redisSet = async (k, v, ...a) => { try { await redisClient.set(k, v, ...a); } catch (e) { /* ignore */ } };
const adCountGraphFilter = async (req, res) => {

    try {
        const { network } = req.body;

        if (!network || !DB_DATA[network]) {
            return res.status(400).json({ message: "Please provide valid network" });
        }
        const redisKey = `adCountGraph:${network}`;
        const today = new Date();

        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        const startDateStr = `${start.toISOString().split("T")[0]} 00:00:00`;
        const endDateStr = `${end.toISOString().split("T")[0]} 23:59:59`;

        const cachedRaw = await redisGet(redisKey);
        // Redis hit → parse it; Redis down/miss → fall back to in-memory cache.
        let cachedData = cachedRaw ? JSON.parse(cachedRaw) : (memCache.get(redisKey) || null);

        if (!cachedData) {
            const fromDate = new Date(today.getFullYear(), today.getMonth() - 5, 1);
            const lastSixMonthDate = fromDate.toISOString().split("T")[0];

            const fullQuery = `
            SELECT 
                platform,
                MONTH(${DB_DATA[network]['createdAt']}) AS month,
                COUNT(*) AS total_ads
            FROM 
                ${DB_DATA[network]['tableName']}
            WHERE 
                ${DB_DATA[network]['createdAt']} > '${lastSixMonthDate} 23:59:59'
            GROUP BY 
                platform, month`;

            const fullRawData = await queryDatabase(DB_DATA[network]['db_id'], DB_DATA[network]['index'], fullQuery);
            const platforms = new Map();
            const months = [...new Set(fullRawData?.map(item => item?.month))]?.sort();

            fullRawData?.forEach(({ month, platform, total_ads }) => {
                if (!platforms?.has(platform)) {
                    platforms?.set(platform, { platform, data: new Array(months?.length).fill(0) });
                }
                const index = months?.indexOf(month);
                platforms.get(platform).data[index] = total_ads;
            });

            cachedData = Array.from(platforms?.values());


            const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
            const ttlInSeconds = Math.floor((nextMonth.getTime() - today.getTime()) / 1000);

            await redisSet(redisKey, JSON.stringify(cachedData), 'EX', ttlInSeconds);
            memCache.set(redisKey, cachedData, ttlInSeconds); // mirror to in-memory so it survives a Redis outage
        } else {
            const monthlyQuery = `
        SELECT 
            platform,
            COUNT(1) AS total_ads
        FROM 
            ${DB_DATA[network]['tableName']}
        WHERE 
            ${DB_DATA[network]['createdAt']} >= '${startDateStr}' 
            AND ${DB_DATA[network]['createdAt']} <= '${endDateStr}'
        GROUP BY 
            platform`;
            const rawData = await queryDatabase(DB_DATA[network]['db_id'], DB_DATA[network]['index'], monthlyQuery);
            cachedData?.forEach(platformData => {
                const updated = rawData?.find(r => r?.platform === platformData?.platform);
                if (updated) {
                    const index = platformData?.data?.length - 1;
                    platformData.data[index] = updated?.total_ads;
                }
            });

            const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
            const ttlInSeconds = Math.floor((nextMonth.getTime() - today.getTime()) / 1000);

            await redisSet(redisKey, JSON.stringify(cachedData), 'EX', ttlInSeconds);
            memCache.set(redisKey, cachedData, ttlInSeconds); // mirror to in-memory so it survives a Redis outage

        }

        return res.status(200).json({
            code: 200,
            message: "success",
            data: cachedData,
        });
    } catch (error) {
        console.error("Error fetching ad counts:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};


module.exports = { adCountGraphFilter };