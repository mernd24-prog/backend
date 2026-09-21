#!/usr/bin/env node

const { connectMongo, mongoose } = require("../../src/infrastructure/mongo/mongo-client");
const {
  CategoryTreeModel,
} = require("../../src/modules/platform/models/category-tree.model");
const {
  HsnCodeModel,
} = require("../../src/modules/platform/models/hsn-code.model");
const { forget } = require("../../src/shared/tools/cache");
const { redis } = require("../../src/infrastructure/redis/redis-client");

const LEGACY_APPROVAL_FILTER = {
  $and: [
    {
      $or: [
        { approvalStatus: { $exists: false } },
        { approvalStatus: null },
        { approvalStatus: "" },
      ],
    },
    {
      $or: [
        { submittedBySellerId: { $exists: false } },
        { submittedBySellerId: null },
        { submittedBySellerId: "" },
      ],
    },
  ],
};

async function backfillCatalogMasterApproval() {
  try {
    await connectMongo();

    const reviewedAt = new Date();
    const update = {
      $set: {
        approvalStatus: "approved",
        reviewedBy: "catalog-approval-backfill",
        reviewedAt,
      },
    };

    const [categories, hsnCodes] = await Promise.all([
      CategoryTreeModel.updateMany(LEGACY_APPROVAL_FILTER, update),
      HsnCodeModel.updateMany(LEGACY_APPROVAL_FILTER, update),
    ]);

    await Promise.all([
      forget(/^products:prefill:/),
      forget(/^catalog:/),
    ]);

    console.log(
      JSON.stringify(
        {
          categoriesApproved: categories.modifiedCount || 0,
          hsnCodesApproved: hsnCodes.modifiedCount || 0,
        },
        null,
        2,
      ),
    );
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    redis.disconnect();
  }
}

backfillCatalogMasterApproval().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
