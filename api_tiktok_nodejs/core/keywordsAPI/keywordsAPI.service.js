import logger from "../../resources/logs/logger.log.js";
import Response from "../../utils/response.js";
import db from "../../Sequelize_cli/models/index.js";
import fs from "fs";
import path from "path"
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const keywordIndex = db.tiktok_keywords;
class KeywordsService {
    async addKeywords(req, res) {
        try {
        const {keywords} = req.body; 
        if(!keywords.length>0){
            return res.send(
                Response.userFailResp("Keyword NOT Found")
            );
        }
       const keywordObjects = keywords.map(keyword => ({ keyword: keyword }));
        const insertedData = await  keywordIndex.bulkCreate(keywordObjects)
        if (insertedData) {
            return res.send(
              Response.userSuccessResp("Keyword data inserted successfully", insertedData));
          }
      
          } catch (error) {
            // console.log(error);
            logger.error("Error fetching ads", error);
            return res.send(Response.userFailResp("Error fetching ads", error));
          }
    }

    async getKeywords(req, res) {
        try {
            let keyword = await keywordIndex.findOne({
                where: { status: 0 },
                order: [['id', 'DESC']], 
            });
            if (!keyword) {
                await keywordIndex.update({ status: 0 }, { where: {} });
                
                keyword = await keywordIndex.findOne({
                    where: { status: 0 },
                    order: [['id', 'DESC']],
                });
                if (!keyword) {
                    return res.send(Response.userFailResp("No keywords available."));
                }
            }
            await keywordIndex.update({ status: 1 }, { where: { id: keyword.id } });
            return res.send(
                Response.userSuccessResp("Keyword fetched successfully", keyword.keyword));
          } catch (error) {
            // console.log(error);
            logger.error("Error fetching ads", error);
            return res.send(Response.userFailResp("Error fetching ads", error));
          }
        }

    async getLogFiles(req, res) {
        try {
            const { day, month, year } = req.query;
    
            if (!day || !month || !year) {
                return res.send(Response.userFailResp("Day, month, and year parameters are required"));
            }
            const logsDirectory = path.join(__dirname, '..', '..', 'resources', 'logs', 'responselogs');

            if (!fs.existsSync(logsDirectory)) {
                return res.send(Response.userFailResp(`Directory does not exist: ${logsDirectory}`));
            }
            const logFileName = `users${day}-${month}-${year}.log`;
            const logFilePath = path.join(logsDirectory, logFileName);

            if (!fs.existsSync(logFilePath)) {
                return res.send(Response.userFailResp("No log file found for the given date"));
            }
    
            fs.readFile(logFilePath, 'utf-8', (err, fileContent) => {
                if (err) {
                    logger.error("Error reading log file", err);
                    return res.send(Response.userFailResp("Error reading log file", err));
                }
                return res.send(Response.userSuccessResp("Log file fetched successfully", fileContent));
            });
        } catch (error) {
            // console.error(error);
            logger.error("Error fetching log file", error);
            return res.send(Response.userFailResp("Error fetching log file", error));
        }
    }
}

export default new KeywordsService();
