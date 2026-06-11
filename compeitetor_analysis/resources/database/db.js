import mysql from 'mysql2/promise';
import config from "config";
import logger from "../logs/logger.log.js";

const pool = mysql.createPool({
    host: config.get('DB_HOST'),
    user: config.get('DB_USERNAME'),
    password: config.get('DB_PASSWORD'),
    database: config.get('DB_DATABASE'),
    port: config.get('DB_PORT'),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0

});

async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('Connected to my sql data base');
        connection.release();


    } catch(err){
        console.error('Database connection failed',err);
        logger.error(`Mysql2 Connection Error: ${err.message}`);
    }
} 

export {pool,testConnection};