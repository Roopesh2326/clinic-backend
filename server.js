import { Resend } from 'resend';
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

mongoose
  .connect(
    process.env.MONGODB_URI ||
      "mongodb+srv://roopeshdeep:32Qwerfdsa@cluster0.00b27mo.mongodb.net/clinicDB"
  )
  .then(() => console.log("MongoDB connected ✅"))
  .catch((err) => console.error("MongoDB error ❌", err));

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

app.get("/", (req, res) => res.send("Backend working ✅"));

require("dns").setDefaultResultOrder("ipv4first");
import { Resend } from 'resend';

const resend = new Resend('re_SijaPRn1_LbsKGyRV8AX2dunFG9N8duBr');

resend.emails.send({
  from: 'onboarding@resend.dev',
  to: req.user.email,
  subject: 'Order Confirmed',
  html: "<h2>Order placed</h2>",
});

// ─── REGISTER ────────────────────────────
app.post("/register", async (req, res) => {
  const { name, email, phone, password, role } = req.body;
  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: "Email already registered" });
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, email, phone, password: hashedPassword, role: role || "user" });
    await user.save();
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
    const token = jwt.sign({ id: user._id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
    res.cookie("token", token, { httpOnly: true, secure: true, sameSite: "None" });
    res.json({
      message: "Login successful",
      role: user.role,
      name: user.name,
      email: user.email,
      phone: user.phone,
      userId: user._id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error logging in" });
  }
});

app.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ message: "Logged out" });
});

app.get("/profile", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Error fetching profile" });
  }
});

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

app.get("/appointments", authenticateToken, requireAdmin, (req, res) => {
  // Sort by bookedAt descending
  const sorted = [...appointments].sort((a, b) =>
    new Date(b.bookedAt || 0) - new Date(a.bookedAt || 0)
  );
  res.json(sorted);
});

app.get("/appointments/my", authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    User.findById(userId).select("phone").then((user) => {
      const userPhone = user?.phone ? String(user.phone).trim() : null;
      const myAppointments = appointments.filter((apt) => {
        if (apt.userId && String(apt.userId) === String(userId)) return true;
        if (userPhone && apt.contact && String(apt.contact).trim() === userPhone) return true;
        return false;
      });
      myAppointments.sort((a, b) => new Date(b.bookedAt || 0) - new Date(a.bookedAt || 0));
      res.json(myAppointments);
    }).catch(() => res.json([]));
  } catch (err) {
    res.status(500).json({ message: "Error fetching appointments" });
  }
});

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
    if (!name || !price) return res.status(400).json({ message: "Name and price are required" });
    const medicine = new Medicine({
      name: name.trim(), desc: desc || "", price: Number(price),
      category: category || "General", img: img || "",
      stock: Number(stock) || 100, lowStockThreshold: Number(lowStockThreshold) || 10,
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

app.post("/orders", authenticateToken, async (req, res) => {
  try {
    const { items, total, paymentMethod } = req.body;

    if (!items || !items.length || !total) {
      return res.status(400).json({ message: "Missing items or total" });
    }

    const order = new Order({
      userId: req.user.id,
      orderType: "online",
      items,
      total: Number(total),
      paymentMethod: paymentMethod || "cash",
      status: "Pending",
    });

    await order.save();

    // Update stock
    for (const item of items) {
      await Medicine.findOneAndUpdate(
        { name: item.name, isActive: true },
        { $inc: { stock: -(item.quantity || 1) } }
      );
    }

    await order.populate("userId", "name email phone");

    // ✅ Send response FIRST (never block user)
    res.status(201).json({
      message: "Order placed successfully",
      order,
    });

    // ✅ EMAIL BLOCK (fully isolated)
    (async () => {
      try {
        console.log("📩 Email process started");

        const orderId = order._id.toString().slice(-6).toUpperCase();

        const itemRows = items.map(item => `
          <tr>
            <td>${item.name}</td>
            <td style="text-align:center;">${item.quantity || 1}</td>
            <td style="text-align:right;">
              Rs.${((item.price || 0) * (item.quantity || 1)).toFixed(2)}
            </td>
          </tr>
        `).join("");

        // ── USER EMAIL ──
        await resend.emails.send({
          from: "Digital Clinic <onboarding@resend.dev>",
          to: req.user.email,
          subject: `Order Confirmed — #${orderId}`,
          html: `
            <h2>Your order is confirmed ✅</h2>
            <p><strong>Order ID:</strong> #${orderId}</p>
            <p><strong>Total:</strong> Rs.${Number(total).toFixed(2)}</p>
            <table border="1" cellspacing="0" cellpadding="6">
              ${itemRows}
            </table>
          `,
        });

        console.log("✅ User email sent");

        // ── ADMIN EMAIL ──
        if (process.env.ADMIN_EMAIL) {
          await resend.emails.send({
            from: "Digital Clinic <onboarding@resend.dev>",
            to: process.env.ADMIN_EMAIL,
            subject: `New Order — #${orderId}`,
            html: `
              <h2>New Order Received</h2>
              <p><strong>Order ID:</strong> #${orderId}</p>
              <p><strong>User:</strong> ${req.user.email}</p>
              <p><strong>Total:</strong> Rs.${Number(total).toFixed(2)}</p>
              <table border="1" cellspacing="0" cellpadding="6">
                ${itemRows}
              </table>
            `,
          });

          console.log("✅ Admin email sent");
        }

      } catch (emailErr) {
        console.error("❌ Email failed:", emailErr.message);
      }
    })();

  } catch (err) {
    console.error("❌ Error saving order:", err);
    res.status(500).json({ message: "Error saving order" });
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

// ─── ANALYTICS ───────────────────────────
app.get("/analytics/sales", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const now = new Date();

    // ── Date boundaries ──
    const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
    const todayEnd   = new Date(now); todayEnd.setHours(23,59,59,999);

    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 6); weekStart.setHours(0,0,0,0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // ── Fetch all non-cancelled orders ──
    const allOrders = await Order.find({
      status: { $nin: ["Cancelled"] }
    }).sort({ createdAt: 1 });

    // ── Helper: revenue + count for a date range ──
    const statsFor = (orders, from, to) => {
      const filtered = orders.filter(o => {
        const d = new Date(o.createdAt);
        return d >= from && d <= to;
      });
      return {
        orders: filtered.length,
        revenue: filtered.reduce((s, o) => s + Number(o.total || 0), 0),
        onlineOrders: filtered.filter(o => o.orderType !== "walk-in").length,
        walkinOrders: filtered.filter(o => o.orderType === "walk-in").length,
      };
    };

    // ── Top medicines helper ──
    const topMedsFrom = (orders, limit = 5) => {
      const map = {};
      for (const order of orders) {
        for (const item of (order.items || [])) {
          const key = item.name || "Unknown";
          if (!map[key]) map[key] = { name: key, totalQty: 0, totalRevenue: 0 };
          map[key].totalQty += Number(item.quantity || 1);
          map[key].totalRevenue += Number(item.price || 0) * Number(item.quantity || 1);
        }
      }
      return Object.values(map)
        .sort((a, b) => b.totalQty - a.totalQty)
        .slice(0, limit);
    };

    // ── Daily chart: last 7 days ──
    const dailyChart = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(now);
      day.setDate(now.getDate() - i);
      const from = new Date(day); from.setHours(0,0,0,0);
      const to   = new Date(day); to.setHours(23,59,59,999);
      const s = statsFor(allOrders, from, to);
      dailyChart.push({
        date: day.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
        revenue: s.revenue,
        orders: s.orders,
      });
    }

    const todayStats = statsFor(allOrders, todayStart, todayEnd);
    const weekStats  = statsFor(allOrders, weekStart, todayEnd);
    const monthStats = statsFor(allOrders, monthStart, todayEnd);
    const allTimeStats = {
      orders: allOrders.length,
      revenue: allOrders.reduce((s, o) => s + Number(o.total || 0), 0),
    };

    res.json({
      today: {
        ...todayStats,
        topMedicines: topMedsFrom(
          allOrders.filter(o => new Date(o.createdAt) >= todayStart && new Date(o.createdAt) <= todayEnd)
        ),
      },
      week:    { ...weekStats },
      month:   { ...monthStats },
      allTime: allTimeStats,
      dailyChart,
      topMedicines: topMedsFrom(allOrders, 10),
    });

  } catch (err) {
    console.error("Analytics error:", err);
    res.status(500).json({ message: "Error computing analytics" });
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