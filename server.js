require("dotenv").config();

// ─── ENV VALIDATION — crash early if critical vars missing ───────────────────
if (!process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET environment variable is not set");
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error("FATAL: MONGODB_URI environment variable is not set");
  process.exit(1);
}

const mongoose      = require("mongoose");
const express       = require("express");
const cors          = require("cors");
const rateLimit     = require("express-rate-limit");
// const mongoSanitize = require("express-mongo-sanitize");
const helmet        = require("helmet");
const nodemailer    = require("nodemailer");
const jwt           = require("jsonwebtoken");
const bcrypt        = require("bcryptjs");
const cookieParser  = require("cookie-parser");
const http          = require("http");
const { Server }    = require("socket.io");

const Order       = require("./models/Order");
const Notice      = require("./models/Notice");
const User        = require("./models/User");
const Medicine    = require("./models/Medicine");
const Counter     = require("./models/Counter");
const QueueState  = require("./models/QueueState");
const Appointment = require("./models/Appointment");
const ActivityLog = require("./models/ActivityLog");

const app    = express();
const server = http.createServer(app);
app.set("trust proxy", 1);

// ─── ALLOWED ORIGINS ──────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  process.env.FRONTEND_URL,
].filter(Boolean);

// ✅ FIX: Allow all origins — works with any frontend URL on Render/Vercel
const corsOptions = {
  origin: [
    "https://clinic-frontend-rho.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173",
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  exposedHeaders: ["set-cookie"],
};

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: [
      "https://clinic-frontend-rho.vercel.app",
      "http://localhost:3000",
      "http://localhost:5173",
    ],
    credentials: true,
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log(`[Socket] connected: ${socket.id}`);
  
  socket.on("disconnect", () => {
    console.log(`[Socket] disconnected: ${socket.id}`);
  });
});

// ─── SECURITY MIDDLEWARE ──────────────────────────────────────────────────────
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
// app.use(mongoSanitize()); // prevent NoSQL injection

// ─── RATE LIMITERS ────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minute
  max: 5,
  message: { message: "Too many login attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { message: "Too many registrations from this IP. Try again later." },
  validate: { xForwardedForHeader: false },
});

// const generalLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 200,
//   message: { message: "Too many requests. Please slow down." },
//   validate: { xForwardedForHeader: false },
// });

// app.use(generalLimiter);

// ─── MONGODB ──────────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => {
    console.error("MongoDB connection failed:", err);
    process.exit(1);
  });

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
  if (req.user?.role !== "admin")
    return res.status(403).json({ message: "Admin access required" });
  next();
};

const requireStaff = (req, res, next) => {
  if (req.user?.role !== "staff" && req.user?.role !== "admin")
    return res.status(403).json({ message: "Staff access required" });
  next();
};

// ─── ACTIVITY LOG HELPER ──────────────────────────────────────────────────────
const logActivity = (req, action, description, meta = {}) => {
  ActivityLog.create({
    userId:    req.user?.id    || null,
    userName:  req.user?.name  || req.user?.email || "Unknown",
    userRole:  req.user?.role  || "unknown",
    userEmail: req.user?.email || "",
    action,
    description,
    meta,
    ip: req.headers["x-forwarded-for"] || req.ip || "",
  }).catch((err) => console.error("[ActivityLog] write failed:", err.message));
};

// ─── HEALTH + KEEP-ALIVE ──────────────────────────────────────────────────────
app.get("/",     (req, res) => res.json({ status: "ok", ts: Date.now() }));
app.get("/ping", (req, res) => res.json({ pong: true, ts: Date.now() }));

app.options("/:any*", cors(corsOptions));

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
      `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;">${item.name}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:center;">${item.quantity || 1}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;">Rs.${((item.price||0)*(item.quantity||1)).toFixed(2)}</td>
      </tr>`
    ).join("");
    const tokenRow = tokenStr
      ? `<tr><td style="padding:6px 0;color:#555;">Queue Token</td><td style="padding:6px 0;font-weight:700;color:#166534;">${tokenStr}</td></tr>`
      : "";
    const html = `
      <div style="font-family:sans-serif;max-width:540px;margin:0 auto;">
        <div style="background:#166534;padding:24px 32px;border-radius:12px 12px 0 0;">
          <h1 style="margin:0;color:white;">Digital Clinic</h1>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:28px 32px;">
          <h2 style="color:#166534;">Order Confirmed</h2>
          <table style="width:100%;font-size:14px;border-collapse:collapse;margin-bottom:20px;">
            <tr><td style="padding:6px 0;color:#555;">Order ID</td><td style="font-weight:700;color:#166534;">#${orderId}</td></tr>
            ${tokenRow}
            <tr><td style="padding:6px 0;color:#555;">Payment</td><td>${paymentMethod||"Cash"}</td></tr>
          </table>
          <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
            <thead>
              <tr style="background:#f9fafb;">
                <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #e5e7eb;">Medicine</th>
                <th style="padding:10px 12px;text-align:center;border-bottom:1px solid #e5e7eb;">Qty</th>
                <th style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb;">Subtotal</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>
          <div style="text-align:right;font-size:17px;font-weight:700;color:#166534;padding:12px 0;border-top:2px solid #e5e7eb;">
            Total: Rs.${Number(total).toFixed(2)}
          </div>
        </div>
      </div>`;
    const promises = [
      transporter.sendMail({
        from: `"Digital Clinic" <${process.env.EMAIL_USER}>`,
        to: userEmail,
        subject: `Order Confirmed #${orderId}${tokenStr ? " | " + tokenStr : ""}`,
        html,
      }),
    ];
    if (process.env.ADMIN_EMAIL) {
      promises.push(transporter.sendMail({
        from: `"Digital Clinic System" <${process.env.EMAIL_USER}>`,
        to: process.env.ADMIN_EMAIL,
        subject: `New Order #${orderId}`,
        html,
      }));
    }
    await Promise.all(promises);
    console.log(`[Email] Sent #${orderId} to ${userEmail}`);
  } catch (err) {
    console.error("[Email] Failed:", err.message);
  }
};

// ─── TOKEN HELPERS ────────────────────────────────────────────────────────────
const getTodayIST = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

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
  return { token: num, tokenStr: `${prefix}-${String(num).padStart(3, "0")}`, date };
};

const getTodayTokenCount = async (type) => {
  const counter = await Counter.findOne({ key: `${type}:${getTodayIST()}` });
  return counter ? counter.seq : 0;
};

// ─── QUEUE ROUTES ─────────────────────────────────────────────────────────────
app.get("/queue/status", async (req, res) => {
  try {
    const type = req.query.type || "appointment";
    if (!["appointment", "order", "walkin"].includes(type))
      return res.status(400).json({ message: "Invalid type" });
    let state = await QueueState.findOne({ type });
    if (!state) state = await QueueState.create({ type, currentServing: 0 });
    const totalIssued = await getTodayTokenCount(type);
    res.json({ type, currentServing: state.currentServing, totalIssued, nextToken: totalIssued + 1, lastUpdated: state.lastUpdated });
  } catch (err) {
    res.status(500).json({ message: "Error fetching queue status" });
  }
});

app.get("/queue", async (req, res) => {
  try {
    const types  = ["appointment", "order", "walkin"];
    const result = {};
    await Promise.all(types.map(async (type) => {
      let state = await QueueState.findOne({ type });
      if (!state) state = { currentServing: 0, lastUpdated: new Date() };
      const totalIssued = await getTodayTokenCount(type);
      const serving     = state.currentServing || 0;
      const prefix      = type === "appointment" ? "APT" : type === "walkin" ? "WLK" : "ORD";
      const next        = [];
      for (let i = serving + 1; i <= Math.min(serving + 5, totalIssued); i++) {
        next.push({ number: i, tokenStr: `${prefix}-${String(i).padStart(3, "0")}` });
      }
      result[type] = {
        current:     serving > 0 ? { number: serving, tokenStr: `${prefix}-${String(serving).padStart(3, "0")}` } : null,
        next,
        totalIssued,
        lastUpdated: state.lastUpdated,
      };
    }));
    res.json(result);
  } catch (err) {
    console.error("[Queue Display]", err);
    res.status(500).json({ message: "Error fetching queue" });
  }
});

// ── Protected with display key so patient data isn't fully public ─────────────
app.get("/appointments/today", async (req, res) => {
  try {
    const displayKey = req.headers["x-display-key"];
    const cookieAuth = req.cookies.token;

    // Allow if: valid display key OR logged in user
    if (!cookieAuth && displayKey !== process.env.DISPLAY_KEY) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const today = getTodayIST();
    const apts  = await Appointment.find({
      tokenDate: today,
      status: { $ne: "Cancelled" },
    })
      .sort({ tokenNumber: 1 })
      .select("name tokenStr tokenNumber tokenDate status contact bookedAt source");
    res.json(apts);
  } catch (err) {
    res.status(500).json({ message: "Error fetching today queue" });
  }
});

app.get("/queue/today", authenticateToken, async (req, res) => {
  try {
    const start     = new Date(); start.setHours(0, 0, 0, 0);
    const end       = new Date(); end.setHours(23, 59, 59, 999);
    const todayApts = await Appointment.find({
      bookedAt: { $gte: start, $lte: end },
      status: { $ne: "Cancelled" },
    }).sort({ tokenNumber: 1 });
    const serving = todayApts.find(a => a.status === "Confirmed") || todayApts.find(a => a.status === "Pending");
    const waiting = todayApts.filter(a => a !== serving && (a.status === "Pending" || a.status === "Confirmed"));
    res.json({
      date: getTodayIST(),
      total: todayApts.length,
      done: todayApts.filter(a => a.status === "Completed").length,
      waiting: waiting.length,
      serving: serving || null,
      queue: waiting.slice(0, 10),
      allTokens: todayApts,
    });
  } catch (err) {
    res.status(500).json({ message: "Error fetching queue" });
  }
});

app.post("/queue/next", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const type = req.body.type || "appointment";
    if (!["appointment", "order", "walkin"].includes(type))
      return res.status(400).json({ message: "Invalid type" });
    const today = getTodayIST();
    if (type === "appointment") {
      const serving = await Appointment.findOne({
        tokenDate: today,
        status: { $in: ["Confirmed", "Pending"] },
      }).sort({ tokenNumber: 1 });
      if (serving) {
        serving.status = "Completed";
        await serving.save();
        logActivity(req, "queue_next",
          `Auto-completed ${serving.tokenStr} for ${serving.name}`,
          { type, tokenStr: serving.tokenStr, patientName: serving.name, appointmentId: serving._id }
        );
      } else {
        logActivity(req, "queue_next", `Advanced ${type} queue (no active appointment)`, { type });
      }
    } else {
      logActivity(req, "queue_next", `Advanced ${type} queue`, { type });
    }
    const totalIssued = await getTodayTokenCount(type);
    const state = await QueueState.findOneAndUpdate(
      { type },
      { $inc: { currentServing: 1 }, $set: { lastUpdated: new Date() } },
      { upsert: true, new: true }
    );
    if (state.currentServing > totalIssued && totalIssued > 0) {
      await QueueState.updateOne({ type }, { $set: { currentServing: totalIssued } });
      state.currentServing = totalIssued;
    }
      emit("queue:update", { type, currentServing: state.currentServing, totalIssued, lastUpdated: state.lastUpdated });
    res.json({ message: `Now serving ${type} #${state.currentServing}`, type, currentServing: state.currentServing, totalIssued, lastUpdated: state.lastUpdated });
  } catch (err) {
    console.error("[Queue] next error:", err);
    res.status(500).json({ message: "Error advancing queue" });
  }
});

app.post("/queue/reset", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const type = req.body.type || "appointment";
    if (!["appointment", "order", "walkin"].includes(type))
      return res.status(400).json({ message: "Invalid type" });
    await QueueState.findOneAndUpdate(
      { type },
      { $set: { currentServing: 0, lastUpdated: new Date() } },
      { upsert: true, new: true }
    );
    io.emit("queue:update", { type, currentServing: 0, totalIssued: 0, lastUpdated: new Date() });
    logActivity(req, "queue_reset", `Reset ${type} queue to 0`, { type });
    res.json({ message: `${type} queue reset to 0` });
  } catch (err) {
    res.status(500).json({ message: "Error resetting queue" });
  }
});

// ─── ACTIVITY LOGS ────────────────────────────────────────────────────────────
app.get("/activity-logs", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page)   || 1);
    const limit    = Math.min(100, parseInt(req.query.limit) || 50);
    const action   = req.query.action   || "";
    const userId   = req.query.userId   || "";
    const dateFrom = req.query.dateFrom || "";
    const dateTo   = req.query.dateTo   || "";
    const query = {};
    if (action)  query.action = action;
    if (userId)  query.userId = userId;
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo)   query.createdAt.$lte = new Date(dateTo + "T23:59:59.999Z");
    }
    const [logs, total] = await Promise.all([
      ActivityLog.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ActivityLog.countDocuments(query),
    ]);
    res.json({ logs, total, page, pages: Math.ceil(total / limit), limit });
  } catch (err) {
    console.error("[ActivityLog] fetch:", err);
    res.status(500).json({ message: "Error fetching logs" });
  }
});

app.get("/activity-logs/summary", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const [todayCount, totalCount, recentLogs, actionBreakdown] = await Promise.all([
      ActivityLog.countDocuments({ createdAt: { $gte: since } }),
      ActivityLog.countDocuments({}),
      ActivityLog.find({}).sort({ createdAt: -1 }).limit(5).lean(),
      ActivityLog.aggregate([
        { $group: { _id: "$action", count: { $sum: 1 } } },
        { $sort:  { count: -1 } },
        { $limit: 8 },
      ]),
    ]);
    res.json({ todayCount, totalCount, recentLogs, actionBreakdown });
  } catch (err) {
    res.status(500).json({ message: "Error fetching summary" });
  }
});

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────
app.post("/register", registerLimiter, async (req, res) => {
  const { name, email, phone, password, role } = req.body;
  try {
    if (!name || !email || !password)
      return res.status(400).json({ message: "Name, email and password are required" });
    const existing = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (existing) return res.status(400).json({ message: "Email already registered" });
    const safeRole = ["admin", "staff", "reception"].includes(role) ? "user" : (role || "user");
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      name: name.trim(),
      email: String(email).toLowerCase().trim(),
      phone: phone || "",
      password: hashedPassword,
      role: safeRole,
    });
    await user.save();
    if (phone) {
      await Order.updateMany(
        { orderType: "walk-in", "guestInfo.phone": String(phone).trim(), userId: null },
        { $set: { userId: user._id } }
      );
    }
    ActivityLog.create({
      userId: user._id, userName: user.name, userRole: user.role, userEmail: user.email,
      action: "user_created",
      description: `New patient self-registered: ${user.name} (${user.email})`,
      meta: { selfRegistered: true },
      ip: req.headers["x-forwarded-for"] || req.ip || "",
    }).catch(() => {});
    res.json({
      message: "User created successfully",
      user: { _id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role },
    });
  } catch (err) {
    console.error("[Register]", err);
    res.status(400).json({ message: "Error creating user" });
  }
});

app.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  try {
    if (!email || !password)
      return res.status(400).json({ message: "Email and password are required" });
    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ message: "Invalid credentials" });
    if (user.isDisabled)
      return res.status(403).json({ message: "Account is disabled. Contact admin." });
    const token = jwt.sign(
      { id: user._id, role: user.role, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.cookie("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "None",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    ActivityLog.create({
      userId: user._id, userName: user.name, userRole: user.role, userEmail: user.email,
      action: "login",
      description: `${user.name} (${user.role}) logged in`,
      meta: {},
      ip: req.headers["x-forwarded-for"] || req.ip || "",
    }).catch(() => {});
    res.json({
      message: "Login successful",
      role: user.role,
      name: user.name,
      email: user.email,
      phone: user.phone,
      userId: user._id,
    });
  } catch (err) {
    console.error("[Login]", err);
    res.status(500).json({ message: "Error logging in" });
  }
});

app.post("/logout", (req, res) => {
  try {
    const token = req.cookies.token;
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded) {
        ActivityLog.create({
          userId: decoded.id, userName: decoded.name || decoded.email,
          userRole: decoded.role, userEmail: decoded.email,
          action: "logout",
          description: `${decoded.name || decoded.email} logged out`,
          meta: {},
          ip: req.ip || "",
        }).catch(() => {});
      }
    }
  } catch { /* silent */ }
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
    res.status(500).json({ message: "Failed to reset password" });
  }
});

// ─── USER MANAGEMENT ──────────────────────────────────────────────────────────
app.get("/users", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.json(users || []);
  } catch (err) {
    res.status(500).json({ message: "Error fetching users" });
  }
});

app.get("/users/search", authenticateToken, requireStaff, async (req, res) => {
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

app.post("/users/create", authenticateToken, requireAdmin, async (req, res) => {
  const { name, email, phone, password, role } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ message: "Name, email and password are required" });
  const allowedRoles = ["admin", "staff", "reception", "user"];
  if (role && !allowedRoles.includes(role))
    return res.status(400).json({ message: "Invalid role" });
  try {
    const existing = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (existing) return res.status(400).json({ message: "Email already exists" });
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({
      name: name.trim(),
      email: String(email).toLowerCase().trim(),
      phone: phone || "",
      password: hashed,
      role: role || "user",
    });
    await user.save();
    logActivity(req, "user_created",
      `Admin created user: ${user.name} (${user.email}) as ${user.role}`,
      { targetUserId: user._id, role: user.role }
    );
    res.status(201).json({
      message: "User created successfully",
      user: { _id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role, createdAt: user.createdAt },
    });
  } catch (err) {
    console.error("[Users] create:", err);
    res.status(500).json({ message: "Error creating user" });
  }
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
      if (password.length < 6)
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      update.password = await bcrypt.hash(password, 10);
    }
    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    logActivity(req, "user_updated",
      `Updated user: ${user.name} (${user.email})`,
      { targetUserId: req.params.id, changes: Object.keys(update).filter(k => k !== "password") }
    );
    res.json({ message: "User updated", user });
  } catch (err) {
    res.status(500).json({ message: "Error updating user" });
  }
});

app.patch("/users/:id/role", authenticateToken, requireAdmin, async (req, res) => {
  const { role } = req.body;
  if (!["admin", "staff", "reception", "user"].includes(role))
    return res.status(400).json({ message: "Invalid role" });
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    logActivity(req, "user_updated", `Changed role of ${user.name} to ${role}`, { targetUserId: req.params.id, newRole: role });
    res.json({ message: "Role updated", user });
  } catch (err) {
    res.status(500).json({ message: "Error updating role" });
  }
});

app.patch("/users/:id/disable", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (String(user._id) === String(req.user.id))
      return res.status(400).json({ message: "Cannot disable your own account" });
    user.isDisabled = !user.isDisabled;
    await user.save();
    logActivity(req, user.isDisabled ? "user_disabled" : "user_enabled",
      `${user.isDisabled ? "Disabled" : "Enabled"} account for ${user.name}`,
      { targetUserId: req.params.id }
    );
    res.json({
      message: user.isDisabled ? "User disabled" : "User enabled",
      user: { _id: user._id, name: user.name, isDisabled: user.isDisabled },
    });
  } catch (err) {
    res.status(500).json({ message: "Error toggling user status" });
  }
});

app.delete("/users/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (String(req.params.id) === String(req.user.id))
      return res.status(400).json({ message: "Cannot delete your own account" });
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    logActivity(req, "user_deleted",
      `Deleted user: ${user.name} (${user.email})`,
      { deletedUserId: req.params.id, deletedEmail: user.email }
    );
    res.json({ message: "User deleted permanently" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting user" });
  }
});

// PATCH /profile — user updates their own profile
app.patch("/profile", authenticateToken, async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    const update = {};
    if (name)  update.name  = name.trim();
    if (email) update.email = String(email).toLowerCase().trim();
    if (phone) update.phone = phone;
    if (password) {
      if (password.length < 6)
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      update.password = await bcrypt.hash(password, 10);
    }
    const user = await User.findByIdAndUpdate(
      req.user.id,
      update,
      { new: true }
    ).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "Profile updated", user });
  } catch (err) {
    res.status(500).json({ message: "Error updating profile" });
  }
});

// ─── APPOINTMENTS ─────────────────────────────────────────────────────────────
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
      status:      isReception ? "Confirmed" : "Pending",
      tokenNumber: token,
      tokenStr,
      tokenDate:   date,
      bookedAt:    req.body.bookedAt ? new Date(req.body.bookedAt) : new Date(),
    });
    await apt.save();
    ActivityLog.create({
      userId:    req.body.userId || null,
      userName:  apt.name,
      userRole:  isReception ? "reception" : "patient",
      userEmail: apt.email || "",
      action:    "appointment_booked",
      description: `Appointment booked: ${apt.name} | Token: ${tokenStr} | Source: ${apt.source} | Status: ${apt.status}`,
      meta: { tokenStr, status: apt.status, source: apt.source, appointmentId: apt._id },
      ip: req.headers["x-forwarded-for"] || req.ip || "",
    }).catch(() => {});
    res.json({ message: "Appointment booked successfully!", tokenNumber: token, tokenStr, tokenDate: date, status: apt.status });
  } catch (err) {
    console.error("Appointment error:", err);
    res.status(500).json({ message: "Error saving appointment" });
  }
});

app.get("/appointments", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const apts = await Appointment.find().sort({ bookedAt: -1 }).populate("userId", "name email phone");
    res.json(apts);
  } catch (err) {
    res.status(500).json({ message: "Error fetching appointments" });
  }
});

app.get("/appointments/my", authenticateToken, async (req, res) => {
  try {
    const userId    = req.user.id;
    const user      = await User.findById(userId).select("phone");
    const userPhone = user?.phone ? String(user.phone).trim() : null;
    const query     = {
      $or: [
        { userId: new mongoose.Types.ObjectId(userId) },
        ...(userPhone ? [{ contact: userPhone }] : []),
      ],
    };
    const apts = await Appointment.find(query).sort({ bookedAt: -1 });
    res.json(apts);
  } catch (err) {
    res.status(500).json({ message: "Error fetching appointments" });
  }
});

app.patch("/appointments/:id/status", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!["Pending", "Confirmed", "Completed", "Cancelled"].includes(status))
      return res.status(400).json({ message: "Invalid status" });
    const apt = await Appointment.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!apt) return res.status(404).json({ message: "Appointment not found" });
    logActivity(req, "appointment_status_changed",
      `Changed appointment status for ${apt.name} → ${status}`,
      { appointmentId: req.params.id, newStatus: status, patientName: apt.name, tokenStr: apt.tokenStr }
    );
    res.json({ message: "Status updated", appointment: apt });
  } catch (err) {
    res.status(500).json({ message: "Error updating appointment status" });
  }
});

app.delete("/appointments/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const apt = await Appointment.findByIdAndDelete(req.params.id);
    if (!apt) return res.status(404).json({ message: "Appointment not found" });
    logActivity(req, "appointment_deleted",
      `Deleted appointment for ${apt.name} (${apt.tokenStr})`,
      { appointmentId: req.params.id }
    );
    res.json({ message: "Appointment deleted" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting appointment" });
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
  logActivity(req, "notice_published",
    `Published notice: "${message.slice(0, 60)}${message.length > 60 ? "..." : ""}"`,
    { expiresAt }
  );
  res.json({ message: "Notice updated" });
});

app.delete("/notice", authenticateToken, requireAdmin, async (req, res) => {
  await Notice.deleteMany({});
  logActivity(req, "notice_deleted", "Deleted active notice", {});
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

app.get("/medicines/all", authenticateToken, requireStaff, async (req, res) => {
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
    res.status(500).json({ message: "Error fetching low stock" });
  }
});

app.post("/medicines", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, desc, price, category, img, stock, lowStockThreshold, unit, supplier, expiryDate, entryDate } = req.body;
    if (!name || !price) return res.status(400).json({ message: "Name and price are required" });
    const medicine = new Medicine({
      name: name.trim(), desc: desc || "", price: Number(price),
      category: category || "General", img: img || "",
      stock: Number(stock) || 100, lowStockThreshold: Number(lowStockThreshold) || 10,
      unit: unit || "units", supplier: supplier || "",
      expiryDate: expiryDate || "", entryDate: entryDate || "",
      isActive: true,
    });
    await medicine.save();
    logActivity(req, "medicine_added",
      `Added medicine: ${medicine.name} | Price: Rs.${medicine.price} | Stock: ${medicine.stock}`,
      { medicineId: medicine._id, name: medicine.name }
    );
    res.status(201).json({ message: "Medicine added successfully", medicine });
  } catch (err) {
    res.status(500).json({ message: "Error adding medicine" });
  }
});

app.put("/medicines/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, desc, price, category, img, stock, lowStockThreshold, unit, isActive, supplier, expiryDate, entryDate } = req.body;
    const medicine = await Medicine.findByIdAndUpdate(req.params.id, {
      ...(name  && { name: name.trim() }),
      ...(desc  !== undefined && { desc }),
      ...(price && { price: Number(price) }),
      ...(category && { category }),
      ...(img   !== undefined && { img }),
      ...(stock !== undefined && { stock: Number(stock) }),
      ...(lowStockThreshold !== undefined && { lowStockThreshold: Number(lowStockThreshold) }),
      ...(unit  && { unit }),
      ...(isActive !== undefined && { isActive }),
      ...(supplier !== undefined && { supplier }),
      ...(expiryDate !== undefined && { expiryDate }),
      ...(entryDate  !== undefined && { entryDate }),
      updatedAt: new Date(),
    }, { new: true });
    if (!medicine) return res.status(404).json({ message: "Medicine not found" });
    logActivity(req, "medicine_updated",
      `Updated medicine: ${medicine.name}`,
      { medicineId: req.params.id, changes: Object.keys(req.body) }
    );
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
    const oldStock = medicine.stock;
    if (operation === "add")           medicine.stock = medicine.stock + Number(stock);
    else if (operation === "subtract") medicine.stock = Math.max(0, medicine.stock - Number(stock));
    else                               medicine.stock = Number(stock);
    medicine.updatedAt = new Date();
    await medicine.save();
    logActivity(req, "medicine_stock_updated",
      `Stock updated for ${medicine.name}: ${oldStock} → ${medicine.stock}`,
      { medicineId: req.params.id, name: medicine.name, operation, amount: stock, oldStock, newStock: medicine.stock }
    );
    res.json({ message: "Stock updated", medicine });
  } catch (err) {
    res.status(500).json({ message: "Error updating stock" });
  }
});

app.delete("/medicines/:id/permanent", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const medicine = await Medicine.findByIdAndDelete(req.params.id);
    if (!medicine) return res.status(404).json({ message: "Medicine not found" });
    logActivity(req, "medicine_deleted",
      `Permanently deleted medicine: ${medicine.name}`,
      { medicineId: req.params.id, name: medicine.name, permanent: true }
    );
    res.json({ message: "Medicine permanently deleted" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting medicine" });
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
    logActivity(req, "medicine_deleted",
      `Soft-deleted (hidden) medicine: ${medicine.name}`,
      { medicineId: req.params.id, softDelete: true }
    );
    res.json({ message: "Medicine removed from store" });
  } catch (err) {
    res.status(500).json({ message: "Error removing medicine" });
  }
});

// ─── ORDERS ───────────────────────────────────────────────────────────────────
app.post("/orders", authenticateToken, async (req, res) => {
  try {
    const { items, total, paymentMethod } = req.body;
    if (!items || !items.length || !total)
      return res.status(400).json({ message: "Missing items or total" });
    const { token, tokenStr, date } = await getNextToken("order");
    const order = new Order({
      userId: req.user.id, orderType: "online",
      items, total: Number(total),
      paymentMethod: paymentMethod || "cash",
      status: "Pending", tokenNumber: token, tokenStr, tokenDate: date,
    });
    await order.save();
    for (const item of items) {
      await Medicine.findOneAndUpdate(
        { name: item.name, isActive: true },
        { $inc: { stock: -(item.quantity || 1) } }
      );
    }
    await order.populate("userId", "name email phone");
    logActivity(req, "order_created",
      `Online order by ${req.user.email} | Token: ${tokenStr} | Total: Rs.${total}`,
      { orderId: order._id, tokenStr, total, itemCount: items.length }
    );
    res.status(201).json({ message: "Order placed successfully", order });
    sendOrderEmails({ order, userEmail: req.user.email, items, total, paymentMethod, tokenStr });
  } catch (err) {
    console.error("Order error:", err);
    res.status(500).json({ message: "Error saving order. Please try again." });
  }
});

app.post("/orders/walk-in", authenticateToken, requireStaff, async (req, res) => { // ✅ FIX: staff can create walk-in orders
  try {
    const { items, total, paymentMethod, guestName, guestPhone, existingUserId } = req.body;
    if (!items || !items.length || !total)
      return res.status(400).json({ message: "Missing items or total" });
    if (!guestName && !existingUserId)
      return res.status(400).json({ message: "Customer name is required" });
    const { token, tokenStr, date } = await getNextToken("walkin");
    let userId = null;
    let guestInfo = { name: "", phone: "" };
    if (existingUserId) {
      userId = existingUserId;
    } else {
      if (guestPhone) {
        const u = await User.findOne({ phone: String(guestPhone).trim() });
        if (u) userId = u._id;
      }
      guestInfo = { name: guestName || "", phone: guestPhone || "" };
    }
    const order = new Order({
      userId, guestInfo, orderType: "walk-in",
      items, total: Number(total),
      paymentMethod: paymentMethod || "cash",
      status: "Completed", tokenNumber: token, tokenStr, tokenDate: date,
    });
    await order.save();
    for (const item of items) {
      await Medicine.findOneAndUpdate(
        { name: item.name, isActive: true },
        { $inc: { stock: -(item.quantity || 1) } }
      );
    }
    if (userId) await order.populate("userId", "name email phone");
    logActivity(req, "walkin_order_created",
      `Walk-in order for ${guestName || "linked user"} | Token: ${tokenStr} | Rs.${total}`,
      { orderId: order._id, tokenStr, total, customer: guestName }
    );
    res.status(201).json({ message: "Walk-in order created successfully", order });
  } catch (err) {
    console.error("Walk-in error:", err);
    res.status(500).json({ message: "Error creating walk-in order" });
  }
});

app.get("/orders", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const orders = await Order.find().populate("userId", "name email phone").sort({ createdAt: -1 });
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
    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true }).populate("userId", "name email phone");
    if (!order) return res.status(404).json({ message: "Order not found" });
    logActivity(req, "order_status_changed",
      `Order #${order._id.toString().slice(-6).toUpperCase()} → ${status}`,
      { orderId: req.params.id, newStatus: status }
    );
    res.json({ message: "Status updated successfully", order });
  } catch (err) {
    res.status(500).json({ message: "Error updating order status" });
  }
});

app.get("/staff/orders", authenticateToken, requireStaff, async (req, res) => {
  try {
    const orders = await Order.find().populate("userId", "name email phone").sort({ createdAt: -1 }).limit(200);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: "Error fetching orders" });
  }
});

app.patch("/staff/orders/:id/status", authenticateToken, requireStaff, async (req, res) => {
  try {
    const { status } = req.body;
    if (!["Approved", "Completed"].includes(status))
      return res.status(403).json({ message: "Staff can only set Approved or Completed" });
    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true }).populate("userId", "name email phone");
    if (!order) return res.status(404).json({ message: "Order not found" });
    logActivity(req, "order_status_changed",
      `Staff ${req.user.email} changed order #${order._id.toString().slice(-6).toUpperCase()} → ${status}`,
      { orderId: req.params.id, newStatus: status, changedBy: req.user.email }
    );
    res.json({ message: "Status updated", order });
  } catch (err) {
    res.status(500).json({ message: "Error updating order status" });
  }
});

// ─── ANALYTICS ────────────────────────────────────────────────────────────────
app.get("/analytics/sales", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const now        = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    const weekStart  = new Date(now); weekStart.setDate(now.getDate() - 6); weekStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const allOrders  = await Order.find({ status: { $nin: ["Cancelled"] } }).sort({ createdAt: 1 });

    const statsFor = (orders, from, to) => {
      const f = orders.filter(o => { const d = new Date(o.createdAt); return d >= from && d <= to; });
      return {
        orders: f.length,
        revenue: f.reduce((s, o) => s + Number(o.total || 0), 0),
        onlineOrders: f.filter(o => o.orderType !== "walk-in").length,
        walkinOrders: f.filter(o => o.orderType === "walk-in").length,
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
      const from = new Date(day); from.setHours(0, 0, 0, 0);
      const to   = new Date(day); to.setHours(23, 59, 59, 999);
      const s    = statsFor(allOrders, from, to);
      dailyChart.push({
        date: day.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
        revenue: s.revenue,
        orders:  s.orders,
      });
    }

    const [aptTokens, orderTokens, walkinTokens] = await Promise.all([
      getTodayTokenCount("appointment"),
      getTodayTokenCount("order"),
      getTodayTokenCount("walkin"),
    ]);

    const todayOrders = allOrders.filter(o =>
      new Date(o.createdAt) >= todayStart && new Date(o.createdAt) <= todayEnd
    );

    res.json({
      today:        { ...statsFor(allOrders, todayStart, todayEnd), topMedicines: topMedsFrom(todayOrders) },
      week:         { ...statsFor(allOrders, weekStart, todayEnd) },
      month:        { ...statsFor(allOrders, monthStart, todayEnd) },
      allTime:      { orders: allOrders.length, revenue: allOrders.reduce((s, o) => s + Number(o.total || 0), 0) },
      dailyChart,
      topMedicines: topMedsFrom(allOrders, 10),
      todayTokens:  { appointments: aptTokens, onlineOrders: orderTokens, walkInOrders: walkinTokens },
    });
  } catch (err) {
    console.error("Analytics error:", err);
    res.status(500).json({ message: "Error computing analytics" });
  }
});

app.get("/protected", authenticateToken, (req, res) =>
  res.json({ message: "Protected route working", user: req.user })
);

// ─── START SERVER ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));