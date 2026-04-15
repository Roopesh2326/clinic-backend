const mongoose = require("mongoose");

const OrderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  guestInfo: {
    name:  { type: String, default: "" },
    phone: { type: String, default: "" },
  },
  orderType: {
    type: String,
    enum: ["online", "walk-in"],
    default: "online",
  },
  items: { type: Array, required: true },
  total: { type: Number, required: true },
  paymentMethod: {
    type: String,
    enum: ["cash", "upi", "card"],
    default: "cash",
  },
  status: {
    type: String,
    enum: ["Pending", "Approved", "Out for Delivery", "Delivered", "Cancelled", "Completed"],
    default: "Pending",
  },

  // ✅ TOKEN FIELDS
  tokenNumber: { type: Number, default: null },   // raw: 1, 2, 3
  tokenStr:    { type: String, default: null },    // formatted: ORD-001, WLK-001
  tokenDate:   { type: String, default: null },    // "2024-04-15"

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Order", OrderSchema);