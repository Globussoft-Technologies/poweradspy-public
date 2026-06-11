const winston = require('winston');
const path = require('path');

// Enhanced logger setup
const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ 
      filename: path.join(__dirname, '../logs/server.log'),
      maxsize: 1024 * 1024 * 5, 
      maxFiles: 5
    }),
    // new winston.transports.Console({
    //   format: winston.format.combine(
    //     winston.format.colorize(),
    //     winston.format.simple()
    //   )
    // })
  ]
});

module.exports = logger;