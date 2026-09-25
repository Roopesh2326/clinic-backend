const mongoose = require("mongoose");

const queueStateSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ["appointment", "order", "walkin"],
    unique: true,
  },
  // IST date for which currentServing applies. This prevents yesterday's
  // pointer from leaking into a new day's queue.
  queueDate: {
    type: String,
    default: "",
  },
  currentServing: { type: Number, default: 0, min: 0 },
  lastUpdated: { type: Date, default: Date.now },
});

module.exports = mongoose.model("QueueState", queueStateSchema);
