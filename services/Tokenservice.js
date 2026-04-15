const Counter = require("../models/Counter");

/**
 * getTodayDate()
 * Returns today's date as "YYYY-MM-DD" in IST (India Standard Time)
 * Uses IST so tokens reset at midnight India time, not UTC
 */
const getTodayDate = () => {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  }); // returns "YYYY-MM-DD"
};

/**
 * getNextToken(type)
 *
 * Atomically increments the counter for today and returns the next token number.
 *
 * @param {string} type - "appointment" | "order" | "walkin"
 * @returns {Promise<{ token: number, tokenStr: string, date: string }>}
 *
 * HOW IT PREVENTS RACE CONDITIONS:
 * ─────────────────────────────────
 * findOneAndUpdate with $inc is a SINGLE atomic MongoDB operation.
 * MongoDB locks the document during the operation — no two requests
 * can read the same seq value. Even 100 concurrent requests will
 * each get a unique sequential number (1, 2, 3... 100).
 *
 * This is far safer than:
 *   ❌ read seq → increment in JS → write back  (race condition!)
 *   ❌ in-memory counter                         (resets on restart!)
 *   ✅ findOneAndUpdate $inc                     (atomic, production-safe)
 */
const getNextToken = async (type = "appointment") => {
  const date = getTodayDate();
  const key = type + ":" + date;

  // ── THE CORE: atomic findOneAndUpdate ────────────────────────────────────
  // upsert: true  → creates the document if it doesn't exist yet (first booking of the day)
  // new: true     → returns the UPDATED document (with the incremented seq)
  // $inc: {seq:1} → atomically increments seq by 1
  //
  // MongoDB guarantees this entire operation is atomic —
  // no other request can interleave between the read and the write.
  const counter = await Counter.findOneAndUpdate(
    { key },                          // find by key
    {
      $inc: { seq: 1 },               // atomically increment
      $setOnInsert: { date, createdAt: new Date() }, // set only on first insert
    },
    {
      upsert: true,                   // create if doesn't exist
      new: true,                      // return updated document
      setDefaultsOnInsert: true,
    }
  );

  const token = counter.seq;

  // Format: T-001, T-002 ... or APT-001 depending on type
  const prefix = type === "appointment" ? "APT" : type === "walkin" ? "WLK" : "ORD";
  const tokenStr = prefix + "-" + String(token).padStart(3, "0");

  return {
    token,        // raw number: 1, 2, 3 ...
    tokenStr,     // formatted: APT-001, APT-002 ...
    date,         // "2024-04-15"
    key,          // "appointment:2024-04-15"
  };
};

/**
 * getTodayTokenCount(type)
 * Returns how many tokens have been issued today for a given type.
 * Useful for admin dashboard to show "15 appointments today"
 */
const getTodayTokenCount = async (type = "appointment") => {
  const date = getTodayDate();
  const key = type + ":" + date;
  const counter = await Counter.findOne({ key });
  return counter ? counter.seq : 0;
};

/**
 * resetToken(type)
 * Manually reset today's counter back to 0.
 * Normally not needed (auto-resets daily) but useful for testing.
 */
const resetToken = async (type = "appointment") => {
  const date = getTodayDate();
  const key = type + ":" + date;
  await Counter.findOneAndUpdate({ key }, { $set: { seq: 0 } }, { upsert: true });
};

module.exports = {
  getNextToken,
  getTodayTokenCount,
  resetToken,
  getTodayDate,
};