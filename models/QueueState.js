const mongoose = require("mongoose");

const queueStateSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ["appointment", "order", "walkin"],
    unique: true,
  },
  currentServing: { type: Number, default: 0 },
  lastUpdated: { type: Date, default: Date.now },
});

module.exports = mongoose.model("QueueState", queueStateSchema);