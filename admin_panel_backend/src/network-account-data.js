require('dotenv').config();
const queryDatabase = require('../db-connections/connection');
const NodeCache = require('node-cache');
const myCache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

const DB_DATA = {
  facebook: {
    createdAt: 'created_date',
    tableName: 'facebook_ad_users',
    db_id: 0,
    index: process.env.FB_DATABASE,
    userTable: 'facebook_users',
    userJoinKey: 'id',
    adJoinKey: 'user_id',
    userFields: ['id AS user_id', 'name', 'facebook_id', 'current_country', 'created_date']
  },
  instagram: {
    createdAt: 'created_date',
    tableName: 'instagram_ad_users',
    db_id: 1,
    index: process.env.INSTA_DATABASE,
    userTable: 'instagram_user',
    userJoinKey: 'id',
    adJoinKey: 'user_id',
    userFields: ['id AS user_id', 'name', 'instagram_id', 'current_country', 'created_date']
  },
  quora: {
    createdAt: 'created_date',
    tableName: 'quora_ad_users',
    db_id: 3,
    index: process.env.QUORA_DATABASE,
    userTable: 'quora_user',
    userJoinKey: 'id',
    adJoinKey: 'user_id',
    userFields: ['id AS user_id', 'name', 'quora_id', 'current_country', 'created_date']
  },
  reddit: {
    createdAt: 'created_date',
    tableName: 'reddit_ad_users',
    db_id: 7,
    index: process.env.REDDIT_DATABASE,
    userTable: 'reddit_user',
    userJoinKey: 'id',
    adJoinKey: 'user_id',
    userFields: ['id AS user_id', 'reddit_username', 'id', 'current_country', 'created_date']
  },
  linkedin: {
    createdAt: 'created_at',
    tableName: 'linkedin_ad_users',
    db_id: 9,
    index: process.env.LINKEDIN_DATABASE,
    userTable: 'linkedin_users',
    userJoinKey: 'id',
    adJoinKey: 'user_id',
    userFields: ['id AS user_id', 'name', 'linkedin_id', 'current_country', 'created_at']
  }
};

// Helper to build the WHERE clause shared by both handlers
const buildFinalCondition = ({ tableName, createdAt, userTable, userFields }, { formattedFrom, formattedTo, name, country }) => {
  const dateCondition = `WHERE ${tableName}.${createdAt} BETWEEN '${formattedFrom}' AND '${formattedTo}'`;

  let nameCondition = '';
  if (name) {
    nameCondition = ` AND ${userTable}.${userFields[1]} LIKE '%${name}%'`;
  }

  let countryCondition = '';
  if (country) {
    countryCondition = ` AND ${userTable}.${userFields[3]} = '${country}'`;
  }

  return `${dateCondition}${nameCondition}${countryCondition}`;
};

// The main function to get account data with filters
const networkAccountDataWithFilter = async (req, res) => {
  try {
    const { network, fromDate, toDate, limit = 20, skip = 0, name, country } = req.body;

    // Check if the network exists
    if (!network || !DB_DATA[network]) {
      return res.status(400).json({ message: 'Please provide valid network' });
    }

    const config = DB_DATA[network];
    const { db_id, index, tableName, userTable, userJoinKey, adJoinKey, userFields } = config;

    // Normalize and format dates
    const formattedFrom = fromDate ? fromDate : '2000-01-01 00:00:00';
    const formattedTo = toDate ? toDate : getTodayDate();

    // Generate a cache key based on the parameters
    const cacheKey = `${network}:${formattedFrom}:${formattedTo}:${limit}:${skip}:${name || 'null'}:${country || 'null'}`;

    // Check if the result is cached
    const cachedData = myCache.get(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        code: 200,
        message: 'success',
        data: cachedData
      });
    }

    // Build the WHERE clause (date + optional name/country filters)
    const finalCondition = buildFinalCondition(config, { formattedFrom, formattedTo, name, country });

    const userFieldsSelect = userFields.map(f => `${userTable}.${f}`).join(', ');
    const userFieldsGroupBy = userFields.map(f => `${userTable}.${f.split(' AS ')[0]}`).join(', ');

    const query = `
      SELECT 
        ${userFieldsSelect},
        COUNT(${tableName}.id) AS ad_count
      FROM 
        ${tableName}
      JOIN 
        ${userTable} ON ${userTable}.${userJoinKey} = ${tableName}.${adJoinKey}
      ${finalCondition}
      GROUP BY 
        ${userFieldsGroupBy}
      LIMIT ${limit} OFFSET ${skip};
    `;

    // Run the query
    const rawData = await queryDatabase(db_id, index, query);

    // Store the result in the cache for future requests
    myCache.set(cacheKey, rawData);

    // Return the response with the fetched data
    return res.status(200).json({
      code: 200,
      message: 'success',
      data: rawData
    });

  } catch (error) {
    console.error('Error fetching ad user data:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

const currentCount = async (req, res) => {
  try {
    const { network, fromDate, toDate, limit = 20, skip = 0, name, country } = req.body;

    // Check if the network exists
    if (!network || !DB_DATA[network]) {
      return res.status(400).json({ message: 'Please provide valid network' });
    }

    const config = DB_DATA[network];
    const { db_id, index, tableName, userTable, userJoinKey, adJoinKey, userFields } = config;

    // Normalize and format dates
    const formattedFrom = fromDate ? fromDate : '2000-01-01 00:00:00';
    const formattedTo = toDate ? toDate : getTodayDate();

    // Generate a cache key based on the parameters
    const cacheKey = `${network}:${formattedFrom}:${formattedTo}:${limit}:${skip}:${name || 'null'}:${country || 'null'}`;

    // Check if the result is cached
    const cachedData = myCache.get(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        code: 200,
        message: 'success',
        data: cachedData
      });
    }

    // Build the WHERE clause (date + optional name/country filters)
    const finalCondition = buildFinalCondition(config, { formattedFrom, formattedTo, name, country });

    const userFieldsSelect = userFields.map(f => `${userTable}.${f}`).join(', ');
    const userFieldsGroupBy = userFields.map(f => `${userTable}.${f.split(' AS ')[0]}`).join(', ');

    const query = `
      SELECT 
        ${userFieldsSelect},
        COUNT(${tableName}.id) AS ad_count
      FROM 
        ${tableName}
      JOIN 
        ${userTable} ON ${userTable}.${userJoinKey} = ${tableName}.${adJoinKey}
      ${finalCondition}
      GROUP BY 
        ${userFieldsGroupBy}
      LIMIT ${limit} OFFSET ${skip};
    `;

    // Run the query
    const rawData = await queryDatabase(db_id, index, query);

    // Store the result in the cache for future requests
    myCache.set(cacheKey, rawData);

    // Return the response with the fetched data
    return res.status(200).json({
      code: 200,
      message: 'success',
      data: rawData
    });

  } catch (error) {
    console.error('Error fetching ad user data:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

const getTodayDate = () => {
  const now = new Date();

  // Get year, month, day, hours, minutes, and seconds
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0'); // months are 0-based, so we add 1
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  // Return the formatted date string
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

module.exports = { networkAccountDataWithFilter, currentCount };