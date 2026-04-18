const mongoose = require("mongoose");

const NoticeSchema = new mongoose.Schema({
    message: String,
    expiresAt: { type: Date, default: null },
});

module.exports = mongoose.model("Notice", NoticeSchema);