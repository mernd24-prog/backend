/**
 * One-time migration: fix ownerAdminId and ownerSellerId for existing records.
 *
 * - Admin users with ownerAdminId = null → set ownerAdminId = own _id
 * - Seller users with ownerSellerId = null → set ownerSellerId = own _id
 *
 * Safe to re-run (idempotent — only updates rows that are still null).
 */

require("dotenv").config();
const mongoose = require("mongoose");
const { env } = require("../../src/config/env");

async function run() {
  await mongoose.connect(env.mongoUri);
  const db = mongoose.connection.db;
  const users = db.collection("users");

  // Fix admins
  const adminResult = await users.updateMany(
    { role: "admin", $or: [{ ownerAdminId: null }, { ownerAdminId: { $exists: false } }] },
    [{ $set: { ownerAdminId: { $toString: "$_id" } } }],
  );
  console.log(`Admin ownerAdminId fixed: ${adminResult.modifiedCount} records`);

  // Fix sellers
  const sellerResult = await users.updateMany(
    { role: "seller", $or: [{ ownerSellerId: null }, { ownerSellerId: { $exists: false } }] },
    [{ $set: { ownerSellerId: { $toString: "$_id" } } }],
  );
  console.log(`Seller ownerSellerId fixed: ${sellerResult.modifiedCount} records`);

  await mongoose.disconnect();
  console.log("Migration complete.");
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
