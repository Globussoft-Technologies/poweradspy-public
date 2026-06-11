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
    

  },
  {
    timestamps: true,
  }
);

const Competitors_request = mongoose.model("competitors_request",CompetitorRequestSchema);

export default Competitors_request;