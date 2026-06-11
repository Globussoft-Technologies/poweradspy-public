import mongoose from "mongoose";

/**
 * members — a user's saved members (NEW).
 *
 * A user adds members (name + email) in the All Projects page; per brand they
 * can later choose which members should be CC'd on that brand's competitor
 * email. See docs/MEMBER_CC_MANIFEST.md.
 */
const memberSchema = new mongoose.Schema(
  {
    user_id: { type: String, required: true, index: true }, // owner (stored as string)
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
  },
  { timestamps: true, collection: "members" }
);

// No duplicate member-email per user.
memberSchema.index({ user_id: 1, email: 1 }, { unique: true });

export default mongoose.models.members || mongoose.model("members", memberSchema);
