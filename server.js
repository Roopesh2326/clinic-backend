const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const fs = require("fs");

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

  fs.writeFileSync(filePath, JSON,stringify(appointments, null, 2));

  res.json({ message: "Appointment saved successfully" });
});

app.get("/appointments", (req, res) => {
  res.json(appointments);
});

app.listen(5000, () => {
  console.log("Server running on port 5000");
});