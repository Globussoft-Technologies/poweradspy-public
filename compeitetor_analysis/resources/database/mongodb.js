import mongoose from "mongoose";
import config from "config";
import logger from "../logs/logger.log.js";

const MONGODB_URI = config.get("MONGODB_URI");

export const connectDB = async () => {
  try {
    const conn = await mongoose.connect(MONGODB_URI);
    console.log("connected to mongo db");
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.log(error.message);
    logger.error(`MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};
