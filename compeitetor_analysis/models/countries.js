
import {pool} from '../resources/database/db.js'
import logger from '../resources/logs/logger.log.js'

async function getAllCountries() {
    try{
        const [rows] = await pool.execute('SELECT id,name FROM countries ORDER BY id ASC');
        return rows;

    } catch (err){
        logger.error(`error in get all countries query : ${err.message}`);
        throw err;
    }
}

export { getAllCountries };
