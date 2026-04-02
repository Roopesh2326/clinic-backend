const mongoose = require("mongoose");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const Notice = require("./models/Notice");


const app = express();

app.use(cors());
app.use(express.json());

//connect database 
mongoose.connect("mongodb+srv://roopeshdeep:<db_password>@cluster0.00b27mo.mongodb.net/?appName=Cluster0")
.then(() => console.log("MongoDB connected"))
.catch((error) => console.log(error));

const filePath = "appointments.json";

//read existing data
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

app.get("/appointments", (req, res) => {
  res.json(appointments);
});

// ✅ GET NOTICE
app.get("/notice", async (req, res) => {
  const notice = await Notice.findOne();
  res.json(notice);
});

app.listen(5000, () => {
  console.log("Server running on port 5000");
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
