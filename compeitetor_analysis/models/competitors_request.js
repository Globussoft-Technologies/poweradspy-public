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

    // Persisted generation state — without this, a page refresh mid-generation
    // has no way to tell "still generating in the background" apart from
    // "genuinely has no competitors", since isGenerating/content_ref_id were
    // previously kept only in frontend React state (lost on refresh) and the
    // socket room join only happened once, during the original submit.
    // `content_ref_id` lets the frontend rejoin the right socket room after a
    // refresh; `target_count` is the originally requested competitor count (so
    // the UI can show "42/100" instead of "0/0" post-refresh); `generation_status`
    // tracks whether generateCompetitorsInBackground is still running for this
    // project. 'idle' covers projects created before this field existed, and
    // projects that never went through the AI-generation flow (e.g. manually
    // added competitors only).
    content_ref_id: {
      type: String, default: null
    },
    target_count: {
      type: Number, default: 0
    },
    generation_status: {
      type: String, enum: ["idle", "running", "completed"], default: "idle"
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