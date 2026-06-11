import mongoose from "mongoose";

/**
 * brand_cc_members — which members CC a given brand's competitor email (NEW).
 *
 * One doc per (user_id, project_id). `member_emails` is denormalised so the
 * daily-mail flow needs no join. project_id = the brand's
 * competitors_request._id (string). See docs/MEMBER_CC_MANIFEST.md.
 */
const brandCcMemberSchema = new mongoose.Schema(
  {
    user_id: { type: String, required: true, index: true },
    project_id: { type: String, required: true, index: true },
    member_ids: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    member_emails: { type: [String], default: [] },
  },
  { timestamps: true, collection: "brand_cc_members" }
);

brandCcMemberSchema.index({ user_id: 1, project_id: 1 }, { unique: true });

export default mongoose.models.brand_cc_members ||
  mongoose.model("brand_cc_members", brandCcMemberSchema);
