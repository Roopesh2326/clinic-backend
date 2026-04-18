const mongoose = require("mongoose");

const AppointmentSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  age:         { type: String, default: "" },
  problem:     { type: String, default: "" },
  contact:     { type: String, required: true, trim: true },
  email:       { type: String, default: "" },
  date:        { type: String, required: true },   // "YYYY-MM-DD"
  time:        { type: String, default: "" },
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  source:      { type: String, default: "online" }, // "online" | "reception"
  status:      { type: String, enum: ["Pending","Confirmed","Completed","Cancelled"], default: "Pending" },

  // Token fields
  tokenNumber: { type: Number, default: null },
  tokenStr:    { type: String, default: null },    // "APT-001"
  tokenDate:   { type: String, default: null },    // "2024-04-15"

  bookedAt:    { type: Date, default: Date.now },
  createdAt:   { type: Date, default: Date.now },
});

// Index for fast user lookups
AppointmentSchema.index({ userId: 1 });
AppointmentSchema.index({ contact: 1 });
AppointmentSchema.index({ bookedAt: -1 });

module.exports = mongoose.model("Appointment", AppointmentSchema);