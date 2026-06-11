import express from "express";
import config from "config";
import swaggerUi from "swagger-ui-express";
import fs from "fs";
import path from "path";
import { SwaggerAuth } from "./utils/authentication.js";
import { esClient, esServers, checkElasticsearchHealth, closeClients } from "./utils/Elasticsearch.js";
import routes from "./resources/routes/routes.js";
import Logger from "./resources/logs/logger.log.js";
// import { pool, testConnection } from "./resources/database/db.js";
import { connectDB } from "./resources/database/mongodb.js";
import cors from "cors";
import http from "node:http";
import { initSocket } from "./utils/socket.js";
import { initDataReportCron } from "./core/mailer/dataReportCron.js";

const app = express();
app.use(cors({
  origin:"*"
}));
const __dirname = path.resolve();

const swaggerFile = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "resources", "views", "swagger-api-view.json"),
    "utf-8"
  )
);

app.use(
  "/api-docs",
  SwaggerAuth,
  swaggerUi.serve,
  swaggerUi.setup(swaggerFile)
);

// Stash the raw body so the SendGrid webhook can verify its signature.
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));
app.use("/public", express.static(path.join(__dirname, "public"), {
  maxAge: "30d",
  immutable: false,
}));
app.use("/api", routes);

// const startServer = async () => {
//   try {
//     Logger.info("Creating websocket instance");
//     const server = http.createServer(app); // Create HTTP server
//     initSocket(server); // Initialize Socket.IO with HTTP server
//     Logger.info("Checking Elasticsearch health...");
//     await checkElasticsearchHealth();
//     Logger.info("Connecting to SQL database...");
//     await testConnection();
//     Logger.info("Connecting to MongoDB...");
//     await connectDB();
//     const PORT = config.get("PORT") || 3000;
//     server.listen(PORT, () => {
//       Logger.info(`Server started at port ${PORT}`);
//     });
//   } catch (error) {
//     Logger.error(`Failed to start server: ${error.message}`);
//     process.exit(1);
//   }
// };

const startServer = async () => {
  try {
    console.log("🚀 Starting server initialization...");

    Logger.info("Creating websocket instance");

    const server = http.createServer(app); // Create HTTP server
    initSocket(server); // Initialize Socket.IO with HTTP server

    Logger.info("Checking Elasticsearch health...");
    console.log("🔍 Checking Elasticsearch health...");
    await checkElasticsearchHealth();
    console.log("✅ Elasticsearch is healthy");

    Logger.info("Connecting to SQL database...");
    // await testConnection();  // disabled during local testing — re-enable when SQL is reachable
    // console.log("✅ SQL database connected");

    Logger.info("Connecting to MongoDB...");
    await connectDB();
    console.log("✅ MongoDB connected");

    const PORT = config.get("PORT") || 3000;

    server.listen(PORT, () => {
      Logger.info(`Server started at port ${PORT}`);
    });

    // Daily data-report cron (03:00 IST). No-op unless config `cron` is true.
    initDataReportCron();
  } catch (error) {
    Logger.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
};



startServer();