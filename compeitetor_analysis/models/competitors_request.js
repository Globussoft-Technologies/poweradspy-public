import mongoose from 'mongoose';

const CompetitorRequestSchema = mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user_details",
    },
    project_name: {
      type: String,
      trim: true,
      default: null,
    },
    advertiser: [
      {
        type: String,
        trim: true,
        required: true,
      },
    ],
    brand_url: {
      type: String,
      trim: true,
      required: true,
    },
    competitors: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "competitors",
        required: true,
      },
    ],
    monitoring: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "competitors",
        required: true,
      },
    ],
    email_status: {
      type: Number,
      default: 0,
    },

    country: {
      type: [String], default: []
    },
    category: {
      type: [String], default: []
    },

    // Per-competitor `specific_to_match` echoed back by the DS `/competitors/list`
    // response when a request was constrained via `specific_to` (see
    // dev_payloads_specific_to.md) — e.g. { name: "li-ning", match: { country: "china" } }.
    // Keyed by competitor name (lowercased) rather than by `competitors[]` ObjectId
    // because the referenced `competitors` collection is a SHARED master list across
    // users/requests, so the match reason must live on this per-request document, not
    // on the shared competitor doc.
    specificToMatches: {
      type: [
        {
          name: { type: String, trim: true },
          match: { type: mongoose.Schema.Types.Mixed },
        },
      ],
      default: [],
    },



  },
  {
    timestamps: true,
  }
);

const Competitors_request = mongoose.model("competitors_request",CompetitorRequestSchema);

export default Competitors_request;