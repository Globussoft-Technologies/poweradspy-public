import mongoose from "mongoose";

const tokenSyncStateSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true
    },

    content_ref_id: {
      type: String,
      required: true,
      index: true
    },

    last_input_tokens: { type: Number, default: 0 },
    last_output_tokens: { type: Number, default: 0 }
  },
  { timestamps: true }
);

tokenSyncStateSchema.index(
  { user_id: 1, content_ref_id: 1 },
  { unique: true }
);

export default mongoose.model(
  "ai_token_sync_state",
  tokenSyncStateSchema
);