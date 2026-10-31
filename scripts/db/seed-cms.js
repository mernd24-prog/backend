const {
  connectMongo,
  mongoose,
} = require("../../src/infrastructure/mongo/mongo-client");
const {
  ContentPageModel,
} = require("../../src/modules/platform/models/content-page.model");
const { customerCmsFallbackPages } = require("./cms-customer-fallback-pages");

async function seedPolicyPages() {
  try {
    await connectMongo();

    console.log("✅ MongoDB Connected");

 

    let insertedCustomerPages = 0;
    let skippedCustomerPages = 0;
    const updateFooterOnly = process.argv.includes(
      "--update-footerdata",
    );
    const updateCustomerFallbackPages = process.argv.includes(
      "--update-customer-fallback-pages",
    );

    for (const customerPage of customerCmsFallbackPages) {
      if (updateFooterOnly && customerPage.slug !== "footerdata") continue;

      const shouldUpdate = updateCustomerFallbackPages || updateFooterOnly;
      const result = shouldUpdate
        ? await ContentPageModel.findOneAndUpdate(
            { slug: customerPage.slug },
            customerPage,
            { new: true, upsert: true },
          )
        : await ContentPageModel.updateOne(
            { slug: customerPage.slug },
            { $setOnInsert: customerPage },
            { upsert: true },
          );

      if (shouldUpdate) {
        insertedCustomerPages += 1;
        console.log(`✅ ${customerPage.slug} updated from fallback seed`);
      } else if (result.upsertedCount) {
        insertedCustomerPages += 1;
        console.log(`✅ ${customerPage.slug} inserted`);
      } else {
        skippedCustomerPages += 1;
        console.log(`⏭️  ${customerPage.slug} already exists; preserved`);
      }
    }

    console.log(
      updateCustomerFallbackPages || updateFooterOnly
        ? `\nCustomer fallback CMS: ${insertedCustomerPages} updated`
        : `\nCustomer fallback CMS: ${insertedCustomerPages} inserted, ${skippedCustomerPages} preserved`,
    );

    console.log("\n🎉 All Policy Pages Seeded Successfully");

    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

seedPolicyPages();
