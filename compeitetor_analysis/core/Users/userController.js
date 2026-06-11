import User_details from "../../models/user_details.js";
import Competitors_request from "../../models/competitors_request.js";
import Response from "../../utils/response.js";
import logger from "../../resources/logs/logger.log.js";

/**
 * User endpoints. Reads from the `user_details` MongoDB collection.
 */
class userController {
  // GET /get-all-users  -> list of { id, name, email, totalBrands, totalCompetitors }
  async getAllUsers(req, res) {
    /*
      #swagger.tags = ['Users']
      #swagger.description = 'Fetch all users (id, name, email) with their total brand/competitor counts'
      #swagger.responses[200] = { description: 'Successfully fetched users' }
      #swagger.responses[400] = { description: 'Failed to fetch users' }
    */
    try {
      const docs = await User_details.find({}, { userName: 1, email: 1 })
        .sort({ createdAt: -1 })
        .lean();

      // Per-user brand/competitor totals in one pass over competitors_request.
      // Brands = distinct (trimmed, lowercased) advertiser names; competitors =
      // distinct competitor ids — same dedup rules as user-brand-stats.
      const statsAgg = await Competitors_request.aggregate([
        {
          $group: {
            _id: "$user_id",
            brandArrays: { $push: "$advertiser" },
            competitorArrays: { $push: "$competitors" },
            // Most recent brand/competitor activity for this user — the newest
            // of created/updated across all their requests (adding a competitor
            // to an existing request bumps updatedAt; a new brand bumps both).
            lastActivity: { $max: { $ifNull: ["$updatedAt", "$createdAt"] } },
          },
        },
        {
          $project: {
            lastActivity: 1,
            totalBrands: {
              $size: {
                $setUnion: [
                  {
                    $map: {
                      input: {
                        $reduce: {
                          input: "$brandArrays",
                          initialValue: [],
                          in: { $concatArrays: ["$$value", { $ifNull: ["$$this", []] }] },
                        },
                      },
                      as: "b",
                      in: { $toLower: { $trim: { input: "$$b" } } },
                    },
                  },
                  [],
                ],
              },
            },
            totalCompetitors: {
              $size: {
                $setUnion: [
                  {
                    $reduce: {
                      input: "$competitorArrays",
                      initialValue: [],
                      in: { $concatArrays: ["$$value", { $ifNull: ["$$this", []] }] },
                    },
                  },
                  [],
                ],
              },
            },
          },
        },
      ]);

      const statsByUser = new Map(
        statsAgg.map((s) => [String(s._id), s])
      );

      const users = docs.map((u) => {
        const s = statsByUser.get(String(u._id));
        return {
          id: u._id,
          name: u.userName,
          email: u.email,
          totalBrands: s?.totalBrands || 0,
          totalCompetitors: s?.totalCompetitors || 0,
          lastActivity: s?.lastActivity || null,
        };
      });

      return res.send(Response.userSuccessResp("users fetched", { users }));
    } catch (e) {
      logger.error(`getAllUsers: ${e.message}`);
      return res.send(Response.userFailResp("Failed to fetch users", e.message));
    }
  }
}

export default new userController();
