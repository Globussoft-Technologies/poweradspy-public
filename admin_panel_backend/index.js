require('events').defaultMaxListeners = 1000;
const express = require('express');
const { connectToMongo } = require("./mongo-db/connection");
const cors = require('cors');
const mainRoutes = require('./routes/main-routes');
const http = require('http');
const { initializeWebSocket } = require('./websocket/websocket');
const logger = require('./utils/logger'); 

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 4000;
const pmInstanceId = 0;



connectToMongo();

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/', (req, res) => res.status(200).json({ status_code: 200, message: "Admin panel server" }));

app.use('/admin-panel', mainRoutes);

initializeWebSocket(server, logger);

// Start server
const startServer = async () => {
  try {
    server.listen(PORT, () => {
      logger.info({ Worker_info: `Server is running on port ${PORT}`, server_id: pmInstanceId });
    });
  } catch (error) {
    logger.error({ Worker_error: error.message, server_id: pmInstanceId });
  }
};

startServer();

// Clean shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received - shutting down');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received - shutting down');
  server.close(() => {
    process.exit(0);
  });
});