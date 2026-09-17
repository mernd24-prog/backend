require("dotenv").config();
const mongoose = require("mongoose");

const COLLECTIONS = [
  "categorytrees",
  "platformbrands",
  "hsncodes",
  "platformproductoptions",
  "platformproductoptionvalues",
];

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  for (const collectionName of COLLECTIONS) {
    const result = await mongoose.connection.collection(collectionName).updateMany(
      {
        $or: [
          { approvalStatus: { $exists: false } },
          { approvalStatus: null },
          { approvalStatus: "" },
        ],
      },
      { $set: { approvalStatus: "approved" } },
    );

    console.log(`${collectionName}: approved ${result.modifiedCount} legacy record(s)`);
  }
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
