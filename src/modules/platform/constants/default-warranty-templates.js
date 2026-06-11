"use strict";

const SEED_SOURCE = "seed-warranty-templates";

const WARRANTY_TEMPLATES = [
  {
    period: "No Warranty",
    type: "none",
    durationValue: 0,
    durationUnit: "months",
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
    period: "12 Months",
    type: "limited",
    durationValue: 12,
    durationUnit: "months",
    durationMonths: 12,
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
];

function buildWarrantyTemplateSeedDocuments() {
  return WARRANTY_TEMPLATES.map(({ period, ...metadata }, index) => ({
    period,
    active: true,
    metadata: {
      ...metadata,
      sortOrder: index + 1,
      source: SEED_SOURCE,
    },
  }));
}

module.exports = {
  SEED_SOURCE,
  WARRANTY_TEMPLATES,
  buildWarrantyTemplateSeedDocuments,
};
