const { connectMongo, mongoose } = require("../../src/infrastructure/mongo/mongo-client");

async function migrateOptionalUserEmail() {
  await connectMongo();
  const users = mongoose.connection.collection("users");
  const indexes = await users.indexes();
  const emailIndexes = indexes.filter(
    (index) => index.key && Object.keys(index.key).length === 1 && index.key.email === 1,
  );

  const desiredIndex = emailIndexes.find(
    (index) => index.unique === true && index.sparse === true,
  );

  if (!desiredIndex) {
    for (const index of emailIndexes) {
      await users.dropIndex(index.name);
    }
    await users.createIndex(
      { email: 1 },
      { unique: true, sparse: true, name: "user_email_unique" },
    );
  }

  // Old mobile-only records used an empty string. Missing values are the
  // canonical representation and are ignored by the sparse unique index.
  const result = await users.updateMany(
    { email: "" },
    { $unset: { email: "" }, $set: { emailVerified: false } },
  );

  console.log(
    `Optional user email migration complete; normalized ${result.modifiedCount} user(s).`,
  );
}

migrateOptionalUserEmail()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
