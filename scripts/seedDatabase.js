const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("dotenv").config();

// Import models
const User = require("../models/User");
const Medicine = require("../models/Medicine");

const seedData = async () => {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB for seeding");

    // Clear existing data (optional - comment out if you want to preserve data)
    // await User.deleteMany({});
    // await Medicine.deleteMany({});

    // Create admin user if not exists
    const adminExists = await User.findOne({ email: "admin@clinic.com" });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash("admin123", 10);
      const admin = new User({
        name: "Admin User",
        email: "admin@clinic.com",
        phone: "1234567890",
        password: hashedPassword,
        role: "admin"
      });
      await admin.save();
      console.log("Admin user created");
    }

    // Create sample medicines if none exist
    const medicineCount = await Medicine.countDocuments();
    if (medicineCount === 0) {
      const sampleMedicines = [
        {
          name: "Paracetamol 500mg",
          description: "Pain relief and fever reducer",
          price: 45,
          category: "Tablets",
          stock: 100,
          manufacturer: "PharmaCorp",
          expiryDate: new Date("2025-12-31"),
          prescriptionRequired: false,
          tags: ["pain", "fever", "headache"],
          active: true
        },
        {
          name: "Amoxicillin 250mg",
          description: "Antibiotic for bacterial infections",
          price: 120,
          category: "Capsules",
          stock: 50,
          manufacturer: "MediLab",
          expiryDate: new Date("2025-06-30"),
          prescriptionRequired: true,
          tags: ["antibiotic", "infection"],
          active: true
        },
        {
          name: "Cough Syrup",
          description: "Relief for dry and productive cough",
          price: 85,
          category: "Syrups",
          stock: 75,
          manufacturer: "HealthPlus",
          expiryDate: new Date("2025-09-15"),
          prescriptionRequired: false,
          tags: ["cough", "cold", "sore throat"],
          active: true
        },
        {
          name: "Vitamin D3 1000IU",
          description: "Vitamin D supplement for bone health",
          price: 200,
          category: "Tablets",
          stock: 150,
          manufacturer: "NutriCare",
          expiryDate: new Date("2026-03-31"),
          prescriptionRequired: false,
          tags: ["vitamin", "supplement", "bone health"],
          active: true
        },
        {
          name: "Antiseptic Cream",
          description: "Topical antiseptic for minor cuts and wounds",
          price: 95,
          category: "Ointments",
          stock: 60,
          manufacturer: "Dermacare",
          expiryDate: new Date("2025-11-20"),
          prescriptionRequired: false,
          tags: ["antiseptic", "wound care", "skin"],
          active: true
        }
      ];

      await Medicine.insertMany(sampleMedicines);
      console.log("Sample medicines created");
    }

    console.log("Database seeding completed successfully");
    process.exit(0);
  } catch (error) {
    console.error("Error seeding database:", error);
    process.exit(1);
  }
};

seedData();
