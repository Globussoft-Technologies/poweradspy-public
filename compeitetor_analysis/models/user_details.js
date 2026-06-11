import mongoose from 'mongoose';

const userSchema = mongoose.Schema(
  {
    amember_id: {
      type: Number,
      required: true,
      unique: true,
    },
    plan_id: {
      type: Number,
      required: true,
    },
    plan_expiry_date: {
      type: Date,
      required: true,
    },
    company_name: {
      type: String,
      trim: true,
      default: null,
    },
    userName: {
      type: String,
      trim: true,
      required: true,
    },
    email: {
      type: String,
      trim: true,
      unique: true,
      required: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },
    url: {
      type: String,
      default: null,
    },
    phone_number: {
      type: String,
      default: null,
    },
    unsubscribed:{
      type: Number,
      default:0
    }
  },
  {
    timestamps: true,
  }
);

const User_details = mongoose.model("user_details", userSchema);

export default User_details;