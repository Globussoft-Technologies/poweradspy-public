const NodeCache = require("node-cache");

const cache = new NodeCache({
  stdTTL: 180,       // Default time-to-live: 3 minutes
  checkperiod: 60,   // Check for expired keys every 60 seconds
});

module.exports = cache;