const mongoose = require("mongoose");

const ActivityLogSchema = new mongoose.Schema({
  // Who performed the action
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  userName:   { type: String, default: "System" },
  userRole:   { type: String, default: "system" },
  userEmail:  { type: String, default: "" },

  // What they did
  action:     {
    type: String,
    required: true,
    enum: [
      // Authorization
      "login", "logout",
      // Orders
      "order_created", "order_status_changed", "walkin_order_created",
      // Appointments
      "appointment_booked", "appointment_status_changed", "appointment_deleted",
      // Queue
      "queue_next", "queue_reset",
      // Medicines
      "medicine_added", "medicine_updated", "medicine_deleted", "medicine_stock_updated",
      // Users
      "user_created", "user_updated", "user_deleted", "user_disabled", "user_enabled",
      // Notices
      "notice_published", "notice_deleted",
      // System
      "system",
    ],
  },

  // Human readable description
  description: { type: String, required: true },

  // Extra detail (old/new values, IDs, etc.)
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },

  // IP address (optional, for security audit)
  ip: { type: String, default: "" },

  createdAt: { type: Date, default: Date.now },
});

// Index for fast queries — most recent first, filtered by user or action
ActivityLogSchema.index({ createdAt: -1 });
ActivityLogSchema.index({ userId: 1, createdAt: -1 });
ActivityLogSchema.index({ action: 1, createdAt: -1 });

// Auto-delete logs older than 90 days to keep DB lean
ActivityLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model("ActivityLog", ActivityLogSchema);