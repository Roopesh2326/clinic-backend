const mongoose = require("mongoose");

const NoticeSchema = new mongoose.Schema({
    message: String,
});

module.exports = mongoose.model("Notice", NoticeSchema);