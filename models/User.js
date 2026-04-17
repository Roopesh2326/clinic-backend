const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  name:       { type: String, required: true, trim: true },
  email:      { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone:      { type: String, default: "" },
  password:   { type: String, required: true },
  role:       { type: String, enum: ["admin","staff","reception","user"], default: "user" },
  isDisabled: { type: Boolean, default: false }, // ✅ admin can disable accounts
  createdAt:  { type: Date, default: Date.now },
});

module.exports = mongoose.model("User", UserSchema);