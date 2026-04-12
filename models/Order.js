const mongoose = require("mongoose");

const OrderSchema = new mongoose.Schema({
  // For online orders — registered user
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },

  // For walk-in orders — guest customer info
  guestInfo: {
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
  },

  // "online" = placed by user, "walk-in" = placed by admin at counter
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

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Order", OrderSchema);