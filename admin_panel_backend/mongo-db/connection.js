const mongoose = require("mongoose");
require("dotenv").config();

let isConnecting = false;
let connectPromise = null;

const connectToMongo = async () => {
  if (mongoose.connection.readyState === 1) {
    return; 
  }

  if (isConnecting && connectPromise) {
    return connectPromise; 
  }

  const dbType = process.env.MONGO_DB || "PAS";

  let mongoHost, mongoPort, mongoDatabase, mongoUsername, mongoPassword;

  if (dbType === "ADSGPT") {
    mongoHost = process.env.ADSGPT_MONGO_HOST;
    mongoPort = process.env.ADSGPT_MONGO_PORT || 27017;
    mongoDatabase = process.env.ADSGPT_MONGO_DATABASE;
    mongoUsername = process.env.ADSGPT_MONGO_USERNAME;
    mongoPassword = process.env.ADSGPT_MONGO_PASS;
  } else {
    // Default to PAS
    mongoHost = process.env.PAS_MONGO_HOST || "127.0.0.1";
    mongoPort = process.env.PAS_MONGO_PORT || 27017;
    mongoDatabase = process.env.PAS_MONGO_DATABASE || "pasdev_competitor";
    mongoUsername = process.env.PAS_MONGO_USERNAME;
    mongoPassword = process.env.PAS_MONGO_PASS;
  }

  let mongoURI;

  if (dbType === "ADSGPT") {
    // AdsGPT uses MongoDB Atlas (mongodb+srv)
    mongoURI = `mongodb+srv://${mongoUsername}:${mongoPassword}@${mongoHost}/${mongoDatabase}`;
  } else {
    // PAS uses direct IP connection (mongodb)
    if (mongoUsername && mongoPassword) {
      mongoURI = `mongodb://${mongoUsername}:${mongoPassword}@${mongoHost}:${mongoPort}/${mongoDatabase}`;
    } else {
      mongoURI = `mongodb://${mongoHost}:${mongoPort}/${mongoDatabase}`;
    }
  }

  isConnecting = true;

  connectPromise = mongoose.connect(mongoURI, {
    maxPoolSize: 10
  })
  .then(() => {
    console.log(`MongoDB connected to ${dbType} - ${mongoDatabase}`);
    isConnecting = false;
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err.message);
    isConnecting = false;
    throw err;
  });

  return connectPromise;
};

const getCollection =  (collectionName) => {
  if (mongoose.connection.readyState !== 1) {
    connectToMongo();
  }

  return mongoose.connection.db.collection(collectionName);
};

module.exports = { connectToMongo, getCollection };
