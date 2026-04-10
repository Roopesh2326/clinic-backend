const mongoose = require("mongoose");

const OrderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  items: { type: Array, required: true },
  total: { type: Number, required: true },
  paymentMethod: { type: String, default: "cash" },  // cash | upi | card
  status: {
    type: String,
    enum: ["Pending", "Approved", "Out for Delivery", "Delivered", "Cancelled"],
    default: "Pending",
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Order", OrderSchema);