const { connectMongo, mongoose } = require("../src/infrastructure/mongo/mongo-client");
const {
  InfluencerProfileModel,
  InfluencerWalletModel,
  ReferralCommissionLedgerModel,
  ReferralOrderModel,
} = require("../src/modules/referral/models/referral.model");

const APPLY = process.argv.includes("--apply");
const RECONCILIATION_KEY = "growth-partner-code-owner-share-v1";
const WALLET_BUCKET_BY_STATUS = {
  pending: "pendingBalance",
  locked: "pendingBalance",
  available: "availableBalance",
};

const money = (value) => Number(Number(value || 0).toFixed(2));

async function run() {
  await connectMongo();
  const growthPartners = await InfluencerProfileModel.find({
    influencerType: "parent",
  }).select("_id").lean();
  const influencerIds = growthPartners.map((profile) => String(profile._id));
  const entries = await ReferralCommissionLedgerModel.find({
    influencerId: { $in: influencerIds },
    commissionType: "code_owner_base",
    "metadata.roleShareReconciliationKey": { $ne: RECONCILIATION_KEY },
  }).sort({ createdAt: 1 });

  const changes = [];
  for (const entry of entries) {
    const walletBucket = WALLET_BUCKET_BY_STATUS[entry.status];
    if (!walletBucket) {
      throw new Error(
        `Cannot automatically reconcile ledger ${entry.id} with status ${entry.status}`,
      );
    }
    const referralOrder = await ReferralOrderModel.findOne({
      orderId: entry.orderId,
    }).lean();
    const rule = referralOrder?.metadata?.ruleSnapshot || {};
    const pool = Number(
      entry.metadata?.referralPoolAmount ??
        referralOrder?.metadata?.referralPoolAmount ??
        0,
    );
    const percent = Number(rule.parentSharePercent || 0);
    const coinValue = Math.max(
      Number(entry.metadata?.coinValue ?? rule.coinValue ?? 1),
      0.000001,
    );
    const expectedAmount = money((pool * percent) / 100 / coinValue);
    const difference = money(expectedAmount - Number(entry.amount || 0));
    changes.push({
      ledgerId: String(entry._id),
      influencerId: entry.influencerId,
      orderId: entry.orderId,
      status: entry.status,
      walletBucket,
      previousAmount: Number(entry.amount || 0),
      expectedAmount,
      difference,
      pool,
      percent,
      coinValue,
    });
  }

  console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", changes }, null, 2));
  if (!APPLY) return;

  for (const change of changes) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const updateResult = await ReferralCommissionLedgerModel.updateOne(
          {
            _id: change.ledgerId,
            "metadata.roleShareReconciliationKey": { $ne: RECONCILIATION_KEY },
          },
          {
            $set: {
              amount: change.expectedAmount,
              percent: change.percent,
              "metadata.shareAmount": money(change.expectedAmount * change.coinValue),
              "metadata.recipientPartnerType": "growth_partner",
              "metadata.roleShareReconciliationKey": RECONCILIATION_KEY,
              "metadata.roleShareReconciledAt": new Date(),
              "metadata.previousAmount": change.previousAmount,
            },
          },
          { session },
        );
        if (!updateResult.modifiedCount) return;
        if (change.difference !== 0) {
          await InfluencerWalletModel.updateOne(
            { influencerId: change.influencerId },
            { $inc: { [change.walletBucket]: change.difference } },
            { session },
          );
        }
        await ReferralOrderModel.updateOne(
          { orderId: change.orderId },
          {
            $set: {
              "metadata.codeOwnerPartnerType": "growth_partner",
              "metadata.undistributedBrandAssociateAmount": money(
                (change.pool *
                  Number(
                    (await ReferralOrderModel.findOne({ orderId: change.orderId })
                      .session(session)
                      .lean())?.metadata?.ruleSnapshot?.childSharePercent || 0,
                  )) /
                  100,
              ),
            },
          },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
  }
}

run()
  .then(async () => {
    await mongoose.disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
