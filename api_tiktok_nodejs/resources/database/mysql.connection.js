import db from "../../Sequelize_cli/models/index.js";
import logger from "../logs/logger.log.js";
class DbConnect {
  async initialize() {
    try {
      const connection = await db.sequelize.sync({
        force: false,
        logging: false,
      });

      if (connection) {
        logger.info("Mysql database connected");
        // console.log("Mysql database connected");
      }
    } catch (err) {
      logger.error(`My sql connection error :${err.message}`);
      // console.log(`My sql connection error :${err.message}`);
      throw err;
    }
  }
}

export default DbConnect;
