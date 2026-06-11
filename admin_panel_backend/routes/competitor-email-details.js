const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const logger = require("../utils/logger");

router.get("/get-email-details", async (req, res) => {
  try {
    const { page = 1, limit = 10, sort = "date", order = "desc", search = "", emailStatus, startDate, endDate, startUpdatedDate, endUpdatedDate } = req.query;
    const pageNum = parseInt(page);
    const pageSize = parseInt(limit);
    const skip = (pageNum - 1) * pageSize;


    const db = mongoose.connection.db;
    const competitorsRequestCol = db.collection("competitors_requests");

    // Build match stage for search and filters
    let matchStage = {};

    // Create a match stage for stats (without email_status filter)
    let matchStageForStats = {};

    // Add email_status filter (only to matchStage, not matchStageForStats)
    if (emailStatus !== undefined && emailStatus !== "") {
      const statusNum = parseInt(emailStatus, 10);
      matchStage.email_status = statusNum;
    }

    // Add date range filter for Request Date (createdAt) - to both matchStage and matchStageForStats
    if (startDate || endDate) {
      const dateFilter = {};
      if (startDate) {
        dateFilter.$gte = new Date(startDate);
      }
      if (endDate) {
        const endDateObj = new Date(endDate);
        endDateObj.setHours(23, 59, 59, 999);
        dateFilter.$lte = endDateObj;
      }
      matchStage.createdAt = dateFilter;
      matchStageForStats.createdAt = dateFilter;
    }

    // Add date range filter for Updated Date (updatedAt) - to both matchStage and matchStageForStats
    if (startUpdatedDate || endUpdatedDate) {
      const dateFilter = {};
      if (startUpdatedDate) {
        dateFilter.$gte = new Date(startUpdatedDate);
      }
      if (endUpdatedDate) {
        const endDateObj = new Date(endUpdatedDate);
        endDateObj.setHours(23, 59, 59, 999);
        dateFilter.$lte = endDateObj;
      }
      matchStage.updatedAt = dateFilter;
      matchStageForStats.updatedAt = dateFilter;
    }

    // Determine sort field and order
    let sortField = "createdAtOriginal";
    let sortOrder = order === "asc" ? 1 : -1;

    if (sort === "username") {
      sortField = "user_name";
      sortOrder = order === "asc" ? 1 : -1;
    }
    if (sort === "userid") {
      sortField = "user_id";
      sortOrder = order === "asc" ? 1 : -1;
    }
    if (sort === "date") {
      sortField = "createdAtOriginal";
      sortOrder = order === "asc" ? 1 : -1;
    }


    // Aggregation pipeline
    const pipeline = [];

    // Add match stage first if there are filters
    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    // Add lookups and transformations
    pipeline.push(
      {
        $lookup: {
          from: "user_details",
          localField: "user_id",
          foreignField: "_id",
          as: "user",
        },
      },
      {
        $unwind: {
          path: "$user",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $match: {
          user: { $exists: true, $ne: null }
        }
      },
      {
        $lookup: {
          from: "competitors",
          localField: "monitoring",
          foreignField: "_id",
          as: "trackedBrands",
        },
      },
      {
        $addFields: {
          user_id_str: { $toString: "$user_id" },
          user_db_id_str: { $ifNull: [{ $toString: "$user._id" }, "N/A"] },
          amember_id: { $ifNull: [{ $toString: "$user.amember_id" }, "N/A"] },
          user_name: { $ifNull: ["$user.userName", "N/A"] },
          user_email: { $ifNull: ["$user.email", "N/A"] },
          competitor_searched: { $ifNull: ["$brand_url", "N/A"] },
          brands_tracked: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ["$trackedBrands", []] } }, 0] },
              {
                $map: {
                  input: "$trackedBrands",
                  as: "brand",
                  in: {
                    name: "$$brand.competitor_name",
                    url: "$$brand.competitor_url",
                    facebook_status: "$$brand.facebook_status",
                    instagram_status: "$$brand.instagram_status",
                    youtube_status: "$$brand.youtube_status",
                  },
                },
              },
              [],
            ],
          },
          networks: "$trackedBrands",
          email_status: { $toInt: { $toString: "$email_status" } },
          createdAt: { $dateToString: { format: "%d-%m-%Y", date: "$createdAt" } },
          updatedAt: { $dateToString: { format: "%d-%m-%Y", date: { $ifNull: ["$updatedAt", "$createdAt"] } } },
          createdAtOriginal: "$createdAt",
        },
      }
    );

    // Add search match after field transformations
    if (search) {
      const isObjectId = /^[0-9a-f]{24}$/i.test(search); // 24 hex chars = ObjectId
      const isNumeric = /^\d+$/.test(search); // All digits
      const isDate = /^\d{1,2}-\d{1,2}-\d{4}$/.test(search); // DD-MM-YYYY format

      let matchQuery;
      let searchType = "unknown";

      if (isDate) {
        searchType = "date";
        matchQuery = {
          createdAt: { $regex: search, $options: "i" }
        };
      } else {
        searchType = "text";
        matchQuery = {
          $or: [
            { user_name: { $regex: search, $options: "i" } },
            { amember_id: { $regex: search, $options: "i" } },
            { user_id_str: { $regex: search, $options: "i" } },
            { user_db_id_str: { $regex: search, $options: "i" } },
            { competitor_searched: { $regex: search, $options: "i" } }
          ]
        };
      }

      pipeline.push({
        $match: matchQuery
      });

    }

    // Add sort stage
    const sortStage = {};
    sortStage[sortField] = sortOrder;
    pipeline.push({ $sort: sortStage });



    // Execute aggregation to get all documents
    let allData = await competitorsRequestCol.aggregate(pipeline).toArray();

    // Execute separate aggregation for stats (without email_status filter)
    const statsPipeline = [];
    if (Object.keys(matchStageForStats).length > 0) {
      statsPipeline.push({ $match: matchStageForStats });
    }
    statsPipeline.push(
      {
        $lookup: {
          from: "user_details",
          localField: "user_id",
          foreignField: "_id",
          as: "user",
        },
      },
      {
        $unwind: {
          path: "$user",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $match: {
          user: { $exists: true, $ne: null }
        }
      },
      {
        $lookup: {
          from: "competitors",
          localField: "monitoring",
          foreignField: "_id",
          as: "trackedBrands",
        },
      },
      {
        $addFields: {
          email_status: { $toInt: { $toString: "$email_status" } }
        },
      }
    );
    let statsData = await competitorsRequestCol.aggregate(statsPipeline).toArray();


    // Process networks from trackedBrands
    allData = allData.map(item => {
      const networks = [];
      if (Array.isArray(item.networks) && item.networks.length > 0) {
        item.networks.forEach(brand => {
          if (brand.facebook_status === 1) networks.push("facebook");
          if (brand.instagram_status === 1) networks.push("instagram");
          if (brand.youtube_status === 1) networks.push("youtube");
        });
      }
      return { ...item, networks };
    });

    // Paginate (based on filtered data for display)
    const total = allData.length;
    const data = allData.slice(skip, skip + pageSize);

    // Calculate total counts for ENTIRE UNFILTERED dataset (stats don't change with email_status toggle)
    const totalRecords = statsData.length;
    const totalEmailsSent = statsData.filter(item => item.email_status === 1).length;
    const totalEmailsPending = statsData.filter(item => item.email_status === 0).length;


    res.status(200).json({
      statusCode: 200,
      message: "Email details fetched successfully",
      body: {
        data: {
          data,
          totalCount: total,
          totalRecords,
          totalEmailsSent,
          totalEmailsPending,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      statusCode: 500,
      message: "Failed to fetch email details",
      error: error.message,
    });
  }
});

router.put("/update-email-status/:requestId", async (req, res) => {
  try {
    const { requestId } = req.params;
    const { email_status } = req.body;

    const db = mongoose.connection.db;
    const competitorsRequestCol = db.collection("competitors_requests");

    const result = await competitorsRequestCol.updateOne(
      { _id: new mongoose.Types.ObjectId(requestId) },
      { $set: { email_status: email_status } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        statusCode: 404,
        message: "Request not found",
      });
    }

    res.status(200).json({
      statusCode: 200,
      message: "Email status updated successfully",
      body: result,
    });
  } catch (error) {
    res.status(500).json({
      statusCode: 500,
      message: "Failed to update email status",
      error: error.message,
    });
  }
});

module.exports = router;
