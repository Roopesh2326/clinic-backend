const mongoose = require("mongoose");

const MedicineSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  price: { type: Number, required: true, min: 0 },
  category: { 
    type: String, 
    required: true,
    enum: ["Tablets", "Capsules", "Syrups", "Ointments", "Injections", "Others"]
  },
  image: { type: String, default: "" },
  stock: { type: Number, required: true, min: 0, default: 0 },
  manufacturer: { type: String, default: "" },
  expiryDate: { type: Date, required: true },
  prescriptionRequired: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
  tags: [{ type: String, trim: true }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Index for search functionality
MedicineSchema.index({ name: "text", description: "text", tags: "text" });
MedicineSchema.index({ category: 1 });
MedicineSchema.index({ active: 1 });

module.exports = mongoose.model("Medicine", MedicineSchema);
