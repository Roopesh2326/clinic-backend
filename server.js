require("dotenv").config();
const mongoose = require("mongoose");
const express  = require("express");
const cors     = require("cors");
const nodemailer = require("nodemailer");
const jwt      = require("jsonwebtoken");
const bcrypt   = require("bcryptjs");
const cookieParser = require("cookie-parser");
const http     = require("http");
const { Server } = require("socket.io");

const Order       = require("./models/Order");
const Notice      = require("./models/Notice");
const User        = require("./models/User");
const Medicine    = require("./models/Medicine");
const Counter     = require("./models/Counter");
const QueueState  = require("./models/QueueState");
const Appointment = require("./models/Appointment");

const app    = express();
const server = http.createServer(app);

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────
const io = new Server(server, { cors: { origin: true, credentials: true } });
io.on("connection", (socket) => {
  console.log(`[Socket] connected: ${socket.id}`);
  socket.on("disconnect", () => console.log(`[Socket] disconnected: ${socket.id}`));
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB error", err));

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
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
  if (req.user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
  next();
};
// staff OR admin
const requireStaff = (req, res, next) => {
  if (req.user?.role !== "staff" && req.user?.role !== "admin")
    return res.status(403).json({ message: "Staff access required" });
  next();
};

// ─── HEALTH + KEEP-ALIVE (prevents Render cold starts) ───────────────────────
app.get("/", (req, res) => res.json({ status: "ok", ts: Date.now() }));
app.get("/ping", (req, res) => res.json({ pong: true, ts: Date.now() }));

// ─── NODEMAILER ───────────────────────────────────────────────────────────────
require("dns").setDefaultResultOrder("ipv4first");
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com", port: 587, secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  tls: { rejectUnauthorized: false },
});
transporter.verify((err) => {
  if (err) console.error("Email error:", err.message);
  else console.log("Email ready");
});

const sendOrderEmails = async ({ order, userEmail, items, total, paymentMethod, tokenStr }) => {
  try {
    const orderId  = order._id.toString().slice(-6).toUpperCase();
    const itemRows = items.map((item) =>
      `<tr><td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;">${item.name}</td>
       <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:center;">${item.quantity || 1}</td>
       <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;">Rs.${((item.price||0)*(item.quantity||1)).toFixed(2)}</td></tr>`
    ).join("");
    const tokenRow = tokenStr ? `<tr><td style="padding:6px 0;color:#555;">Queue Token</td><td style="padding:6px 0;font-weight:700;color:#166534;">${tokenStr}</td></tr>` : "";
    const html = `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;"><div style="background:#166534;padding:24px 32px;border-radius:12px 12px 0 0;"><h1 style="margin:0;color:white;">Digital Clinic</h1></div><div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:28px 32px;"><h2 style="color:#166534;">Order Confirmed</h2><table style="width:100%;font-size:14px;border-collapse:collapse;margin-bottom:20px;"><tr><td style="padding:6px 0;color:#555;">Order ID</td><td style="font-weight:700;color:#166534;">#${orderId}</td></tr>${tokenRow}<tr><td style="padding:6px 0;color:#555;">Payment</td><td>${paymentMethod||"Cash"}</td></tr></table><table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;"><thead><tr style="background:#f9fafb;"><th style="padding:10px 12px;text-align:left;border-bottom:1px solid #e5e7eb;">Medicine</th><th style="padding:10px 12px;text-align:center;border-bottom:1px solid #e5e7eb;">Qty</th><th style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">Subtotal</th></tr></thead><tbody>${itemRows}</tbody></table><div style="text-align:right;font-size:17px;font-weight:700;color:#166534;padding:12px 0;border-top:2px solid #e5e7eb;">Total: Rs.${Number(total).toFixed(2)}</div></div></div>`;
    const promises = [transporter.sendMail({ from: `"Digital Clinic" <${process.env.EMAIL_USER}>`, to: userEmail, subject: `Order Confirmed #${orderId}${tokenStr?" | "+tokenStr:""}`, html })];
    if (process.env.ADMIN_EMAIL) promises.push(transporter.sendMail({ from: `"Digital Clinic System" <${process.env.EMAIL_USER}>`, to: process.env.ADMIN_EMAIL, subject: `New Order #${orderId}`, html }));
    await Promise.all(promises);
    console.log(`[Email] Sent #${orderId} to ${userEmail}`);
  } catch (err) { console.error("[Email] Failed:", err.message); }
};

// ─── TOKEN HELPERS ────────────────────────────────────────────────────────────
const getTodayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const getNextToken = async (type = "order") => {
  const date = getTodayIST();
  const key  = `${type}:${date}`;
  const counter = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 }, $setOnInsert: { date, createdAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const num    = counter.seq;
  const prefix = type === "appointment" ? "APT" : type === "walkin" ? "WLK" : "ORD";
  return { token: num, tokenStr: `${prefix}-${String(num).padStart(3,"0")}`, date };
};

const getTodayTokenCount = async (type) => {
  const counter = await Counter.findOne({ key: `${type}:${getTodayIST()}` });
  return counter ? counter.seq : 0;
};

// ─── QUEUE ROUTES ─────────────────────────────────────────────────────────────

// GET /queue/status — public, single type
app.get("/queue/status", async (req, res) => {
  try {
    const type = req.query.type || "appointment";
    if (!["appointment","order","walkin"].includes(type)) return res.status(400).json({ message: "Invalid type" });
    let state = await QueueState.findOne({ type });
    if (!state) state = await QueueState.create({ type, currentServing: 0 });
    const totalIssued = await getTodayTokenCount(type);
    res.json({ type, currentServing: state.currentServing, totalIssued, nextToken: totalIssued+1, lastUpdated: state.lastUpdated });
  } catch (err) { res.status(500).json({ message: "Error fetching queue status" }); }
});

// GET /queue — public, all types — used by TV/tablet Queue Display screen
app.get("/queue", async (req, res) => {
  try {
    const types  = ["appointment","order","walkin"];
    const result = {};
    await Promise.all(types.map(async (type) => {
      let state = await QueueState.findOne({ type });
      if (!state) state = { currentServing: 0, lastUpdated: new Date() };
      const totalIssued = await getTodayTokenCount(type);
      const serving     = state.currentServing || 0;
      const prefix      = type === "appointment" ? "APT" : type === "walkin" ? "WLK" : "ORD";
      const next        = [];
      for (let i = serving + 1; i <= Math.min(serving + 5, totalIssued); i++) {
        next.push({ number: i, tokenStr: `${prefix}-${String(i).padStart(3,"0")}` });
      }
      result[type] = {
        current:      serving > 0 ? { number: serving, tokenStr: `${prefix}-${String(serving).padStart(3,"0")}` } : null,
        next,
        totalIssued,
        lastUpdated:  state.lastUpdated,
      };
    }));
    res.json(result);
  } catch (err) { console.error("[Queue Display]", err); res.status(500).json({ message: "Error fetching queue" }); }
});

// GET /appointments/today — PUBLIC, today's appointments only, for ReceptionDesk queue panel
// Safe to be public: only exposes today's data with limited fields, no PII beyond name/contact
app.get("/appointments/today", async (req, res) => {
  try {
    const today = getTodayIST();
    const apts  = await Appointment.find({ tokenDate: today, status: { $ne: "Cancelled" } })
      .sort({ tokenNumber: 1 })
      .select("name tokenStr tokenNumber tokenDate status contact bookedAt source");
    res.json(apts);
  } catch (err) { res.status(500).json({ message: "Error fetching today queue" }); }
});

// GET /queue/today — authenticated, detailed queue summary
app.get("/queue/today", authenticateToken, async (req, res) => {
  try {
    const start     = new Date(); start.setHours(0,0,0,0);
    const end       = new Date(); end.setHours(23,59,59,999);
    const todayApts = await Appointment.find({ bookedAt: { $gte: start, $lte: end }, status: { $ne: "Cancelled" } }).sort({ tokenNumber: 1 });
    const serving   = todayApts.find(a => a.status === "Confirmed") || todayApts.find(a => a.status === "Pending");
    const waiting   = todayApts.filter(a => a !== serving && (a.status === "Pending" || a.status === "Confirmed"));
    res.json({ date: getTodayIST(), total: todayApts.length, done: todayApts.filter(a=>a.status==="Completed").length, waiting: waiting.length, serving: serving||null, queue: waiting.slice(0,10), allTokens: todayApts });
  } catch (err) { res.status(500).json({ message: "Error fetching queue" }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /queue/next — admin only
//
// CHANGED BEHAVIOUR (appointment type):
//   1. Find the appointment currently being served (lowest tokenNumber with
//      status Confirmed or Pending) and mark it "Completed" automatically.
//   2. Increment the QueueState counter so the next patient is now serving.
//   3. Broadcast the update via Socket.io.
//
// Doctor workflow: tap "Next Patient" once → current patient auto-completes,
// next token appears on the display.  No separate "mark completed" step.
// ══════════════════════════════════════════════════════════════════════════════
app.post("/queue/next", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const type = req.body.type || "appointment";
    if (!["appointment","order","walkin"].includes(type)) return res.status(400).json({ message: "Invalid type" });

    const today = getTodayIST();

    // ── Step 1: Auto-complete the currently serving appointment ──────────
    if (type === "appointment") {
      const serving = await Appointment.findOne({
        tokenDate: today,
        status:    { $in: ["Confirmed", "Pending"] },
      }).sort({ tokenNumber: 1 });          // lowest active token = currently serving

      if (serving) {
        serving.status = "Completed";
        await serving.save();
        console.log(`[Queue] Auto-completed: ${serving.tokenStr} — ${serving.name}`);
      } else {
        console.log("[Queue] No active appointment found to complete");
      }
    }

    // ── Step 2: Increment the counter ────────────────────────────────────
    const totalIssued = await getTodayTokenCount(type);
    const state = await QueueState.findOneAndUpdate(
      { type },
      { $inc: { currentServing: 1 }, $set: { lastUpdated: new Date() } },
      { upsert: true, new: true }
    );

    // Cap so we don't go past the last issued token
    if (state.currentServing > totalIssued && totalIssued > 0) {
      await QueueState.updateOne({ type }, { $set: { currentServing: totalIssued } });
      state.currentServing = totalIssued;
    }

    // ── Step 3: Broadcast to queue display + admin panel ─────────────────
    io.emit("queue:update", {
      type,
      currentServing: state.currentServing,
      totalIssued,
      lastUpdated:    state.lastUpdated,
    });

    console.log(`[Queue] ${type} → now serving #${state.currentServing} of ${totalIssued}`);

    res.json({
      message:        `Now serving ${type} #${state.currentServing}`,
      type,
      currentServing: state.currentServing,
      totalIssued,
      lastUpdated:    state.lastUpdated,
    });
  } catch (err) {
    console.error("[Queue] next error:", err);
    res.status(500).json({ message: "Error advancing queue" });
  }
});

// POST /queue/reset — admin only
app.post("/queue/reset", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const type = req.body.type || "appointment";
    if (!["appointment","order","walkin"].includes(type)) return res.status(400).json({ message: "Invalid type" });
    await QueueState.findOneAndUpdate({ type }, { $set: { currentServing: 0, lastUpdated: new Date() } }, { upsert: true, new: true });
    io.emit("queue:update", { type, currentServing: 0, totalIssued: 0, lastUpdated: new Date() });
    res.json({ message: `${type} queue reset to 0` });
  } catch (err) { res.status(500).json({ message: "Error resetting queue" }); }
});

// ─── AUTH ─────────────────────────────────────────────────────────────────────
app.post("/register", authenticateToken, requireAdmin, async (req, res) => {
  const { name, email, phone, password, role } = req.body;
  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: "Email already registered" });
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, email, phone, password: hashedPassword, role: role || "user" });
    await user.save();
    if (phone) await Order.updateMany({ orderType: "walk-in", "guestInfo.phone": String(phone).trim(), userId: null }, { $set: { userId: user._id } });
    res.json({ message: "User created successfully", user: { _id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role } });
  } catch (err) { res.status(400).json({ message: "Error creating user" }); }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ message: "Invalid credentials" });
    if (user.isDisabled) return res.status(403).json({ message: "Account is disabled. Contact admin." });
    const token = jwt.sign({ id: user._id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
    res.cookie("token", token, { httpOnly: true, secure: true, sameSite: "None" });
    res.json({ message: "Login successful", role: user.role, name: user.name, email: user.email, phone: user.phone, userId: user._id });
  } catch (err) { res.status(500).json({ message: "Error logging in" }); }
});

app.post("/logout", (req, res) => { res.clearCookie("token"); res.json({ message: "Logged out" }); });

app.get("/profile", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) { res.status(500).json({ message: "Error fetching profile" }); }
});

app.post("/forgot-password", async (req, res) => {
  const { email, phone, newPassword } = req.body;
  if (!email || !phone || !newPassword) return res.status(400).json({ message: "All fields are required" });
  if (String(newPassword).length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
  try {
    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (String(user.phone).trim() !== String(phone).trim()) return res.status(401).json({ message: "Phone number does not match" });
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ message: "Password reset successful" });
  } catch (err) { res.status(500).json({ message: "Failed to reset password" }); }
});

// ─── USER MANAGEMENT ──────────────────────────────────────────────────────────
app.get("/users", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.json(users || []);
  } catch (err) { res.status(500).json({ message: "Error fetching users" }); }
});

app.get("/users/search", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { phone, name } = req.query;
    const query = {};
    if (phone) query.phone = { $regex: String(phone).trim(), $options: "i" };
    if (name)  query.name  = { $regex: String(name).trim(),  $options: "i" };
    const users = await User.find(query).select("-password").limit(10);
    res.json(users);
  } catch (err) { res.status(500).json({ message: "Error searching users" }); }
});

app.post("/users/create", authenticateToken, requireAdmin, async (req, res) => {
  const { name, email, phone, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: "Name, email and password are required" });
  const allowedRoles = ["admin","staff","reception","user"];
  if (role && !allowedRoles.includes(role)) return res.status(400).json({ message: "Invalid role" });
  try {
    const existing = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (existing) return res.status(400).json({ message: "Email already exists" });
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ name: name.trim(), email: String(email).toLowerCase().trim(), phone: phone||"", password: hashed, role: role||"user" });
    await user.save();
    console.log(`[Users] Created: ${user.email} (${user.role})`);
    res.status(201).json({ message: "User created successfully", user: { _id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role, createdAt: user.createdAt } });
  } catch (err) { console.error("[Users] create error:", err); res.status(500).json({ message: "Error creating user" }); }
});

app.patch("/users/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, email, phone, password, role } = req.body;
    const update = {};
    if (name)  update.name  = name.trim();
    if (email) update.email = String(email).toLowerCase().trim();
    if (phone) update.phone = phone;
    if (role)  update.role  = role;
    if (password) {
      if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
      update.password = await bcrypt.hash(password, 10);
    }
    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "User updated", user });
  } catch (err) { res.status(500).json({ message: "Error updating user" }); }
});

app.patch("/users/:id/role", authenticateToken, requireAdmin, async (req, res) => {
  const { role } = req.body;
  if (!["admin","staff","reception","user"].includes(role)) return res.status(400).json({ message: "Invalid role" });
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "Role updated", user });
  } catch (err) { res.status(500).json({ message: "Error updating role" }); }
});

app.patch("/users/:id/disable", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (String(user._id) === String(req.user.id)) return res.status(400).json({ message: "Cannot disable your own account" });
    user.isDisabled = !user.isDisabled;
    await user.save();
    res.json({ message: user.isDisabled ? "User disabled" : "User enabled", user: { _id: user._id, name: user.name, isDisabled: user.isDisabled } });
  } catch (err) { res.status(500).json({ message: "Error toggling user status" }); }
});

app.delete("/users/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (String(req.params.id) === String(req.user.id)) return res.status(400).json({ message: "Cannot delete your own account" });
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "User deleted permanently" });
  } catch (err) { res.status(500).json({ message: "Error deleting user" }); }
});

// ─── APPOINTMENTS ─────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// POST /appointment — public (patients and receptionist both use this)
//
// CHANGED BEHAVIOUR:
//   source === "reception"  → status = "Confirmed"  (immediate, no approval step)
//   source === "online"     → status = "Pending"    (admin reviews before confirming)
//
// The receptionist's ReceptionDesk.jsx already sends source: "reception".
// Online booking pages send source: "online" (or omit it — defaults to Pending).
// ══════════════════════════════════════════════════════════════════════════════
app.post("/appointment", async (req, res) => {
  try {
    const { token, tokenStr, date } = await getNextToken("appointment");
    const isReception = String(req.body.source || "").toLowerCase() === "reception";

    const apt = new Appointment({
      name:        String(req.body.name    || "").trim(),
      age:         String(req.body.age     || ""),
      problem:     String(req.body.problem || ""),
      contact:     String(req.body.contact || "").trim(),
      email:       String(req.body.email   || ""),
      date:        req.body.date  || "",
      time:        req.body.time  || "",
      userId:      req.body.userId || null,
      source:      req.body.source || "online",
      // ✅ Reception → Confirmed instantly (joins queue immediately)
      // ✅ Online    → Pending (waits for doctor to confirm)
      status:      isReception ? "Confirmed" : "Pending",
      tokenNumber: token,
      tokenStr,
      tokenDate:   date,
      bookedAt:    req.body.bookedAt ? new Date(req.body.bookedAt) : new Date(),
    });

    await apt.save();
    console.log(`[Appointment] ${tokenStr} | ${apt.name} | Status: ${apt.status} | Source: ${apt.source}`);

    res.json({
      message:     "Appointment booked successfully!",
      tokenNumber: token,
      tokenStr,
      tokenDate:   date,
      status:      apt.status,   // ← included so frontend can show correct badge
    });
  } catch (err) {
    console.error("Appointment error:", err);
    res.status(500).json({ message: "Error saving appointment" });
  }
});

// GET /appointments — admin only, all appointments
app.get("/appointments", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const apts = await Appointment.find().sort({ bookedAt: -1 }).populate("userId", "name email phone");
    res.json(apts);
  } catch (err) { res.status(500).json({ message: "Error fetching appointments" }); }
});

// GET /appointments/my — patient's own appointments
app.get("/appointments/my", authenticateToken, async (req, res) => {
  try {
    const userId    = req.user.id;
    const user      = await User.findById(userId).select("phone");
    const userPhone = user?.phone ? String(user.phone).trim() : null;
    const query     = { $or: [{ userId: new mongoose.Types.ObjectId(userId) }, ...(userPhone ? [{ contact: userPhone }] : [])] };
    const apts      = await Appointment.find(query).sort({ bookedAt: -1 });
    res.json(apts);
  } catch (err) { res.status(500).json({ message: "Error fetching appointments" }); }
});

// PATCH /appointments/:id/status — admin manual override always available
app.patch("/appointments/:id/status", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!["Pending","Confirmed","Completed","Cancelled"].includes(status)) return res.status(400).json({ message: "Invalid status" });
    const apt = await Appointment.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!apt) return res.status(404).json({ message: "Appointment not found" });
    res.json({ message: "Status updated", appointment: apt });
  } catch (err) { res.status(500).json({ message: "Error updating appointment status" }); }
});

app.delete("/appointments/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const apt = await Appointment.findByIdAndDelete(req.params.id);
    if (!apt) return res.status(404).json({ message: "Appointment not found" });
    res.json({ message: "Appointment deleted" });
  } catch (err) { res.status(500).json({ message: "Error deleting appointment" }); }
});

// ─── NOTICES ──────────────────────────────────────────────────────────────────
app.get("/notice", async (req, res) => {
  try {
    const notice = await Notice.findOne();
    if (!notice) return res.json(null);
    if (notice.expiresAt && new Date(notice.expiresAt) <= new Date()) { await Notice.deleteOne({ _id: notice._id }); return res.json(null); }
    res.json(notice);
  } catch (err) { res.status(500).json({ message: "Error fetching notice" }); }
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

// ─── MEDICINES ────────────────────────────────────────────────────────────────
// IMPORTANT: /medicines/:id/permanent MUST be before /medicines/:id

app.get("/medicines", async (req, res) => {
  try {
    const medicines = await Medicine.find({ isActive: true }).sort({ createdAt: -1 });
    res.json(medicines);
  } catch (err) { res.status(500).json({ message: "Error fetching medicines" }); }
});

app.get("/medicines/all", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const medicines = await Medicine.find().sort({ createdAt: -1 });
    res.json(medicines);
  } catch (err) { res.status(500).json({ message: "Error fetching medicines" }); }
});

app.get("/medicines/low-stock", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const medicines = await Medicine.find({ isActive: true, $expr: { $lte: ["$stock","$lowStockThreshold"] } });
    res.json(medicines);
  } catch (err) { res.status(500).json({ message: "Error fetching low stock" }); }
});

app.post("/medicines", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, desc, price, category, img, stock, lowStockThreshold, unit } = req.body;
    if (!name || !price) return res.status(400).json({ message: "Name and price are required" });
    const medicine = new Medicine({ name: name.trim(), desc: desc||"", price: Number(price), category: category||"General", img: img||"", stock: Number(stock)||100, lowStockThreshold: Number(lowStockThreshold)||10, unit: unit||"units", isActive: true });
    await medicine.save();
    res.status(201).json({ message: "Medicine added successfully", medicine });
  } catch (err) { res.status(500).json({ message: "Error adding medicine" }); }
});

app.put("/medicines/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, desc, price, category, img, stock, lowStockThreshold, unit, isActive } = req.body;
    const medicine = await Medicine.findByIdAndUpdate(req.params.id, {
      ...(name && { name: name.trim() }), ...(desc !== undefined && { desc }),
      ...(price && { price: Number(price) }), ...(category && { category }),
      ...(img !== undefined && { img }), ...(stock !== undefined && { stock: Number(stock) }),
      ...(lowStockThreshold !== undefined && { lowStockThreshold: Number(lowStockThreshold) }),
      ...(unit && { unit }), ...(isActive !== undefined && { isActive }), updatedAt: new Date(),
    }, { new: true });
    if (!medicine) return res.status(404).json({ message: "Medicine not found" });
    res.json({ message: "Medicine updated successfully", medicine });
  } catch (err) { res.status(500).json({ message: "Error updating medicine" }); }
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
  } catch (err) { res.status(500).json({ message: "Error updating stock" }); }
});

// PERMANENT DELETE — must be defined BEFORE the soft-delete route
app.delete("/medicines/:id/permanent", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const medicine = await Medicine.findByIdAndDelete(req.params.id);
    if (!medicine) return res.status(404).json({ message: "Medicine not found" });
    console.log(`Permanently deleted medicine: ${medicine.name}`);
    res.json({ message: "Medicine permanently deleted" });
  } catch (err) { console.error("Permanent delete error:", err); res.status(500).json({ message: "Error deleting medicine" }); }
});

// SOFT DELETE
app.delete("/medicines/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const medicine = await Medicine.findByIdAndUpdate(req.params.id, { isActive: false, updatedAt: new Date() }, { new: true });
    if (!medicine) return res.status(404).json({ message: "Medicine not found" });
    res.json({ message: "Medicine removed from store" });
  } catch (err) { res.status(500).json({ message: "Error removing medicine" }); }
});

// ─── ORDERS ───────────────────────────────────────────────────────────────────
app.post("/orders", authenticateToken, async (req, res) => {
  try {
    const { items, total, paymentMethod } = req.body;
    if (!items || !items.length || !total) return res.status(400).json({ message: "Missing items or total" });
    const { token, tokenStr, date } = await getNextToken("order");
    const order = new Order({ userId: req.user.id, orderType: "online", items, total: Number(total), paymentMethod: paymentMethod||"cash", status: "Pending", tokenNumber: token, tokenStr, tokenDate: date });
    await order.save();
    for (const item of items) await Medicine.findOneAndUpdate({ name: item.name, isActive: true }, { $inc: { stock: -(item.quantity||1) } });
    await order.populate("userId", "name email phone");
    console.log(`Online order | Token: ${tokenStr} | Total: Rs.${total}`);
    res.status(201).json({ message: "Order placed successfully", order });
    sendOrderEmails({ order, userEmail: req.user.email, items, total, paymentMethod, tokenStr });
  } catch (err) { console.error("Order error:", err); res.status(500).json({ message: "Error saving order. Please try again." }); }
});

app.post("/orders/walk-in", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { items, total, paymentMethod, guestName, guestPhone, existingUserId } = req.body;
    if (!items || !items.length || !total) return res.status(400).json({ message: "Missing items or total" });
    if (!guestName && !existingUserId) return res.status(400).json({ message: "Customer name is required" });
    const { token, tokenStr, date } = await getNextToken("walkin");
    let userId = null, guestInfo = { name: "", phone: "" };
    if (existingUserId) { userId = existingUserId; }
    else {
      if (guestPhone) { const u = await User.findOne({ phone: String(guestPhone).trim() }); if (u) userId = u._id; }
      guestInfo = { name: guestName||"", phone: guestPhone||"" };
    }
    const order = new Order({ userId, guestInfo, orderType: "walk-in", items, total: Number(total), paymentMethod: paymentMethod||"cash", status: "Completed", tokenNumber: token, tokenStr, tokenDate: date });
    await order.save();
    for (const item of items) await Medicine.findOneAndUpdate({ name: item.name, isActive: true }, { $inc: { stock: -(item.quantity||1) } });
    if (userId) await order.populate("userId", "name email phone");
    console.log(`Walk-in | Token: ${tokenStr} | Customer: ${guestName}`);
    res.status(201).json({ message: "Walk-in order created successfully", order });
  } catch (err) { console.error("Walk-in error:", err); res.status(500).json({ message: "Error creating walk-in order" }); }
});

app.get("/orders", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const orders = await Order.find().populate("userId","name email phone").sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) { res.status(500).json({ message: "Error fetching orders" }); }
});

app.get("/orders/my", authenticateToken, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const orders = await Order.find({ userId }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) { res.status(500).json({ message: "Error fetching your orders" }); }
});

app.patch("/orders/:id/status", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["Pending","Approved","Out for Delivery","Delivered","Cancelled","Completed"];
    if (!allowed.includes(status)) return res.status(400).json({ message: "Invalid status value" });
    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true }).populate("userId","name email phone");
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json({ message: "Status updated successfully", order });
  } catch (err) { res.status(500).json({ message: "Error updating order status" }); }
});

app.get("/staff/orders", authenticateToken, requireStaff, async (req, res) => {
  try {
    const orders = await Order.find().populate("userId","name email phone").sort({ createdAt: -1 }).limit(200);
    res.json(orders);
  } catch (err) { res.status(500).json({ message: "Error fetching orders" }); }
});

app.patch("/staff/orders/:id/status", authenticateToken, requireStaff, async (req, res) => {
  try {
    const { status } = req.body;
    if (!["Approved","Completed"].includes(status)) return res.status(403).json({ message: "Staff can only set Approved or Completed" });
    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true }).populate("userId","name email phone");
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json({ message: "Status updated", order });
  } catch (err) { res.status(500).json({ message: "Error updating order status" }); }
});

// ─── ANALYTICS ────────────────────────────────────────────────────────────────
app.get("/analytics/sales", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const now        = new Date();
    const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
    const todayEnd   = new Date(now); todayEnd.setHours(23,59,59,999);
    const weekStart  = new Date(now); weekStart.setDate(now.getDate()-6); weekStart.setHours(0,0,0,0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const allOrders  = await Order.find({ status: { $nin: ["Cancelled"] } }).sort({ createdAt: 1 });
    const statsFor = (orders, from, to) => {
      const f = orders.filter(o => { const d = new Date(o.createdAt); return d >= from && d <= to; });
      return { orders: f.length, revenue: f.reduce((s,o)=>s+Number(o.total||0),0), onlineOrders: f.filter(o=>o.orderType!=="walk-in").length, walkinOrders: f.filter(o=>o.orderType==="walk-in").length };
    };
    const topMedsFrom = (orders, limit=5) => {
      const map = {};
      for (const order of orders) for (const item of (order.items||[])) {
        const key = item.name||"Unknown";
        if (!map[key]) map[key] = { name: key, totalQty: 0, totalRevenue: 0 };
        map[key].totalQty += Number(item.quantity||1);
        map[key].totalRevenue += Number(item.price||0)*Number(item.quantity||1);
      }
      return Object.values(map).sort((a,b)=>b.totalQty-a.totalQty).slice(0,limit);
    };
    const dailyChart = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(now); day.setDate(now.getDate()-i);
      const from = new Date(day); from.setHours(0,0,0,0);
      const to   = new Date(day); to.setHours(23,59,59,999);
      const s = statsFor(allOrders, from, to);
      dailyChart.push({ date: day.toLocaleDateString("en-IN",{day:"numeric",month:"short"}), revenue: s.revenue, orders: s.orders });
    }
    const [aptTokens, orderTokens, walkinTokens] = await Promise.all([
      getTodayTokenCount("appointment"),
      getTodayTokenCount("order"),
      getTodayTokenCount("walkin"),
    ]);
    const todayOrders = allOrders.filter(o => new Date(o.createdAt) >= todayStart && new Date(o.createdAt) <= todayEnd);
    res.json({
      today:   { ...statsFor(allOrders, todayStart, todayEnd), topMedicines: topMedsFrom(todayOrders) },
      week:    { ...statsFor(allOrders, weekStart, todayEnd) },
      month:   { ...statsFor(allOrders, monthStart, todayEnd) },
      allTime: { orders: allOrders.length, revenue: allOrders.reduce((s,o)=>s+Number(o.total||0),0) },
      dailyChart,
      topMedicines: topMedsFrom(allOrders, 10),
      todayTokens:  { appointments: aptTokens, onlineOrders: orderTokens, walkInOrders: walkinTokens },
    });
  } catch (err) { console.error("Analytics error:", err); res.status(500).json({ message: "Error computing analytics" }); }
});

app.get("/protected", authenticateToken, (req, res) => res.json({ message: "Protected route working", user: req.user }));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));