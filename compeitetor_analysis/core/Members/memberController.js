import Member from "../../models/member.js";
import BrandCcMember from "../../models/brandCcMember.js";
import Response from "../../utils/response.js";
import logger from "../../resources/logs/logger.log.js";

/**
 * Members + brand-CC endpoints (NEW). See docs/MEMBER_CC_MANIFEST.md.
 * Every action is scoped to the caller's own `user_id`.
 */
const isEmail = (e) => /^\S+@\S+\.\S+$/.test(String(e || "").trim());

class memberController {
  // POST /members/list  { user_id }
  async listMembers(req, res) {
    try {
      const { user_id } = req.body || {};
      if (!user_id) return res.send(Response.validationFailResp("user_id is required", ""));
      const members = await Member.find({ user_id: String(user_id) }, { name: 1, email: 1 })
        .sort({ createdAt: -1 }).lean();
      return res.send(Response.userSuccessResp("members fetched", { members }));
    } catch (e) {
      logger.error(`listMembers: ${e.message}`);
      return res.send(Response.userFailResp("Failed to fetch members", e.message));
    }
  }

  // POST /members/add  { user_id, name, email }
  async addMember(req, res) {
    try {
      const { user_id, name, email } = req.body || {};
      if (!user_id || !name || !isEmail(email)) {
        return res.send(Response.validationFailResp("user_id, name and a valid email are required", ""));
      }
      const uid = String(user_id);
      const e = String(email).trim().toLowerCase();
      const existing = await Member.findOne({ user_id: uid, email: e });
      if (existing) return res.send(Response.userFailResp("Member with this email already exists", ""));
      const member = await Member.create({ user_id: uid, name: String(name).trim(), email: e });
      return res.send(Response.userSuccessResp("member added", { member }));
    } catch (e) {
      if (e.code === 11000) return res.send(Response.userFailResp("Member with this email already exists", ""));
      logger.error(`addMember: ${e.message}`);
      return res.send(Response.userFailResp("Failed to add member", e.message));
    }
  }

  // POST /members/update  { user_id, member_id, name?, email? }
  async updateMember(req, res) {
    try {
      const { user_id, member_id, name, email } = req.body || {};
      if (!user_id || !member_id) return res.send(Response.validationFailResp("user_id and member_id are required", ""));
      const patch = {};
      if (name) patch.name = String(name).trim();
      if (email !== undefined) {
        if (!isEmail(email)) return res.send(Response.validationFailResp("invalid email", ""));
        patch.email = String(email).trim().toLowerCase();
      }
      const member = await Member.findOneAndUpdate(
        { _id: member_id, user_id: String(user_id) },
        { $set: patch },
        { new: true }
      );
      if (!member) return res.send(Response.userFailResp("Member not found", ""));
      return res.send(Response.userSuccessResp("member updated", { member }));
    } catch (e) {
      if (e.code === 11000) return res.send(Response.userFailResp("Another member already has this email", ""));
      logger.error(`updateMember: ${e.message}`);
      return res.send(Response.userFailResp("Failed to update member", e.message));
    }
  }

  // POST /members/delete  { user_id, member_id }
  async deleteMember(req, res) {
    try {
      const { user_id, member_id } = req.body || {};
      if (!user_id || !member_id) return res.send(Response.validationFailResp("user_id and member_id are required", ""));
      const uid = String(user_id);
      const member = await Member.findOne({ _id: member_id, user_id: uid });
      if (!member) return res.send(Response.userFailResp("Member not found", ""));
      await Member.deleteOne({ _id: member_id, user_id: uid });
      // Also remove this member from any brand-CC selections.
      await BrandCcMember.updateMany(
        { user_id: uid },
        { $pull: { member_ids: member._id, member_emails: member.email } }
      );
      return res.send(Response.userSuccessResp("member deleted", { ok: true }));
    } catch (e) {
      logger.error(`deleteMember: ${e.message}`);
      return res.send(Response.userFailResp("Failed to delete member", e.message));
    }
  }

  // POST /brand-cc/get  { user_id, project_id }
  async getBrandCc(req, res) {
    try {
      const { user_id, project_id } = req.body || {};
      if (!user_id || !project_id) return res.send(Response.validationFailResp("user_id and project_id are required", ""));
      const doc = await BrandCcMember.findOne({ user_id: String(user_id), project_id: String(project_id) }).lean();
      return res.send(Response.userSuccessResp("brand cc fetched", {
        member_ids: doc?.member_ids || [],
        member_emails: doc?.member_emails || [],
      }));
    } catch (e) {
      logger.error(`getBrandCc: ${e.message}`);
      return res.send(Response.userFailResp("Failed to fetch brand cc", e.message));
    }
  }

  // POST /brand-cc/set  { user_id, project_id, member_ids: [] }
  async setBrandCc(req, res) {
    try {
      const { user_id, project_id, member_ids } = req.body || {};
      if (!user_id || !project_id) return res.send(Response.validationFailResp("user_id and project_id are required", ""));
      const uid = String(user_id);
      const ids = Array.isArray(member_ids) ? member_ids : [];
      // Only the user's OWN members count (security + denormalised emails).
      const members = ids.length
        ? await Member.find({ _id: { $in: ids }, user_id: uid }, { email: 1 }).lean()
        : [];
      const member_ids_final = members.map((m) => m._id);
      const member_emails = [...new Set(members.map((m) => m.email))];
      await BrandCcMember.updateOne(
        { user_id: uid, project_id: String(project_id) },
        { $set: { user_id: uid, project_id: String(project_id), member_ids: member_ids_final, member_emails } },
        { upsert: true }
      );
      return res.send(Response.userSuccessResp("brand cc updated", { member_ids: member_ids_final, member_emails }));
    } catch (e) {
      logger.error(`setBrandCc: ${e.message}`);
      return res.send(Response.userFailResp("Failed to set brand cc", e.message));
    }
  }
}

export default new memberController();
