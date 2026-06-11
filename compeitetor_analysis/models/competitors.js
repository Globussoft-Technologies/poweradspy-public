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
      type: String,
      required: true,
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