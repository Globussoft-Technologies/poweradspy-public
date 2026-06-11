
import axios from "axios";
import cron from "node-cron";
import config from "config";
import { getUpdates } from "./elasticSearch.js";
import logger from "../resources/logs/logger.log.js";
const TELEGRAM_BOT_TOKEN = config.get("teligram_bot_token");
const TELEGRAM_CHAT_ID = config.get("teligram_chat_id");

// Function to send a message to the Telegram group
async function sendToTelegram(message) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    try {
        await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
        });
        logger.info("Message sent to Telegram");
    } catch (error) {
        console.error("Failed to send message:", error);
        logger.error("Failed to send message:", error);
    }
}

// Function to get the updates and send to Telegram
async function runScheduledTask() {
    try {
        const message = await getUpdates();
        await sendToTelegram(message);
    } catch (err) {
        console.error("Error in scheduled task:", err);
        logger.error("Error in scheduled task:", err);
    }
}

// Run the cron job every day at 10 AM
export async function runCronJob() {
    cron.schedule("0 10 * * *", () => {
        logger.info("Running the Cron Job");
        runScheduledTask();
      },
      {
        timezone: "Asia/Kolkata" 
     });
}


