#!/usr/bin/env node
"use strict";

const {
  connectMongo,
  mongoose,
} = require("../../src/infrastructure/mongo/mongo-client");
const {
  WarrantyTemplateModel,
} = require("../../src/modules/platform/models/warranty-template.model");

const SEED_SOURCE = "seed-warranty-templates";

const WARRANTY_TEMPLATES = [
  {
    period: "No Warranty",
    type: "none",
    durationValue: 0,
    durationUnit: "none",
    durationMonths: 0,
  },
  {
    period: "7 Days",
    type: "limited",
    durationValue: 7,
    durationUnit: "days",
    durationMonths: 0,
  },
  {
    period: "15 Days",
    type: "limited",
    durationValue: 15,
    durationUnit: "days",
    durationMonths: 0,
  },
  {
    period: "30 Days",
    type: "limited",
    durationValue: 30,
    durationUnit: "days",
    durationMonths: 1,
  },
  {
    period: "3 Months",
    type: "limited",
    durationValue: 3,
    durationUnit: "months",
    durationMonths: 3,
  },
  {
    period: "6 Months",
    type: "limited",
    durationValue: 6,
    durationUnit: "months",
    durationMonths: 6,
  },
  {
    period: "1 Year",
    type: "limited",
    durationValue: 1,
    durationUnit: "years",
    durationMonths: 12,
  },
  {
    period: "2 Years",
    type: "limited",
    durationValue: 2,
    durationUnit: "years",
    durationMonths: 24,
  },
  {
    period: "3 Years",
    type: "limited",
    durationValue: 3,
    durationUnit: "years",
    durationMonths: 36,
  },
  {
    period: "5 Years",
    type: "limited",
    durationValue: 5,
    durationUnit: "years",
    durationMonths: 60,
  },
  {
    period: "Lifetime",
    type: "lifetime",
    durationValue: null,
    durationUnit: "lifetime",
    durationMonths: null,
  },
];

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    dryRun: flags.has("--dry-run"),
    shouldReset: flags.has("--reset") || flags.has("-r"),
  };
}

function buildTemplate(template, index) {
  const { period, ...metadata } = template;
  return {
    period,
    active: true,
    metadata: {
      ...metadata,
      sortOrder: index + 1,
      source: SEED_SOURCE,
    },
  };
}

async function seedWarrantyTemplates({ dryRun = false, shouldReset = false } = {}) {
  const templates = WARRANTY_TEMPLATES.map(buildTemplate);

  if (dryRun) {
    console.log("Warranty templates dry run:");
    templates.forEach((template) => {
      console.log(`- ${template.period}`);
    });
    return { created: 0, updated: 0, unchanged: templates.length, deleted: 0 };
  }

  await connectMongo();

  try {
    let deleted = 0;
    if (shouldReset) {
      const deleteResult = await WarrantyTemplateModel.deleteMany({
        "metadata.source": SEED_SOURCE,
      });
      deleted = deleteResult.deletedCount || 0;
    }

    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const template of templates) {
      const existing = await WarrantyTemplateModel.findOne({
        period: template.period,
      });

      if (!existing) {
        await WarrantyTemplateModel.create(template);
        created += 1;
        continue;
      }

      const existingMetadata =
        existing.metadata && typeof existing.metadata === "object"
          ? existing.metadata
          : {};
      const isSeedManaged = existingMetadata.source === SEED_SOURCE;
      const nextMetadata = isSeedManaged ? template.metadata : existingMetadata;
      const shouldUpdate =
        existing.active !== template.active ||
        JSON.stringify(existingMetadata) !== JSON.stringify(nextMetadata);

      if (!shouldUpdate) {
        unchanged += 1;
        continue;
      }

      existing.active = template.active;
      existing.metadata = nextMetadata;
      await existing.save();
      updated += 1;
    }

    return { created, updated, unchanged, deleted };
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await seedWarrantyTemplates(options);

  console.log("Warranty templates seed complete");
  console.log(`Created: ${result.created}`);
  console.log(`Updated: ${result.updated}`);
  console.log(`Unchanged: ${result.unchanged}`);
  console.log(`Deleted: ${result.deleted}`);
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error("Failed to seed warranty templates");
    console.error(error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = {
  WARRANTY_TEMPLATES,
  seedWarrantyTemplates,
};
