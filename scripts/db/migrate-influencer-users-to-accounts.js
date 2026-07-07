"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const { connectMongo, mongoose } = require("../../src/infrastructure/mongo/mongo-client");
const { hashText } = require("../../src/shared/tools/hash");
const { UserModel } = require("../../src/modules/user/models/user.model");
const {
  InfluencerAccountModel,
  InfluencerProfileModel,
  InfluencerCodeModel,
} = require("../../src/modules/referral/models/referral.model");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const detachUserLink = args.has("--detach-user-link");

function getRecordId(value = {}) {
  return String(value._id || value.id || "");
}

async function ensureSparseIndexes() {
  const collection = InfluencerProfileModel.collection;
  const indexes = await collection.indexes().catch(() => []);
  const userIdIndex = indexes.find((index) => index.name === "userId_1");
  if (userIdIndex && userIdIndex.unique && !userIdIndex.sparse) {
    if (dryRun) {
      console.log("[dry-run] Would recreate influencerprofiles.userId_1 as unique sparse");
    } else {
      await collection.dropIndex("userId_1");
      await collection.createIndex({ userId: 1 }, { unique: true, sparse: true });
      console.log("Recreated influencerprofiles.userId_1 as unique sparse");
    }
  }
  if (!indexes.some((index) => index.name === "accountId_1")) {
    if (dryRun) {
      console.log("[dry-run] Would create influencerprofiles.accountId_1 unique sparse index");
    } else {
      await collection.createIndex({ accountId: 1 }, { unique: true, sparse: true });
      console.log("Created influencerprofiles.accountId_1 unique sparse index");
    }
  }
}

async function migrate() {
  await connectMongo();
  await ensureSparseIndexes();

  const profiles = await InfluencerProfileModel.find({
    accountId: { $in: [null, undefined] },
    userId: { $nin: [null, ""] },
  });

  let created = 0;
  let linked = 0;
  let detached = 0;
  let skipped = 0;

  for (const profile of profiles) {
    const user = await UserModel.findById(profile.userId);
    if (!user?.email) {
      skipped += 1;
      console.log(`Skipped profile ${getRecordId(profile)}: linked user missing or has no email`);
      continue;
    }

    let account = await InfluencerAccountModel.findOne({ email: user.email.toLowerCase() });
    if (!account) {
      created += 1;
      const passwordHash = user.passwordHash || await hashText(`Influencer@${getRecordId(profile).slice(-8)}1`);
      if (dryRun) {
        console.log(`[dry-run] Would create influencer account for ${user.email}`);
        account = { _id: `dry-run-${getRecordId(profile)}` };
      } else {
        account = await InfluencerAccountModel.create({
          email: user.email,
          phone: user.phone || null,
          passwordHash,
          profile: user.profile || {},
          accountStatus: user.accountStatus || "active",
          emailVerified: Boolean(user.emailVerified),
          tokenVersion: Number(user.tokenVersion || 0),
          sessionVersion: Number(user.sessionVersion || 0),
          permissionVersion: Number(user.permissionVersion || 0),
          passwordChangedAt: user.passwordChangedAt || null,
          createdBy: profile.createdBy || null,
          metadata: {
            migratedFromUserId: getRecordId(user),
            migratedAt: new Date().toISOString(),
          },
        });
      }
    }

    const accountId = getRecordId(account);
    linked += 1;
    if (dryRun) {
      console.log(`[dry-run] Would link profile ${getRecordId(profile)} to account ${accountId}`);
    } else {
      await InfluencerProfileModel.findByIdAndUpdate(profile._id, {
        $set: { accountId },
        ...(detachUserLink ? { $unset: { userId: "" } } : {}),
      });
      await InfluencerCodeModel.updateMany(
        { influencerId: getRecordId(profile) },
        {
          $set: { accountId },
          ...(detachUserLink ? { $unset: { userId: "" } } : {}),
        },
      );
    }
    if (detachUserLink) detached += 1;
  }

  console.log(JSON.stringify({ dryRun, detachUserLink, created, linked, detached, skipped }, null, 2));
}

migrate()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
