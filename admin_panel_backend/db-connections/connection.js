

require('dotenv').config();
const mysql = require('mysql2/promise'); 

const ENV = process.env.NODE_ENV || 'development';
const configs = ENV === 'production'
  ? [
      { host: process.env.MYSQL_DB_HOST1, user: process.env.MYSQL_USER1, password: process.env.MYSQL_PASS1 },
      { host: process.env.MYSQL_DB_HOST2, user: process.env.MYSQL_USER2, password: process.env.MYSQL_PASS2 },
      { host: process.env.MYSQL_DB_HOST3, user: process.env.MYSQL_USER3, password: process.env.MYSQL_PASS3 },
      { host: process.env.MYSQL_DB_HOST4, user: process.env.MYSQL_USER4, password: process.env.MYSQL_PASS4 },
      { host: process.env.MYSQL_DB_HOST5, user: process.env.MYSQL_USER5, password: process.env.MYSQL_PASS5 },
      { host: process.env.MYSQL_DB_HOST6, user: process.env.MYSQL_USER6, password: process.env.MYSQL_PASS6 },
      { host: process.env.MYSQL_DB_HOST7, user: process.env.MYSQL_USER7, password: process.env.MYSQL_PASS7 },
      { host: process.env.MYSQL_DB_HOST8, user: process.env.MYSQL_USER8, password: process.env.MYSQL_PASS8 },
      { host: process.env.MYSQL_DB_HOST9, user: process.env.MYSQL_USER9, password: process.env.MYSQL_PASS9 },
      { host: process.env.MYSQL_DB_HOST10, user: process.env.MYSQL_USER10, password: process.env.MYSQL_PASS10 },
      { host: process.env.MYSQL_DB_HOST11, user: process.env.MYSQL_USER11, password: process.env.MYSQL_PASS11 }
    ]
  : [
      { host: process.env.MYSQL_DEV_HOST, user: process.env.MYSQL_DEV_USER, password: process.env.MYSQL_DEV_PASS },
    ];

const pools = new Map();
configs.forEach((config, index) => {
  const pool = mysql.createPool({
    ...config,
    waitForConnections: true,
    connectionLimit: 50,
    queueLimit: 100,
    connectTimeout: 10000,
  });
  pools.set(index, pool);
});

(async () => {
  for (const [index, pool] of pools) {
    const config = configs[index];
    try {
      const connection = await pool.getConnection();
      await connection.ping();
      console.log(`✅ MySQL connected: server ${index} (host: ${config.host}, user: ${config.user})`);
      connection.release();
    } catch (error) {
      console.error(`❌ MySQL connection FAILED: server ${index} (host: ${config.host}, user: ${config.user}) — ${error.message}`);
    }
  }
})();


process.on('SIGTERM', async () => {
  for (const [index, pool] of pools) {
    await pool.end();
    // console.log(`Closed pool for server ${index}`);
  }
  process.exit(0);
});


async function queryDatabase(serverIndex, databaseName, sql, params = []) {
  const start = Date.now();
  let pool;
  let connection;

  try {

    pool = ENV === 'production' ? pools.get(serverIndex) : pools.get(0);
    if (!pool) throw new Error(`No pool found for serverIndex ${serverIndex}`);

    connection = await pool.getConnection();

    await connection.query(`USE \`${databaseName}\``);

    const [rows] = await connection.query({
      sql,
      values: params,
      timeout: 60000, 
    });

    // console.log(`Query took ${Date.now() - start}ms for ${databaseName} on server ${serverIndex}`);
    return rows;
  } catch (error) {
    console.error(`Error querying ${databaseName} on server ${serverIndex}:`, error.message);
    throw error;
  } finally {
    if (connection) connection.release(); 
  }
}

module.exports = queryDatabase;