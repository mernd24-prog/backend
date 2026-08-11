"use strict";

const { connectMongo, mongoose } = require("../../src/infrastructure/mongo/mongo-client");
const {
  InfluencerPayoutRequestModel,
  InfluencerWalletModel,
} = require("../../src/modules/referral/models/referral.model");

const shouldApply = process.env.APPLY_REFERRAL_PAYOUT_RESERVATION_BACKFILL === "true";
const activeStatuses = ["pending", "approved", "processing", "failed"];

async function main() {
  await connectMongo();
  const legacy = await InfluencerPayoutRequestModel.find({
    reservationStatus: { $exists: false },
  }).lean();
  const activeByInfluencer = new Map();
  legacy.forEach((payout) => {
    if (!activeStatuses.includes(payout.status)) return;
    const key = String(payout.influencerId);
    activeByInfluencer.set(key, Number(activeByInfluencer.get(key) || 0) + Number(payout.amount || 0));
  });
  console.log(JSON.stringify({
    dryRun: !shouldApply,
    legacyPayouts: legacy.length,
    walletsToReserve: activeByInfluencer.size,
    totalToReserve: Array.from(activeByInfluencer.values()).reduce((sum, amount) => sum + amount, 0),
  }, null, 2));
  if (!shouldApply) return;

  await InfluencerWalletModel.updateMany(
    { reservedBalance: { $exists: false } },
    { $set: { reservedBalance: 0 } },
  );
  for (const [influencerId, amount] of activeByInfluencer) {
    const wallet = await InfluencerWalletModel.findOne({ influencerId });
    if (!wallet || Number(wallet.availableBalance || 0) < amount) {
      throw new Error(`Cannot reserve ${amount} coins for influencer ${influencerId}`);
    }
    await InfluencerWalletModel.updateOne(
      { influencerId, availableBalance: { $gte: amount } },
      { $inc: { availableBalance: -amount, reservedBalance: amount } },
    );
  }
  await InfluencerPayoutRequestModel.updateMany(
    { _id: { $in: legacy.filter((payout) => activeStatuses.includes(payout.status)).map((payout) => payout._id) } },
    { $set: { reservationStatus: "reserved" } },
  );
  await InfluencerPayoutRequestModel.updateMany(
    { _id: { $in: legacy.filter((payout) => payout.status === "paid").map((payout) => payout._id) } },
    { $set: { reservationStatus: "settled" } },
  );
  await InfluencerPayoutRequestModel.updateMany(
    { _id: { $in: legacy.filter((payout) => ["rejected", "cancelled"].includes(payout.status)).map((payout) => payout._id) } },
    { $set: { reservationStatus: "released" } },
  );
  console.log("Referral payout reservation backfill complete.");
}

main()
  .catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
