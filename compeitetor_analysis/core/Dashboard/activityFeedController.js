import ActivityEvent from "../../models/activityEvent.js";
import Response from "../../utils/response.js";
import logger from "../../resources/logs/logger.log.js";

const clampInt = (v, def, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
};

class ActivityFeedController {
  // POST /activity-feed/list  { request_id, category?, page?, limit?, user_id? }
  // user_id (optional) is used only to compute `unread` per event for that user.
  async list(req, res) {
    try {
      const { request_id, category, user_id } = req.body || {};
      if (!request_id) return res.send(Response.validationFailResp("request_id is required", ""));

      const page = clampInt(req.body?.page, 1, 1, 100000);
      const limit = clampInt(req.body?.limit, 20, 1, 100);
      const filter = { request_id };
      if (category === "alert" || category === "change") filter.category = category;

      const [events, total, unreadCount] = await Promise.all([
        ActivityEvent.find(filter)
          .sort({ occurred_on: -1, createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        ActivityEvent.countDocuments(filter),
        user_id ? ActivityEvent.countDocuments({ ...filter, read_by: { $ne: user_id } }) : Promise.resolve(null),
      ]);

      return res.send(Response.userSuccessResp("activity feed fetched", {
        events: events.map((e) => ({ ...e, read: user_id ? (e.read_by || []).some((id) => String(id) === String(user_id)) : undefined })),
        total,
        page,
        limit,
        unreadCount,
      }));
    } catch (e) {
      logger.error(`[activityFeedController] list: ${e.message}`);
      return res.send(Response.userFailResp("Failed to fetch activity feed", e.message));
    }
  }

  // POST /activity-feed/mark-read  { request_id, user_id, event_ids?: [] }
  // Omitting event_ids marks every event on the project read for this user.
  async markRead(req, res) {
    try {
      const { request_id, user_id, event_ids } = req.body || {};
      if (!request_id || !user_id) return res.send(Response.validationFailResp("request_id and user_id are required", ""));
      const filter = { request_id };
      if (Array.isArray(event_ids) && event_ids.length) filter._id = { $in: event_ids };
      await ActivityEvent.updateMany(filter, { $addToSet: { read_by: user_id } });
      return res.send(Response.userSuccessResp("activity events marked read", { ok: true }));
    } catch (e) {
      logger.error(`[activityFeedController] markRead: ${e.message}`);
      return res.send(Response.userFailResp("Failed to mark activity events read", e.message));
    }
  }
}

export default new ActivityFeedController();
