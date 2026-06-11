require("dotenv").config();
const { getCollection } = require("../mongo-db/connection");
const axios = require('axios');
const { successResponse, errorResponse } = require("../utils/responseUtils");
const cache = require("../utils/cache");
const { MODEL_PRICING } = require("../config/pricing.config")

const AMEMBER_URL = process.env.AMEMBER_BASE_API_URL;
const APIKEY = process.env.AMEMBER_API_KEY;

const getUserIds = async (req, res) => {
  try {
    const cacheKey = "user_ids";
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      return successResponse(res, cachedData, "User list fetched (from cache)");
    }

   
    const usersCollection = getCollection("userinteractions");

    const users = await usersCollection
      .find({}, { projection: { user_id: 1, user_name: 1, user_email: 1, _id: 0 } })
      .toArray();

    cache.set(cacheKey, users); 
    return successResponse(res, users, "User list fetched");
  } catch (error) {
    console.log(error);
    return errorResponse(res, "Failed to fetch users");
  }
};

const getUserInteractionData = async (req, res) => {
  try {
    const { userid } = req.params;
    const cacheKey = `user_${userid}`;
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      return successResponse(res, cachedData, "User data fetched (from cache)");
    }

    
    const usersCollection = getCollection("userinteractions");

    const user = await usersCollection.findOne({ user_id: userid });

    if (!user) {
      return errorResponse(res, "User not found", 404);
    }

    cache.set(cacheKey, user); 
    return successResponse(res, user, "User data fetched");
  } catch (error) {
    return errorResponse(res, "Invalid user ID");
  }
};

const getUsersStats = async (req, res) => {
    try {
      const urlActive = `${AMEMBER_URL}/users?_key=${APIKEY}&_filter[status]=1`;
      const urlExpired = `${AMEMBER_URL}/users?_key=${APIKEY}&_filter[status]=2`;
      const urlTotal = `${AMEMBER_URL}/users?_key=${APIKEY}`

      const [activeRes, expiredRes, totalRes] = await Promise.all([
        axios.get(urlActive),
        axios.get(urlExpired),
        axios.get(urlTotal)
      ]);
      const activeUsers = activeRes.data._total || 0;
      const expiredUsers = expiredRes.data._total || 0;
      const totalUsers = totalRes.data._total || 0
  
      return successResponse(res, { activeUsers, expiredUsers, totalUsers }, "User stats fetched")
    } catch (error) {
      console.error("Error fetching user stats:", error);
    return errorResponse(res, "Error in amember api", 404);
  }
};

const getUserUsageCost = async (req, res) => {
  try {
    const { userid } = req.params;
    const { groupBy, from, to } = req.query;

    const usagesCollection = getCollection("usages");
    const userUsage = await usagesCollection.findOne({ userId: userid });

    if (!userUsage || !userUsage.usages?.length) {
      return successResponse(
        res,
        {
          userId: userid,
          total_input_tokens: 0,
          total_output_tokens: 0,
          total_cost_usd: 0,
          data: []
        },
        "No usage found"
      );
    }

    // ---------- DATE FILTER ----------
const parseDateOnly = (dateStr, isEnd = false) => {
  const [year, month, day] = dateStr.split("-").map(Number);

  return isEnd
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
};

let filteredUsages = userUsage.usages;

if (from || to) {
  const fromDate = from
    ? parseDateOnly(from, false)
    : new Date("1970-01-01");

  const toDate = to
    ? parseDateOnly(to, true)
    : new Date();

  filteredUsages = filteredUsages.filter((u) => {
    const created = new Date(u.createdAt);
    return created >= fromDate && created <= toDate;
  });
}

    // ---------- NO GROUPING (LIFETIME TOTAL) ----------
    if (!groupBy) {
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCost = 0;

      // for (const usage of filteredUsages) {
      //   const { model, input_tokens = 0, output_tokens = 0 } = usage;

      //   totalInputTokens += input_tokens;
      //   totalOutputTokens += output_tokens;

      //   if (model.startsWith("gpt")) {
      //     totalCost += (input_tokens / 1_000_000) * 8;
      //     totalCost += (output_tokens / 1_000_000) * 32;
      //   } else if (model.startsWith("gemini")) {
      //     totalCost += (input_tokens / 1_000_000) * 2;
      //     totalCost += (output_tokens / 1_000_000) * 120;
      //   } else if (model.startsWith("imagen")) {
      //     totalCost += 0.04;
      //   }
      // }

      for (const usage of filteredUsages) {
        const { model, input_tokens = 0, output_tokens = 0 } = usage;

        totalInputTokens += input_tokens;
        totalOutputTokens += output_tokens;

        const pricing = MODEL_PRICING[model];

        if (!pricing) {
          console.warn(`Unknown model pricing: ${model}`);
          continue; // or throw error if you want strict billing
        }

        if (pricing.per_image) {
          totalCost += pricing.per_image;
        } else {
          totalCost += (input_tokens / 1_000_000) * pricing.input_per_million;
          totalCost += (output_tokens / 1_000_000) * pricing.output_per_million;
        }
      }

      return successResponse(res, {
        userId: userid,
        total_input_tokens: totalInputTokens,
        total_output_tokens: totalOutputTokens,
        total_cost_usd: Number(totalCost.toFixed(4))
      }, "User usage cost fetched");
    }

    // ---------- GROUPED (DAY / MONTH) ----------
    const grouped = {};

    for (const usage of filteredUsages) {
      const date = new Date(usage.createdAt);

      const key =
        groupBy === "month"
          ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
          : date.toISOString().slice(0, 10); // YYYY-MM-DD

      if (!grouped[key]) {
        grouped[key] = {
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: 0
        };
      }

      const { model, input_tokens = 0, output_tokens = 0 } = usage;

      grouped[key].input_tokens += input_tokens;
      grouped[key].output_tokens += output_tokens;

      const pricing = MODEL_PRICING[model];

      if (!pricing) {
        console.warn(`Unknown model pricing: ${model}`);
        continue;
      }

      if (pricing.per_image) {
        grouped[key].cost_usd += pricing.per_image;
      } else {
        grouped[key].cost_usd += (input_tokens / 1_000_000) * pricing.input_per_million;
        grouped[key].cost_usd += (output_tokens / 1_000_000) * pricing.output_per_million;
      }
    }


    const data = Object.entries(grouped).map(([date, val]) => ({
      date,
      input_tokens: val.input_tokens,
      output_tokens: val.output_tokens,
      cost_usd: Number(val.cost_usd.toFixed(4))
    }));

    return successResponse(res, {
      userId: userid,
      groupBy,
      data
    }, "User usage graph data fetched");

  } catch (error) {
    console.error("Usage aggregation error:", error);
    return errorResponse(res, "Failed to fetch usage cost");
  }
};



module.exports = { getUserIds, getUserInteractionData, getUsersStats, getUserUsageCost };




