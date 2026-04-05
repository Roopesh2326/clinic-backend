const mongoose = require("mongoose");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cookieParser = require("cookie-parser");

const Notice = require("./models/Notice");
const User = require("./models/User");

const app = express();

// ✅ FIXED CORS (important)
app.use(cors({
  origin: ["https://clinic-frontend-rho.vercel.app"],
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

// ✅ GET USERS
app.get("/users", async (req, res) => {
  try {
    const users = await User.find();

    if (!users) {
      return res.json([]);
    }
    res.json(users);
  } catch (err) {
    console.log("ERROR IN USERS:", err);
    res.status(500).json({ message: "Error fetching users" });
  }
});

// 📁 LOCAL FILE STORAGE
const filePath = "appointments.json";

let appointments = [];

if (fs.existsSync(filePath)) {
  const data = fs.readFileSync(filePath);
  appointments = JSON.parse(data);
}

// ✅ REGISTER
app.post("/register", async (req, res) => {
  const { name, email, phone, password, role } = req.body;

  try {
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

// ✅ LOGIN
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
      { expiresIn: "1h" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: false, // ⚠️ change to true in production (HTTPS)
    });

    res.json({
      message: "Login successful",
      role: user.role
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

// ✅ PROTECTED TEST
app.get("/protected", authenticateToken, (req, res) => {
  res.json({ message: "Protected route working", user: req.user });
});

// ✅ APPOINTMENT
app.post("/appointment", (req, res) => {
  const data = req.body;
  appointments.push(data);

  fs.writeFileSync(filePath, JSON.stringify(appointments, null, 2));

  res.json({ message: "Appointment saved successfully" });
});

app.get("/appointments", authenticateToken, requireAdmin, (req, res) => {
  res.json(appointments);
});

// ✅ GET NOTICE
app.get("/notice", async (req, res) => {
  const notice = await Notice.findOne();
  res.json(notice);
});

// ✅ UPDATE NOTICE
app.post("/notice", async (req, res) => {
  const { message } = req.body;

  let notice = await Notice.findOne();

  if (notice) {
    notice.message = message;
    await notice.save();
  } else {
    notice = new Notice({ message });
    await notice.save();
  }

  res.json({ message: "Notice updated" });
});

// ✅ START SERVER
app.listen(5000, () => {
  console.log("Server running on port 5000 🚀");
});