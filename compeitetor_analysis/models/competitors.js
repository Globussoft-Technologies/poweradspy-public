import mongoose  from "mongoose";

const CompetitorSchema = mongoose.Schema(
  {
    competitor_name: {
      type: String,
      unique: true,
      trim: true,
      required: true,
    },
    competitor_url: {
      // Genuinely optional (the "Add Competitor Manually" form labels it
      // "(optional)") — was `required: true`, which Mongoose enforces
      // strictly on String fields (rejects "" but NOT any other non-empty
      // string, including invalid junk), causing new-competitor creation to
      // fail with a blank URL while any garbage text "passed".
      type: String,
      default: "",
    },
    facebook_status: {
      type: Number,
      default: 0,
    },
    instagram_status: {
      type: Number,
      default: 0,
    },
    youtube_status: {
      type: Number,
      default: 0,
    },
    google_status: {
      type: Number,
      default: 0,
    }

  },
  {
    timestamps: true,
  }
);

const Competitors = mongoose.model("competitors", CompetitorSchema);

export default Competitors;