const mongoose = require("mongoose");

const MedicineSchema = new mongoose.Schema({
  name:              { type: String, required: true, trim: true },
  desc:              { type: String, default: "" },
  price:             { type: Number, required: true },
  category:          { type: String, default: "General" },
  img:               { type: String, default: "" },
  stock:             { type: Number, default: 100 },
  lowStockThreshold: { type: Number, default: 10 },
  unit:              { type: String, default: "units" },
  isActive:          { type: Boolean, default: true },

  // ✅ NEW — inventory tracking fields
  supplier:    { type: String, default: "" },  // "Sun Pharma", "Cipla", etc.
  expiryDate:  { type: String, default: "" },  // "YYYY-MM-DD"
  entryDate:   { type: String, default: "" },  // "YYYY-MM-DD" — when stock was added

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

MedicineSchema.index({ name: 1 });
MedicineSchema.index({ isActive: 1 });
MedicineSchema.index({ category: 1 });

module.exports = mongoose.model("Medicine", MedicineSchema);