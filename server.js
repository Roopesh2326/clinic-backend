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

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
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
    const user = new User({
      name, email, phone,
      password: hashedPassword,
      role: role || "user",
    });
    await user.save();

    // ✅ AUTO-LINK: when user registers, link any walk-in orders with same phone
    if (phone) {
      const linked = await Order.updateMany(
        {
          orderType: "walk-in",
          "guestInfo.phone": String(phone).trim(),
          userId: null,
        },
        { $set: { userId: user._id } }
      );
      if (linked.modifiedCount > 0) {
        console.log("✅ Linked", linked.modifiedCount, "walk-in orders to new user:", email);
      }
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

    const token = jwt.sign(
      { id: user._id, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("token", token, {
      httpOnly: true, secure: true, sameSite: "None",
    });

    res.json({
      message: "Login successful",
      role: user.role,
      name: user.name,
      email: user.email,
      phone: user.phone,
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

// Search user by phone — admin uses this for walk-in POS
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
  try { appointments = JSON.parse(fs.readFileSync(filePath)); }
  catch { appointments = []; }
}

app.post("/appointment", (req, res) => {
  appointments.push(req.body);
  fs.writeFileSync(filePath, JSON.stringify(appointments, null, 2));
  res.json({ message: "Appointment saved successfully" });
});

app.get("/appointments", authenticateToken, requireAdmin, (req, res) => {
  res.json(appointments);
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
  const expiresAt = parsedHours > 0
    ? new Date(Date.now() + parsedHours * 3600000)
    : null;
  let notice = await Notice.findOne();
  if (notice) {
    notice.message = message;
    notice.expiresAt = expiresAt;
    await notice.save();
  } else {
    notice = new Notice({ message, expiresAt });
    await notice.save();
  }
  res.json({ message: "Notice updated" });
});

app.delete("/notice", authenticateToken, requireAdmin, async (req, res) => {
  await Notice.deleteMany({});
  res.json({ message: "Notice deleted" });
});

// ─── ORDERS ──────────────────────────────

// POST /orders — online order by logged in user
app.post("/orders", authenticateToken, async (req, res) => {
  try {
    const { items, total, paymentMethod } = req.body;
    if (!items || !items.length || !total)
      return res.status(400).json({ message: "Missing items or total" });

    const order = new Order({
      userId: req.user.id,
      orderType: "online",
      items,
      total: Number(total),
      paymentMethod: paymentMethod || "cash",
      status: "Pending",
    });

    await order.save();
    await order.populate("userId", "name email phone");
    console.log("✅ Online order saved:", order._id, "| User:", req.user.id);
    res.status(201).json({ message: "Order placed successfully", order });
  } catch (err) {
    console.error("❌ Error saving order:", err);
    res.status(500).json({ message: "Error saving order. Please try again." });
  }
});

// POST /orders/walk-in — admin creates order for walk-in customer
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
      // Linked to existing registered user
      userId = existingUserId;
    } else {
      // Guest customer — check if registered user with same phone exists
      if (guestPhone) {
        const existingUser = await User.findOne({
          phone: String(guestPhone).trim()
        });
        if (existingUser) {
          userId = existingUser._id;
          console.log("✅ Walk-in matched to registered user:", existingUser.email);
        }
      }
      guestInfo = {
        name: guestName || "",
        phone: guestPhone || "",
      };
    }

    const order = new Order({
      userId,
      guestInfo,
      orderType: "walk-in",
      items,
      total: Number(total),
      paymentMethod: paymentMethod || "cash",
      status: "Completed", // walk-in = already paid in person
    });

    await order.save();

    if (userId) {
      await order.populate("userId", "name email phone");
    }

    console.log("✅ Walk-in order saved:", order._id, "| Guest:", guestName, guestPhone);
    res.status(201).json({ message: "Walk-in order created successfully", order });
  } catch (err) {
    console.error("❌ Error saving walk-in order:", err);
    res.status(500).json({ message: "Error creating walk-in order" });
  }
});

// GET /orders — admin gets ALL orders (both online and walk-in)
app.get("/orders", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const orders = await Order.find()
      .populate("userId", "name email phone")
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({ message: "Error fetching orders" });
  }
});

// GET /orders/my — logged in user gets their own orders (online + linked walk-in)
// ✅ MUST be before /orders/:id
app.get("/orders/my", authenticateToken, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const orders = await Order.find({ userId }).sort({ createdAt: -1 });
    console.log("📦 /orders/my — user:", req.user.id, "| found:", orders.length);
    res.json(orders);
  } catch (err) {
    console.error("Error fetching user orders:", err);
    res.status(500).json({ message: "Error fetching your orders" });
  }
});

// PATCH /orders/:id/status — admin updates order status
app.patch("/orders/:id/status", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["Pending", "Approved", "Out for Delivery", "Delivered", "Cancelled", "Completed"];
    if (!allowed.includes(status))
      return res.status(400).json({ message: "Invalid status value" });

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).populate("userId", "name email phone");

    if (!order) return res.status(404).json({ message: "Order not found" });

    console.log("✅ Status updated:", req.params.id, "->", status);
    res.json({ message: "Status updated successfully", order });
  } catch (err) {
    console.error("Error updating status:", err);
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