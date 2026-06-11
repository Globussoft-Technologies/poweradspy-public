require("dotenv").config();

const fetchAgentData = async (req, res) => {
  try {
    res.json({
      wsUrl: process.env.WS_URL || "WS_URL not set",
      apiKey: process.env.API_KEY || "API_KEY not set",
    });
  } catch (error) {
    console.error("Error fetching agent data:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

module.exports = { fetchAgentData };