import mongoose from 'mongoose';

let existingCompSchema = mongoose.Schema(
  {
    advertiser: {
      type: String,
      required: true,
    },
    competitors: [
      {
        competitor_name: {
          type: String,
          required: true,
        },
        competitor_url: {
          type: String,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

const Existing_competitors = mongoose.model("existing_competitor", existingCompSchema);

export default Existing_competitors;;