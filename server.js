require("dotenv").config();
const mongoose = require("mongoose");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cookieParser = require("cookie-parser");
const Order = require("./models/Order");
const Notice = require("./models/Notice");
const User = require("./models/User");
const Medicine = require("./models/Medicine");

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

// ✅ SINGLE DB CONNECTION
mongoose
  .connect(
    process.env.MONGODB_URI ||
      "mongodb+srv://roopeshdeep:32Qwerfdsa@cluster0.00b27mo.mongodb.net/clinicDB"
  )
  .then(() => console.log("MongoDB connected ✅"))
  .catch((err) => console.error("MongoDB error ❌", err));

// 🔐 AUTH MIDDLEWARE
const authenticateToken = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ message: "Access denied" });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Invalid token" });
    req.user = user;
    next();
  });
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
};

// ─── TEST ─────────────────────────────────
app.get("/", (req, res) => res.send("Backend working ✅"));

// ─── REGISTER ────────────────────────────
app.post("/register", async (req, res) => {
  const { name, email, phone, password, role } = req.body;
  try {
    const existing = await User.findOne({ email });
    if (existing)
      return res.status(400).json({ message: "Email already registered" });
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, email, phone, password: hashedPassword, role: role || "user" });
    await user.save();
    // Auto-link walk-in orders by phone
    if (phone) {
      await Order.updateMany(
        { orderType: "walk-in", "guestInfo.phone": String(phone).trim(), userId: null },
        { $set: { userId: user._id } }
      );
    }
    res.json({ message: "User registered successfully" });
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: "Error registering user" });
  }
});

// ─── LOGIN ───────────────────────────────
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ message: "Invalid credentials" });
    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
    res.cookie("token", token, { httpOnly: true, secure: true, sameSite: "None" });
    res.json({
      message: "Login successful",
      role: user.role,
      name: user.name,
      email: user.email,
      phone: user.phone,
      userId: user._id, // ✅ send userId so frontend can save it
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error logging in" });
  }
});

// ─── LOGOUT ──────────────────────────────
app.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ message: "Logged out" });
});

// ─── PROFILE ─────────────────────────────
app.get("/profile", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Error fetching profile" });
  }
});

// ─── FORGOT PASSWORD ─────────────────────
app.post("/forgot-password", async (req, res) => {
  const { email, phone, newPassword } = req.body;
  if (!email || !phone || !newPassword)
    return res.status(400).json({ message: "All fields are required" });
  if (String(newPassword).length < 6)
    return res.status(400).json({ message: "Password must be at least 6 characters" });
  try {
    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (String(user.phone).trim() !== String(phone).trim())
      return res.status(401).json({ message: "Phone number does not match" });
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ message: "Password reset successful" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to reset password" });
  }
});

// ─── USERS ───────────────────────────────
app.get("/users", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.json(users || []);
  } catch (err) {
    res.status(500).json({ message: "Error fetching users" });
  }
});

app.get("/users/search", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { phone, name } = req.query;
    const query = {};
    if (phone) query.phone = { $regex: String(phone).trim(), $options: "i" };
    if (name) query.name = { $regex: String(name).trim(), $options: "i" };
    const users = await User.find(query).select("-password").limit(10);
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Error searching users" });
  }
});

// ─── APPOINTMENTS ────────────────────────
const filePath = "appointments.json";
let appointments = [];
if (fs.existsSync(filePath)) {
  try { appointments = JSON.parse(fs.readFileSync(filePath)); } catch { appointments = []; }
}

// POST /appointment — book appointment (works for both logged in and guest)
app.post("/appointment", (req, res) => {
  try {
    const appointmentData = {
      ...req.body,
      id: Date.now().toString(),
      bookedAt: req.body.bookedAt || new Date().toISOString(),
      status: "Pending",
    };
    appointments.push(appointmentData);
    fs.writeFileSync(filePath, JSON.stringify(appointments, null, 2));
    res.json({ message: "Appointment booked successfully!" });
  } catch (err) {
    console.error("Error saving appointment:", err);
    res.status(500).json({ message: "Error saving appointment" });
  }
});

// GET /appointments — admin gets ALL appointments
app.get("/appointments", authenticateToken, requireAdmin, (req, res) => {
  res.json(appointments);
});

// GET /appointments/my — logged in user gets their own appointments
// Matches by userId OR by contact phone number
app.get("/appointments/my", authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;

    // First find user's phone for matching
    User.findById(userId).select("phone").then((user) => {
      const userPhone = user?.phone ? String(user.phone).trim() : null;

      const myAppointments = appointments.filter((apt) => {
        // Match by userId if it was saved
        if (apt.userId && String(apt.userId) === String(userId)) return true;
        // Match by phone number as fallback
        if (userPhone && apt.contact && String(apt.contact).trim() === userPhone) return true;
        return false;
      });

      // Sort by date descending
      myAppointments.sort((a, b) => new Date(b.bookedAt || 0) - new Date(a.bookedAt || 0));

      res.json(myAppointments);
    }).catch(() => res.json([]));

  } catch (err) {
    console.error("Error fetching appointments:", err);
    res.status(500).json({ message: "Error fetching appointments" });
  }
});

// PATCH /appointments/:id/status — admin updates appointment status
app.patch("/appointments/:id/status", authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const allowed = ["Pending", "Confirmed", "Completed", "Cancelled"];
    if (!allowed.includes(status))
      return res.status(400).json({ message: "Invalid status" });

    const idx = appointments.findIndex((apt) => String(apt.id) === String(id));
    if (idx === -1) return res.status(404).json({ message: "Appointment not found" });

    appointments[idx].status = status;
    fs.writeFileSync(filePath, JSON.stringify(appointments, null, 2));
    res.json({ message: "Status updated", appointment: appointments[idx] });
  } catch (err) {
    res.status(500).json({ message: "Error updating appointment status" });
  }
});

// ─── NOTICES ─────────────────────────────
app.get("/notice", async (req, res) => {
  try {
    const notice = await Notice.findOne();
    if (!notice) return res.json(null);
    if (notice.expiresAt && new Date(notice.expiresAt) <= new Date()) {
      await Notice.deleteOne({ _id: notice._id });
      return res.json(null);
    }
    res.json(notice);
  } catch (err) {
    res.status(500).json({ message: "Error fetching notice" });
  }
});

app.post("/notice", authenticateToken, requireAdmin, async (req, res) => {
  const { message, expiresInHours } = req.body;
  const parsedHours = Number(expiresInHours || 0);
  const expiresAt = parsedHours > 0 ? new Date(Date.now() + parsedHours * 3600000) : null;
  let notice = await Notice.findOne();
  if (notice) { notice.message = message; notice.expiresAt = expiresAt; await notice.save(); }
  else { notice = new Notice({ message, expiresAt }); await notice.save(); }
  res.json({ message: "Notice updated" });
});

app.delete("/notice", authenticateToken, requireAdmin, async (req, res) => {
  await Notice.deleteMany({});
  res.json({ message: "Notice deleted" });
});

// ─── MEDICINES ───────────────────────────

app.get("/medicines", async (req, res) => {
  try {
    const medicines = await Medicine.find({ isActive: true }).sort({ createdAt: -1 });
    res.json(medicines);
  } catch (err) {
    res.status(500).json({ message: "Error fetching medicines" });
  }
});

app.get("/medicines/all", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const medicines = await Medicine.find().sort({ createdAt: -1 });
    res.json(medicines);
  } catch (err) {
    res.status(500).json({ message: "Error fetching medicines" });
  }
});

app.get("/medicines/low-stock", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const medicines = await Medicine.find({
      isActive: true,
      $expr: { $lte: ["$stock", "$lowStockThreshold"] }
    });
    res.json(medicines);
  } catch (err) {
    res.status(500).json({ message: "Error fetching low stock medicines" });
  }
});

app.post("/medicines", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, desc, price, category, img, stock, lowStockThreshold, unit } = req.body;
    if (!name || !price)
      return res.status(400).json({ message: "Name and price are required" });
    const medicine = new Medicine({
      name: name.trim(), desc: desc || "", price: Number(price),
      category: category || "General", img: img || "",
      stock: Number(stock) || 100,
      lowStockThreshold: Number(lowStockThreshold) || 10,
      unit: unit || "units", isActive: true,
    });
    await medicine.save();
    res.status(201).json({ message: "Medicine added successfully", medicine });
  } catch (err) {
    res.status(500).json({ message: "Error adding medicine" });
  }
});

app.put("/medicines/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, desc, price, category, img, stock, lowStockThreshold, unit, isActive } = req.body;
    const medicine = await Medicine.findByIdAndUpdate(
      req.params.id,
      {
        ...(name && { name: name.trim() }),
        ...(desc !== undefined && { desc }),
        ...(price && { price: Number(price) }),
        ...(category && { category }),
        ...(img !== undefined && { img }),
        ...(stock !== undefined && { stock: Number(stock) }),
        ...(lowStockThreshold !== undefined && { lowStockThreshold: Number(lowStockThreshold) }),
        ...(unit && { unit }),
        ...(isActive !== undefined && { isActive }),
        updatedAt: new Date(),
      },
      { new: true }
    );
    if (!medicine) return res.status(404).json({ message: "Medicine not found" });
    res.json({ message: "Medicine updated successfully", medicine });
  } catch (err) {
    res.status(500).json({ message: "Error updating medicine" });
  }
});

app.patch("/medicines/:id/stock", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { stock, operation } = req.body;
    const medicine = await Medicine.findById(req.params.id);
    if (!medicine) return res.status(404).json({ message: "Medicine not found" });
    if (operation === "add") medicine.stock = medicine.stock + Number(stock);
    else if (operation === "subtract") medicine.stock = Math.max(0, medicine.stock - Number(stock));
    else medicine.stock = Number(stock);
    medicine.updatedAt = new Date();
    await medicine.save();
    res.json({ message: "Stock updated", medicine });
  } catch (err) {
    res.status(500).json({ message: "Error updating stock" });
  }
});

app.delete("/medicines/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const medicine = await Medicine.findByIdAndUpdate(
      req.params.id, { isActive: false, updatedAt: new Date() }, { new: true }
    );
    if (!medicine) return res.status(404).json({ message: "Medicine not found" });
    res.json({ message: "Medicine removed from store" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting medicine" });
  }
});

// ─── ORDERS ──────────────────────────────

app.post("/orders", authenticateToken, async (req, res) => {
  try {
    const { items, total, paymentMethod } = req.body;
    if (!items || !items.length || !total)
      return res.status(400).json({ message: "Missing items or total" });
    const order = new Order({
      userId: req.user.id, orderType: "online",
      items, total: Number(total),
      paymentMethod: paymentMethod || "cash", status: "Pending",
    });
    await order.save();
    for (const item of items) {
      await Medicine.findOneAndUpdate(
        { name: item.name, isActive: true },
        { $inc: { stock: -(item.quantity || 1) } }
      );
    }
    await order.populate("userId", "name email phone");
    res.status(201).json({ message: "Order placed successfully", order });
  } catch (err) {
    console.error("❌ Error saving order:", err);
    res.status(500).json({ message: "Error saving order. Please try again." });
  }
});

app.post("/orders/walk-in", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { items, total, paymentMethod, guestName, guestPhone, existingUserId } = req.body;
    if (!items || !items.length || !total)
      return res.status(400).json({ message: "Missing items or total" });
    if (!guestName && !existingUserId)
      return res.status(400).json({ message: "Customer name is required" });
    let userId = null;
    let guestInfo = { name: "", phone: "" };
    if (existingUserId) {
      userId = existingUserId;
    } else {
      if (guestPhone) {
        const existingUser = await User.findOne({ phone: String(guestPhone).trim() });
        if (existingUser) userId = existingUser._id;
      }
      guestInfo = { name: guestName || "", phone: guestPhone || "" };
    }
    const order = new Order({
      userId, guestInfo, orderType: "walk-in",
      items, total: Number(total),
      paymentMethod: paymentMethod || "cash", status: "Completed",
    });
    await order.save();
    for (const item of items) {
      await Medicine.findOneAndUpdate(
        { name: item.name, isActive: true },
        { $inc: { stock: -(item.quantity || 1) } }
      );
    }
    if (userId) await order.populate("userId", "name email phone");
    res.status(201).json({ message: "Walk-in order created successfully", order });
  } catch (err) {
    console.error("❌ Error saving walk-in order:", err);
    res.status(500).json({ message: "Error creating walk-in order" });
  }
});

app.get("/orders", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const orders = await Order.find()
      .populate("userId", "name email phone")
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: "Error fetching orders" });
  }
});

app.get("/orders/my", authenticateToken, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const orders = await Order.find({ userId }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: "Error fetching your orders" });
  }
});

app.patch("/orders/:id/status", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["Pending", "Approved", "Out for Delivery", "Delivered", "Cancelled", "Completed"];
    if (!allowed.includes(status))
      return res.status(400).json({ message: "Invalid status value" });
    const order = await Order.findByIdAndUpdate(
      req.params.id, { status }, { new: true }
    ).populate("userId", "name email phone");
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json({ message: "Status updated successfully", order });
  } catch (err) {
    res.status(500).json({ message: "Error updating order status" });
  }
});

// ─── PROTECTED TEST ───────────────────────
app.get("/protected", authenticateToken, (req, res) => {
  res.json({ message: "Protected route working", user: req.user });
});

// ─── START SERVER ─────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT + " 🚀");
});