// ================================================================
// FILE LOCATION: src/models/ActivityLog.js
// (same folder as your other models like Order.js, User.js etc.)
// ================================================================

const mongoose = require("mongoose");

const ActivityLogSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  userName:   { type: String, default: "System" },
  userRole:   { type: String, default: "system" },
  userEmail:  { type: String, default: "" },

  action: {
    type: String,
    required: true,
    enum: [
      "login", "logout",
      "order_created", "order_status_changed", "walkin_order_created",
      "appointment_booked", "appointment_status_changed", "appointment_deleted",
      "queue_next", "queue_reset",
      "medicine_added", "medicine_updated", "medicine_deleted", "medicine_stock_updated",
      "user_created", "user_updated", "user_deleted", "user_disabled", "user_enabled",
      "notice_published", "notice_deleted",
      "system",
    ],
  },

  description: { type: String, required: true },
  meta:        { type: mongoose.Schema.Types.Mixed, default: {} },
  ip:          { type: String, default: "" },
  createdAt:   { type: Date, default: Date.now },
});

ActivityLogSchema.index({ createdAt: -1 });
ActivityLogSchema.index({ userId: 1, createdAt: -1 });
ActivityLogSchema.index({ action: 1, createdAt: -1 });

// Auto-delete logs older than 90 days
ActivityLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model("ActivityLog", ActivityLogSchema);