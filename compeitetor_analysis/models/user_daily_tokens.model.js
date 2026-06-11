import mongoose from "mongoose";
import config from 'config';
const userDailyTokenSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD

    input_tokens: { type: Number, default: 0 },
    output_tokens: { type: Number, default: 0 },

    total_tokens: { type: Number, default: 0 },

    limit: { type: Number, default: config.get("MAXIMUM_TOKEN_COUNt") }
  },
  { timestamps: true }
);

userDailyTokenSchema.index({ user_id: 1, date: 1 }, { unique: true });

export default mongoose.model("user_daily_tokens", userDailyTokenSchema);
