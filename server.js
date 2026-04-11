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

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/clinicDB", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("Connected to MongoDB"))
.catch((err) => console.error("MongoDB connection error:", err));

// ✅ CORS
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

// ✅ JWT Secret
const JWT_SECRET = "your_jwt_secret_key";

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
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
};

// ✅ CONNECT DATABASE (FIXED)
mongoose.connect(
  "mongodb+srv://roopeshdeep:32Qwerfdsa@cluster0.00b27mo.mongodb.net/clinicDB"
)
.then(() => console.log("MongoDB connected ✅"))
.catch((error) => console.log("MongoDB error ❌", error));

// ✅ TEST ROUTE
app.get("/", (req, res) => {
  res.send("Backend working ✅");
});

// ✅ REGISTER
app.post("/register", async (req, res) => {
  const { name, email, phone, password, role } = req.body;
  try {
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: "Email already registered" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      name,
      email,
      phone,
      password: hashedPassword,
      role: role || "user"
    });
    await user.save();
    res.json({ message: "User registered successfully" });
  } catch (error) {
    console.log(error);
    res.status(400).json({ message: "Error registering user" });
  }
});

// ✅ LOGIN — now returns name, email, phone so frontend can save them
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "None",
    });

    // ✅ FIX: return name, email, phone so frontend saves them to localStorage
    res.json({
      message: "Login successful",
      role: user.role,
      name: user.name,
      email: user.email,
      phone: user.phone,
    });

  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Error logging in" });
  }
});

// ✅ LOGOUT
app.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ message: "Logged out" });
});

// ✅ GET CURRENT USER PROFILE — for existing users already logged in
app.get("/profile", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Error fetching profile" });
  }
});

// ✅ GET ALL USERS — admin only
app.get("/users", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.json(users || []);
  } catch (err) {
    console.log("ERROR IN USERS:", err);
    res.status(500).json({ message: "Error fetching users" });
  }
});

// ✅ FORGOT PASSWORD
app.post("/forgot-password", async (req, res) => {
  const { email, phone, newPassword } = req.body;
  if (!email || !phone || !newPassword) {
    return res.status(400).json({ message: "All fields are required" });
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters" });
  }
  try {
    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (String(user.phone).trim() !== String(phone).trim()) {
      return res.status(401).json({ message: "Phone number does not match" });
    }
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    return res.json({ message: "Password reset successful" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Failed to reset password" });
  }
});

// ✅ APPOINTMENTS
const filePath = "appointments.json";
let appointments = [];
if (fs.existsSync(filePath)) {
  const data = fs.readFileSync(filePath);
  appointments = JSON.parse(data);
}

app.post("/appointment", (req, res) => {
  const data = req.body;
  appointments.push(data);
  fs.writeFileSync(filePath, JSON.stringify(appointments, null, 2));
  res.json({ message: "Appointment saved successfully" });
});

app.get("/appointments", authenticateToken, requireAdmin, (req, res) => {
  res.json(appointments);
});

// ✅ NOTICE ROUTES
app.get("/notice", async (req, res) => {
  const notice = await Notice.findOne();
  if (!notice) return res.json(null);
  if (notice.expiresAt && new Date(notice.expiresAt) <= new Date()) {
    await Notice.deleteOne({ _id: notice._id });
    return res.json(null);
  }
  res.json(notice);
});

app.post("/notice", authenticateToken, requireAdmin, async (req, res) => {
  const { message, expiresInHours } = req.body;
  const parsedHours = Number(expiresInHours || 0);
  const expiresAt = parsedHours > 0
    ? new Date(Date.now() + parsedHours * 60 * 60 * 1000)
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

// ✅ START SERVER
app.listen(5000, () => {
  console.log("Server running on port 5000 🚀");
});

// POST /orders — user places a new order
app.post("/orders", authenticateToken, async (req, res) => {
  try {
    const { items, total, paymentMethod } = req.body;

    if (!items || !total) {
      return res.status(400).json({ message: "Missing items or total" });
    }

    const order = new Order({
      userId: req.user.id,
      items,
      total,
      paymentMethod: paymentMethod || "cash",
      status: "Pending",
    });

    await order.save();
    console.log("ORDER SAVED:", order);
    res.status(201).json({ message: "Order placed successfully", order });

  } catch (err) {
    console.error("Error saving order:", err);
    res.status(500).json({ message: "Error saving order" });
  }
});

// GET /orders — admin gets all orders
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

