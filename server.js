require("dotenv").config();
const mongoose = require("mongoose");
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cookieParser = require("cookie-parser");
const Order = require("./models/Order");
const Notice = require("./models/Notice");
const User = require("./models/User");
const Medicine = require("./models/Medicine");
const Counter = require("./models/Counter"); // ✅ TOKEN: import Counter model

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
  if (req.user?.role !== "admin")
    return res.status(403).json({ message: "Admin access required" });
  next();
};

app.get("/", (req, res) => res.send("Backend working ✅"));

// ─── NODEMAILER TRANSPORTER ───────────────────────────────────────────────────
require("dns").setDefaultResultOrder("ipv4first");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: { rejectUnauthorized: false },
});

transporter.verify((err) => {
  if (err) console.error("❌ Email transporter error:", err.message);
  else     console.log("✅ Email transporter ready");
});

// ─── EMAIL HELPER ─────────────────────────────────────────────────────────────
const sendOrderEmails = async ({ order, userEmail, items, total, paymentMethod, tokenStr }) => {
  try {
    const orderId  = order._id.toString().slice(-6).toUpperCase();

    const itemRows = items.map((item) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;">${item.name}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:center;">${item.quantity || 1}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;">
          Rs.${((item.price || 0) * (item.quantity || 1)).toFixed(2)}
        </td>
      </tr>
    `).join("");

    // ✅ TOKEN: include token row in email if available
    const tokenRow = tokenStr ? `
      <tr>
        <td style="padding:6px 0;color:#555;">Queue Token</td>
        <td style="padding:6px 0;font-weight:700;color:#166534;font-size:18px;">${tokenStr}</td>
      </tr>
    ` : "";

    const userHtml = `
      <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1a1a1a;">
        <div style="background:#166534;padding:24px 32px;border-radius:12px 12px 0 0;">
          <h1 style="margin:0;color:white;font-size:22px;">Digital Clinic</h1>
          <p style="margin:4px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">Order Confirmation</p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:28px 32px;">
          <h2 style="margin:0 0 8px;color:#166534;font-size:20px;">Your order is confirmed! ✅</h2>
          <p style="color:#888;font-size:14px;margin:0 0 24px;">Thank you for choosing Digital Clinic.</p>

          <table style="width:100%;font-size:14px;border-collapse:collapse;margin-bottom:20px;">
            <tr>
              <td style="padding:6px 0;color:#555;width:140px;">Order ID</td>
              <td style="padding:6px 0;font-weight:700;color:#166534;">#${orderId}</td>
            </tr>
            ${tokenRow}
            <tr>
              <td style="padding:6px 0;color:#555;">Status</td>
              <td style="padding:6px 0;font-weight:600;">Pending</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#555;">Payment</td>
              <td style="padding:6px 0;text-transform:capitalize;">${paymentMethod || "Cash"}</td>
            </tr>
          </table>

          <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
            <thead>
              <tr style="background:#f9fafb;">
                <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:600;">Medicine</th>
                <th style="padding:10px 12px;text-align:center;border-bottom:1px solid #e5e7eb;font-weight:600;">Qty</th>
                <th style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;font-weight:600;">Subtotal</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>

          <div style="text-align:right;font-size:17px;font-weight:700;color:#166534;
                      padding:12px 0;border-top:2px solid #e5e7eb;margin-bottom:24px;">
            Total: Rs.${Number(total).toFixed(2)}
          </div>

          <p style="font-size:12px;color:#aaa;margin:0;line-height:1.6;">
            You can track your order status anytime in the Digital Clinic app.<br/>
            If you have any questions, contact us at ${process.env.EMAIL_USER}.
          </p>
        </div>
      </div>
    `;

    const adminHtml = `
      <div style="font-family:sans-serif;max-width:540px;color:#1a1a1a;">
        <div style="background:#dc2626;padding:20px 28px;border-radius:12px 12px 0 0;">
          <h2 style="margin:0;color:white;font-size:18px;">New Order Received 🛒</h2>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px 28px;">
          <table style="width:100%;font-size:14px;border-collapse:collapse;margin-bottom:20px;">
            <tr>
              <td style="padding:6px 0;color:#555;width:140px;">Order ID</td>
              <td style="padding:6px 0;font-weight:700;color:#dc2626;">#${orderId}</td>
            </tr>
            ${tokenStr ? `<tr><td style="padding:6px 0;color:#555;">Token</td><td style="padding:6px 0;font-weight:700;">${tokenStr}</td></tr>` : ""}
            <tr>
              <td style="padding:6px 0;color:#555;">Customer</td>
              <td style="padding:6px 0;">${userEmail}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#555;">Payment</td>
              <td style="padding:6px 0;text-transform:capitalize;">${paymentMethod || "cash"}</td>
            </tr>
          </table>

          <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
            <thead>
              <tr style="background:#f9fafb;">
                <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:600;">Medicine</th>
                <th style="padding:8px 12px;text-align:center;border-bottom:1px solid #e5e7eb;font-weight:600;">Qty</th>
                <th style="padding:8px 12px;text-align:right;border-bottom:1px solid #e5e7eb;font-weight:600;">Subtotal</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>

          <div style="text-align:right;font-size:17px;font-weight:700;color:#dc2626;
                      padding:12px 0;border-top:2px solid #e5e7eb;">
            Total: Rs.${Number(total).toFixed(2)}
          </div>
        </div>
      </div>
    `;

    const emailPromises = [
      transporter.sendMail({
        from: `"Digital Clinic" <${process.env.EMAIL_USER}>`,
        to: userEmail,
        subject: `Order Confirmed — #${orderId}${tokenStr ? " | Token: " + tokenStr : ""}`,
        html: userHtml,
      }),
    ];

    if (process.env.ADMIN_EMAIL) {
      emailPromises.push(
        transporter.sendMail({
          from: `"Digital Clinic System" <${process.env.EMAIL_USER}>`,
          to: process.env.ADMIN_EMAIL,
          subject: `New Order — #${orderId}${tokenStr ? " | " + tokenStr : ""}`,
          html: adminHtml,
        })
      );
    }

    await Promise.all(emailPromises);
    console.log(`[Email] ✅ Sent for order #${orderId} → ${userEmail}`);

  } catch (err) {
    console.error("[Email] ❌ Failed:", err.message);
  }
};

// ─── TOKEN SYSTEM ─────────────────────────────────────────────────────────────
// Returns today's date as YYYY-MM-DD in IST so tokens reset at midnight India time
const getTodayIST = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/**
 * getNextToken(type)
 *
 * Atomically increments a MongoDB counter and returns the next token.
 * Uses findOneAndUpdate with $inc — single atomic operation, race-condition safe.
 * Even 100 concurrent requests each get a unique sequential number.
 *
 * type: "order" → ORD-001  |  "walkin" → WLK-001  |  "appointment" → APT-001
 * Key includes today's date so counters auto-reset daily.
 */
const getNextToken = async (type = "order") => {
  const date = getTodayIST();
  const key  = `${type}:${date}`;

  const counter = await Counter.findOneAndUpdate(
    { key },
    {
      $inc: { seq: 1 },
      $setOnInsert: { date, createdAt: new Date() },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const num      = counter.seq;
  const prefix   = type === "appointment" ? "APT" : type === "walkin" ? "WLK" : "ORD";
  const tokenStr = `${prefix}-${String(num).padStart(3, "0")}`;

  return { token: num, tokenStr, date };
};

// Helper for analytics — how many tokens issued today for a type
const getTodayTokenCount = async (type) => {
  const key     = `${type}:${getTodayIST()}`;
  const counter = await Counter.findOne({ key });
  return counter ? counter.seq : 0;
};

// ─── REGISTER ────────────────────────────────────────────────────────────────
app.post("/register", async (req, res) => {
  const { name, email, phone, password, role } = req.body;
  try {
    const existing = await User.findOne({ email });
    if (existing)
      return res.status(400).json({ message: "Email already registered" });
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

// ─── LOGIN ────────────────────────────────────────────────────────────────────
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ message: "Invalid credentials" });
    const token = jwt.sign(
      { id: user._id, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
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

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
app.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ message: "Logged out" });
});

// ─── PROFILE ──────────────────────────────────────────────────────────────────
app.get("/profile", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Error fetching profile" });
  }
});

// ─── FORGOT PASSWORD ──────────────────────────────────────────────────────────
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

// ─── USERS ────────────────────────────────────────────────────────────────────
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
    if (name)  query.name  = { $regex: String(name).trim(),  $options: "i" };
    const users = await User.find(query).select("-password").limit(10);
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Error searching users" });
  }
});

// ─── APPOINTMENTS ─────────────────────────────────────────────────────────────
const filePath = "appointments.json";
let appointments = [];
if (fs.existsSync(filePath)) {
  try { appointments = JSON.parse(fs.readFileSync(filePath)); }
  catch { appointments = []; }
}

// ✅ TOKEN: appointment booking now gets an atomic APT-xxx token
app.post("/appointment", async (req, res) => {
  try {
    // Get atomic token BEFORE saving so it's included in the record
    const { token, tokenStr, date } = await getNextToken("appointment");

    const appointmentData = {
      ...req.body,
      id:          Date.now().toString(),
      bookedAt:    req.body.bookedAt || new Date().toISOString(),
      status:      "Pending",
      tokenNumber: token,      // 1, 2, 3 ...
      tokenStr,                // APT-001, APT-002 ...
      tokenDate:   date,       // "2024-04-15"
    };

    appointments.push(appointmentData);
    fs.writeFileSync(filePath, JSON.stringify(appointments, null, 2));

    console.log(`📋 Appointment booked | Token: ${tokenStr} | Patient: ${req.body.name}`);

    res.json({
      message:     "Appointment booked successfully!",
      tokenNumber: token,
      tokenStr,
      tokenDate:   date,
    });
  } catch (err) {
    console.error("Error saving appointment:", err);
    res.status(500).json({ message: "Error saving appointment" });
  }
});

app.get("/appointments", authenticateToken, requireAdmin, (req, res) => {
  const sorted = [...appointments].sort(
    (a, b) => new Date(b.bookedAt || 0) - new Date(a.bookedAt || 0)
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
      myAppointments.sort(
        (a, b) => new Date(b.bookedAt || 0) - new Date(a.bookedAt || 0)
      );
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
    if (idx === -1)
      return res.status(404).json({ message: "Appointment not found" });
    appointments[idx].status = status;
    fs.writeFileSync(filePath, JSON.stringify(appointments, null, 2));
    res.json({ message: "Status updated", appointment: appointments[idx] });
  } catch (err) {
    res.status(500).json({ message: "Error updating appointment status" });
  }
});

// ✅ TOKEN: today's appointment token count for admin dashboard
app.get("/appointments/today-count", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const count = await getTodayTokenCount("appointment");
    res.json({ count, date: getTodayIST() });
  } catch (err) {
    res.status(500).json({ message: "Error fetching count" });
  }
});

// ─── NOTICES ──────────────────────────────────────────────────────────────────
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
  const expiresAt   = parsedHours > 0 ? new Date(Date.now() + parsedHours * 3600000) : null;
  let notice = await Notice.findOne();
  if (notice) { notice.message = message; notice.expiresAt = expiresAt; await notice.save(); }
  else { notice = new Notice({ message, expiresAt }); await notice.save(); }
  res.json({ message: "Notice updated" });
});

app.delete("/notice", authenticateToken, requireAdmin, async (req, res) => {
  await Notice.deleteMany({});
  res.json({ message: "Notice deleted" });
});

// ─── MEDICINES ────────────────────────────────────────────────────────────────
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
      $expr: { $lte: ["$stock", "$lowStockThreshold"] },
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
        ...(name  && { name: name.trim() }),
        ...(desc  !== undefined && { desc }),
        ...(price && { price: Number(price) }),
        ...(category && { category }),
        ...(img   !== undefined && { img }),
        ...(stock !== undefined && { stock: Number(stock) }),
        ...(lowStockThreshold !== undefined && { lowStockThreshold: Number(lowStockThreshold) }),
        ...(unit  && { unit }),
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
    if (operation === "add")           medicine.stock = medicine.stock + Number(stock);
    else if (operation === "subtract") medicine.stock = Math.max(0, medicine.stock - Number(stock));
    else                               medicine.stock = Number(stock);
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
      req.params.id,
      { isActive: false, updatedAt: new Date() },
      { new: true }
    );
    if (!medicine) return res.status(404).json({ message: "Medicine not found" });
    res.json({ message: "Medicine removed from store" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting medicine" });
  }
});

// ─── ORDERS ───────────────────────────────────────────────────────────────────

// POST /orders — online order with atomic ORD-xxx token
app.post("/orders", authenticateToken, async (req, res) => {
  try {
    const { items, total, paymentMethod } = req.body;
    if (!items || !items.length || !total)
      return res.status(400).json({ message: "Missing items or total" });

    // ✅ TOKEN: get atomic token before saving
    const { token, tokenStr, date } = await getNextToken("order");

    const order = new Order({
      userId:      req.user.id,
      orderType:   "online",
      items,
      total:       Number(total),
      paymentMethod: paymentMethod || "cash",
      status:      "Pending",
      tokenNumber: token,    // ✅
      tokenStr,              // ✅
      tokenDate:   date,     // ✅
    });
    await order.save();

    for (const item of items) {
      await Medicine.findOneAndUpdate(
        { name: item.name, isActive: true },
        { $inc: { stock: -(item.quantity || 1) } }
      );
    }

    await order.populate("userId", "name email phone");

    console.log(`🛒 Online order | Token: ${tokenStr} | Total: Rs.${total}`);

    // Respond immediately — never wait for email
    res.status(201).json({ message: "Order placed successfully", order });

    // Fire-and-forget email with token included
    sendOrderEmails({
      order,
      userEmail:    req.user.email,
      items,
      total,
      paymentMethod,
      tokenStr,     // ✅ pass token to email
    });

  } catch (err) {
    console.error("❌ Error saving order:", err);
    res.status(500).json({ message: "Error saving order. Please try again." });
  }
});

// POST /orders/walk-in — walk-in order with atomic WLK-xxx token
app.post("/orders/walk-in", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { items, total, paymentMethod, guestName, guestPhone, existingUserId } = req.body;
    if (!items || !items.length || !total)
      return res.status(400).json({ message: "Missing items or total" });
    if (!guestName && !existingUserId)
      return res.status(400).json({ message: "Customer name is required" });

    // ✅ TOKEN: walk-in gets its own WLK series
    const { token, tokenStr, date } = await getNextToken("walkin");

    let userId    = null;
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
      userId,
      guestInfo,
      orderType:   "walk-in",
      items,
      total:       Number(total),
      paymentMethod: paymentMethod || "cash",
      status:      "Completed",
      tokenNumber: token,    // ✅
      tokenStr,              // ✅
      tokenDate:   date,     // ✅
    });
    await order.save();

    for (const item of items) {
      await Medicine.findOneAndUpdate(
        { name: item.name, isActive: true },
        { $inc: { stock: -(item.quantity || 1) } }
      );
    }

    if (userId) await order.populate("userId", "name email phone");

    console.log(`🏪 Walk-in order | Token: ${tokenStr} | Customer: ${guestName} | Total: Rs.${total}`);

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
    const allowed = ["Pending","Approved","Out for Delivery","Delivered","Cancelled","Completed"];
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

// ─── ANALYTICS ────────────────────────────────────────────────────────────────
app.get("/analytics/sales", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
    const todayEnd   = new Date(now); todayEnd.setHours(23,59,59,999);
    const weekStart  = new Date(now);
    weekStart.setDate(now.getDate() - 6); weekStart.setHours(0,0,0,0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const allOrders = await Order.find({ status: { $nin: ["Cancelled"] } }).sort({ createdAt: 1 });

    const statsFor = (orders, from, to) => {
      const filtered = orders.filter((o) => { const d = new Date(o.createdAt); return d >= from && d <= to; });
      return {
        orders:       filtered.length,
        revenue:      filtered.reduce((s, o) => s + Number(o.total || 0), 0),
        onlineOrders: filtered.filter((o) => o.orderType !== "walk-in").length,
        walkinOrders: filtered.filter((o) => o.orderType === "walk-in").length,
      };
    };

    const topMedsFrom = (orders, limit = 5) => {
      const map = {};
      for (const order of orders) {
        for (const item of (order.items || [])) {
          const key = item.name || "Unknown";
          if (!map[key]) map[key] = { name: key, totalQty: 0, totalRevenue: 0 };
          map[key].totalQty     += Number(item.quantity || 1);
          map[key].totalRevenue += Number(item.price || 0) * Number(item.quantity || 1);
        }
      }
      return Object.values(map).sort((a, b) => b.totalQty - a.totalQty).slice(0, limit);
    };

    const dailyChart = [];
    for (let i = 6; i >= 0; i--) {
      const day  = new Date(now); day.setDate(now.getDate() - i);
      const from = new Date(day); from.setHours(0,0,0,0);
      const to   = new Date(day); to.setHours(23,59,59,999);
      const s    = statsFor(allOrders, from, to);
      dailyChart.push({
        date:    day.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
        revenue: s.revenue,
        orders:  s.orders,
      });
    }

    const todayStats   = statsFor(allOrders, todayStart, todayEnd);
    const weekStats    = statsFor(allOrders, weekStart,  todayEnd);
    const monthStats   = statsFor(allOrders, monthStart, todayEnd);
    const allTimeStats = {
      orders:  allOrders.length,
      revenue: allOrders.reduce((s, o) => s + Number(o.total || 0), 0),
    };

    // ✅ TOKEN: include today's token counts in analytics response
    const [aptTokens, orderTokens, walkinTokens] = await Promise.all([
      getTodayTokenCount("appointment"),
      getTodayTokenCount("order"),
      getTodayTokenCount("walkin"),
    ]);

    res.json({
      today: {
        ...todayStats,
        topMedicines: topMedsFrom(
          allOrders.filter(
            (o) => new Date(o.createdAt) >= todayStart && new Date(o.createdAt) <= todayEnd
          )
        ),
      },
      week:         { ...weekStats  },
      month:        { ...monthStats },
      allTime:      allTimeStats,
      dailyChart,
      topMedicines: topMedsFrom(allOrders, 10),
      // ✅ TOKEN: how many of each token type issued today
      todayTokens: {
        appointments: aptTokens,    // APT-001 ... APT-{n}
        onlineOrders: orderTokens,  // ORD-001 ... ORD-{n}
        walkInOrders: walkinTokens, // WLK-001 ... WLK-{n}
      },
    });

  } catch (err) {
    console.error("Analytics error:", err);
    res.status(500).json({ message: "Error computing analytics" });
  }
});

// ─── PROTECTED TEST ───────────────────────────────────────────────────────────
app.get("/protected", authenticateToken, (req, res) => {
  res.json({ message: "Protected route working", user: req.user });
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT + " 🚀");
});