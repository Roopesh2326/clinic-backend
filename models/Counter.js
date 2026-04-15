const mongoose = require("mongoose");

/**
 * Counter collection — one document per "counter key"
 * 
 * Keys used:
 *   "appointment:2024-04-15"  → resets every day
 *   "order:2024-04-15"        → resets every day
 * 
 * This ensures tokens are always unique within a day,
 * and restart from 1 at midnight automatically.
 */
const CounterSchema = new mongoose.Schema({
  // e.g. "appointment:2024-04-15"
  key: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },

  // Current counter value — incremented atomically
  seq: {
    type: Number,
    default: 0,
  },

  // The date this counter belongs to (for cleanup)
  date: {
    type: String, // "YYYY-MM-DD"
    required: true,
  },

  createdAt: {
    type: Date,
    default: Date.now,
    // Auto-delete counter documents after 7 days (cleanup old dates)
    expires: 60 * 60 * 24 * 7,
  },
});

module.exports = mongoose.model("Counter", CounterSchema);