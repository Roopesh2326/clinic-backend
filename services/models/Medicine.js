const mongoose = require("mongoose");

const MedicineSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  desc: { type: String, default: "" },
  price: { type: Number, required: true },
  category: { type: String, default: "General" },
  img: { type: String, default: "" },

  // ✅ INVENTORY FIELDS
  stock: { type: Number, default: 100 },       // current stock count
  lowStockThreshold: { type: Number, default: 10 }, // alert when stock <= this
  unit: { type: String, default: "units" },    // units, bottles, strips, etc.

  isActive: { type: Boolean, default: true },  // false = hidden from store

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Virtual: is this medicine out of stock?
MedicineSchema.virtual("isOutOfStock").get(function () {
  return this.stock <= 0;
});

// Virtual: is this medicine low on stock?
MedicineSchema.virtual("isLowStock").get(function () {
  return this.stock > 0 && this.stock <= this.lowStockThreshold;
});

module.exports = mongoose.model("Medicine", MedicineSchema);