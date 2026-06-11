// Members admin overview — read-only aggregation for the admin panel.
//
// Joins Member + BrandCcMember + email_send_log (filtered to
// `meta.source = "member_brand"`) so the admin can answer
//   "Which user added which member, to which brands, and what was the
//    last status of the mail to that member-brand pair?"
//
// Single endpoint, no mutations. Returns one big tree — fine for the
// scale we expect (handful of owners, handful of members each).

import Response from "../../utils/response.js";
import logger from "../../resources/logs/logger.log.js";
import User_details from "../../models/user_details.js";
import Member from "../../models/member.js";
import BrandCcMember from "../../models/brandCcMember.js";
import Competitors_request from "../../models/competitors_request.js";
import EmailSendLog from "../../models/emailSendLog.js";

class MemberOverviewController {
  /**
   * GET /api/members/admin-overview
   *
   * Optional query: ?search=<text>  (matches owner email/name OR member email/name)
   *
   * Returns:
   *   {
   *     owners: [
   *       {
   *         user_id, owner_name, owner_email,
   *         members: [
   *           {
   *             member_id, name, email,
   *             assignments: [
   *               {
   *                 project_id, brand_name, brand_url,
   *                 last_status, last_failure_reason, last_sent_at,
   *                 totals: { sent, skipped, failed, opened, delivered }
   *               }, ...
   *             ],
   *             unassigned: true|false   // saved but no brand_cc_members row anywhere
   *           }, ...
   *         ]
   *       }, ...
   *     ],
   *     summary: { owners, members, assignments }
   *   }
   */
  async overview(req, res) {
    try {
      const search = String(req?.query?.search || "").trim().toLowerCase();

      // 1. All members, grouped by owner.
      const allMembers = await Member.find({}, { user_id: 1, name: 1, email: 1, createdAt: 1 }).lean();
      if (!allMembers.length) {
        return res.send(Response.userSuccessResp("members admin overview", { owners: [], summary: { owners: 0, members: 0, assignments: 0 } }));
      }

      const ownerIds = [...new Set(allMembers.map((m) => String(m.user_id)))];

      // 2. Owner user records — name + email for the "Added by" column.
      const owners = await User_details.find({ _id: { $in: ownerIds } }, { userName: 1, email: 1 }).lean();
      const ownerById = new Map(owners.map((o) => [String(o._id), { userName: o.userName || null, email: o.email || null }]));

      // 3. All brand_cc_members rows for these owners — the assignment graph.
      const ccRows = await BrandCcMember.find(
        { user_id: { $in: ownerIds } },
        { user_id: 1, project_id: 1, member_ids: 1, member_emails: 1, updatedAt: 1 }
      ).lean();

      // 4. Project (brand) metadata — name + url for display.
      const projectIds = [...new Set(ccRows.map((r) => String(r.project_id)).filter(Boolean))];
      const projects = projectIds.length
        ? await Competitors_request.find(
            { _id: { $in: projectIds } },
            { advertiser: 1, project_name: 1, brand_url: 1 }
          ).lean()
        : [];
      const projectById = new Map(projects.map((p) => [String(p._id), {
        brand_name: (Array.isArray(p.advertiser) ? p.advertiser[0] : p.advertiser) || p.project_name || null,
        brand_url: p.brand_url || null,
      }]));

      // 5. email_send_log aggregation — per (member_email, project_id) from the
      //    member_brand source only. We pull the recent rows, then reduce in JS
      //    so we get both "last row" + "by-status totals" in one pass.
      const memberEmails = [...new Set(allMembers.map((m) => String(m.email || "").trim().toLowerCase()).filter(Boolean))];
      const logs = memberEmails.length
        ? await EmailSendLog.find(
            {
              to: { $in: memberEmails },
              "meta.source": "member_brand",
            },
            { to: 1, status: 1, failure_reason: 1, sent_at: 1, createdAt: 1, "meta.project_id": 1, "meta.brand_name": 1, "meta.added_by_email": 1 }
          ).sort({ sent_at: -1, createdAt: -1 }).lean()
        : [];

      // Bucket by `${memberEmail}|${projectId}`.
      const buckets = new Map();
      for (const l of logs) {
        const key = `${String(l.to || "").trim().toLowerCase()}|${String(l.meta?.project_id || "")}`;
        if (!buckets.has(key)) {
          buckets.set(key, {
            last_status: l.status || null,
            last_failure_reason: l.failure_reason || null,
            last_sent_at: l.sent_at || l.createdAt || null,
            totals: { sent: 0, skipped: 0, failed: 0, opened: 0, delivered: 0, bounced: 0, spam: 0 },
          });
        }
        const b = buckets.get(key);
        if (l.status && b.totals[l.status] !== undefined) b.totals[l.status]++;
      }

      // 6. Compose owner → member → assignment tree.
      const ownersOut = [];
      const ownersGrouped = new Map();   // ownerId → ownerNode
      const assignmentsCount = { v: 0 };

      for (const m of allMembers) {
        const ownerId = String(m.user_id);
        const ownerMeta = ownerById.get(ownerId) || {};
        if (!ownersGrouped.has(ownerId)) {
          ownersGrouped.set(ownerId, {
            user_id: ownerId,
            owner_name: ownerMeta.userName || null,
            owner_email: ownerMeta.email || null,
            members: [],
          });
        }

        // Which brand_cc_members rows include THIS member?
        const memberId = String(m._id);
        const memberEmail = String(m.email || "").trim().toLowerCase();
        const myRows = ccRows.filter((r) =>
          String(r.user_id) === ownerId && (
            (r.member_ids || []).some((id) => String(id) === memberId) ||
            (r.member_emails || []).some((e) => String(e || "").trim().toLowerCase() === memberEmail)
          )
        );

        const assignments = myRows.map((r) => {
          const projectId = String(r.project_id || "");
          const meta = projectById.get(projectId) || { brand_name: null, brand_url: null };
          const b = buckets.get(`${memberEmail}|${projectId}`) || null;
          assignmentsCount.v++;
          return {
            project_id: projectId,
            brand_name: meta.brand_name,
            brand_url: meta.brand_url,
            assigned_at: r.updatedAt || null,
            last_status: b?.last_status ?? null,
            last_failure_reason: b?.last_failure_reason ?? null,
            last_sent_at: b?.last_sent_at ?? null,
            totals: b?.totals || { sent: 0, skipped: 0, failed: 0, opened: 0, delivered: 0, bounced: 0, spam: 0 },
          };
        });

        ownersGrouped.get(ownerId).members.push({
          member_id: memberId,
          name: m.name || null,
          email: m.email || null,
          assigned_at: m.createdAt || null,
          assignments,
          unassigned: assignments.length === 0,
        });
      }

      // 7. Filter by search if asked (matches owner email/name OR any member email/name).
      let outOwners = [...ownersGrouped.values()];
      if (search) {
        outOwners = outOwners
          .map((o) => {
            const ownerHit = (o.owner_email || "").toLowerCase().includes(search) || (o.owner_name || "").toLowerCase().includes(search);
            const members = o.members.filter((m) => {
              if (ownerHit) return true;
              return (m.email || "").toLowerCase().includes(search) || (m.name || "").toLowerCase().includes(search);
            });
            return { ...o, members };
          })
          .filter((o) => o.members.length > 0);
      }

      // Sort: owner email asc, then member email asc, then brand_name asc.
      outOwners.sort((a, b) => String(a.owner_email || "").localeCompare(String(b.owner_email || "")));
      for (const o of outOwners) {
        o.members.sort((a, b) => String(a.email || "").localeCompare(String(b.email || "")));
        for (const m of o.members) {
          m.assignments.sort((a, b) => String(a.brand_name || "").localeCompare(String(b.brand_name || "")));
        }
      }

      return res.send(Response.userSuccessResp("members admin overview", {
        owners: outOwners,
        summary: {
          owners: outOwners.length,
          members: outOwners.reduce((s, o) => s + o.members.length, 0),
          assignments: assignmentsCount.v,
        },
      }));
    } catch (e) {
      logger.error(`members admin-overview failed: ${e.message}`);
      return res.send(Response.userFailResp("Failed to load members overview", e.message));
    }
  }
}

export default new MemberOverviewController();
