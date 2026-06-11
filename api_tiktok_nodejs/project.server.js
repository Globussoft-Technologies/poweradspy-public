

import express from "express";
import config from "config";
import path from "path";
import fs from "fs";
import swaggerUi from "swagger-ui-express";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import fileStreamRotator from "file-stream-rotator";
import morgan from "morgan";
import { Server } from "http";
import cors from "cors";
import Routes from "./resources/routes/public.routes.js";
import Logger from "./resources/logs/logger.log.js";
import DbConnect from "./resources/database/mysql.connection.js";
import { SwaggerAuth } from "./utils/authentication.js";
import { runCronJob } from "./utils/cronJob.js";
const app = express();
const server = Server(app);

app.use(cors({ origin: "*" }));
app.use(helmet());
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "50mb" }));
app.use(cookieParser());

const __dirname = path.resolve();
const logDir = path.join(__dirname, "resources", "logs", "responselogs");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logStream = fileStreamRotator.getStream({
  filename: path.join(logDir, "%DATE%-logs.log"),
  frequency: "daily",
  verbose: false,
  datePattern: "YYYY-MM-DD",
  max_logs: "7d",
  size: "100M",
});

app.use(morgan("tiny", { stream: Logger.stream }));
if (app.get("env") !== "local") {
  app.use(morgan("dev"));
  app.use(
    morgan(":method :url :status :res[content-length] - :response-time ms", {
      stream: logStream,
    })
  );
}

const swaggerFile = JSON.parse(
  fs.readFileSync(path.join(__dirname, "resources", "views", "swagger-api-view.json"), "utf-8")
);

app.use("/explorer",SwaggerAuth, swaggerUi.serve, swaggerUi.setup(swaggerFile));
app.get("/", (req, res) => res.redirect("/explorer"));

app.use((req, res, next) => {
  res.set({
    Connection: "keep-alive",
    "Keep-Alive": "timeout=300",
  });
  next();
});

process
  .on("unhandledRejection", (reason, promise) => {
    Logger.error(
      `Unhandled Rejection: ${reason}, Promise: ${promise}`
    );
  })
  .on("warning", (warning) => {
    Logger.error(`Warning: ${warning}`);
  })
  .on("uncaughtException", (err) => {
    Logger.error(`Uncaught Exception: ${err}`);
    // process.exit(1);
  });

const startServer = () =>
  new Promise((resolve, reject) => {
    const port = process.env.PORT || config.get("user.port");
    server.listen(port, () => {
      Logger.info(
        `Service listening on ${process.env.HOST_URL || config.get("user.host_url")} in ${process.env.NODE_ENV} environment`
      );
    });
    if(process.env.NODE_ENV === "production" && process.env.NODE_APP_INSTANCE == 0) {
      runCronJob()
    }
    resolve(true);
  });

const dbConnect = new DbConnect();

dbConnect
  .initialize()
  .then(() => {
    new Routes(app);
    return startServer();
  })
  .catch((error) => {
    Logger.error(error.message);
  });
