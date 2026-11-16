const { SIDEBAR_MODULES } = require("./admin-sidebar-catalog");
const { moduleCode } = require("./rbac-module-policy");

// Read-only UI relationships. Group containers do not create permission modules.
// Embedded features share the page that actually renders their controls.
const embeddedFeatures = {
  "referral-hierarchy": {
    path: "/app/referral-commerce/influencers",
    name: "Referral Partners · Hierarchy",
  },
  "referral-codes": {
    path: "/app/referral-commerce/influencers",
    name: "Referral Partners · Codes",
  },
  "referral-ledger": {
    path: "/app/referral-commerce/influencers",
    name: "Referral Partners · Commissions",
  },
  "referral-bonus-progress": {
    path: "/app/referral-commerce/bonuses",
    name: "Bonuses · Progress",
  },
  "referral-bonus-history": {
    path: "/app/referral-commerce/bonuses",
    name: "Bonuses · History",
  },
};
const definitions = new Map(
  SIDEBAR_MODULES.map((entry) => [entry.moduleSlug, entry]),
);
function modulePresentation(module, role) {
  const code = moduleCode(module);
  const pages = SIDEBAR_MODULES.filter(
    (entry) =>
      entry.routePath &&
      entry.moduleType !== "group" &&
      moduleCode({ ...entry, slug: `sidebar-${entry.moduleSlug}` }) === code &&
      (!role ||
        !entry.allowedRoles?.length ||
        entry.allowedRoles.includes(role)),
  );
  const embedded = embeddedFeatures[code];
  const links = pages.map((entry) => ({
    name: entry.moduleName,
    path: entry.routePath,
  }));
  if (embedded) links.push(embedded);
  const uniqueLinks = [
    ...new Map(
      links.map((link) => [`${link.path}:${link.name}`, link]),
    ).values(),
  ];
  let group = module.metadata?.tab || module.tab || "Other";
  if (pages.length) {
    let parent = definitions.get(pages[0].parentModule);
    const seen = new Set();
    while (parent && !seen.has(parent.moduleSlug)) {
      seen.add(parent.moduleSlug);
      group = parent.moduleName;
      if (parent.moduleSlug === "referral-commerce") break;
      parent = definitions.get(parent.parentModule);
    }
  }
  if (
    embedded ||
    pages.some((page) => page.parentModule === "referral-commerce")
  )
    group = "Referral Commerce / MLM";
  const platform =
    Boolean(embedded) ||
    pages.some(
      (page) =>
        !page.allowedRoles?.length ||
        page.allowedRoles.some((value) =>
          ["super-admin", "admin", "sub-admin"].includes(value),
        ),
    );
  const seller = pages.some((page) =>
    page.allowedRoles?.some((value) =>
      ["seller", "seller-admin", "seller-sub-admin"].includes(value),
    ),
  );
  const panel =
    platform && seller
      ? "both"
      : seller
        ? "seller"
        : platform
          ? "platform"
          : "none";
  return { linked: uniqueLinks.length > 0, group, links: uniqueLinks, panel };
}
module.exports = { modulePresentation };

// Management uses saved navigation records, so source defaults cannot override
// the menu names, links, role restrictions or grouping configured in Admin.
function savedModulePresentation(module, navigation = []) {
  const byKey = new Map(
    navigation.flatMap((entry) =>
      [entry.id, entry.slug, entry.moduleSlug, entry.moduleKey]
        .filter(Boolean)
        .map((key) => [String(key), entry]),
    ),
  );
  const entries = navigation.filter(
    (entry) =>
      entry.configured !== false &&
      entry.moduleType !== "group" &&
      entry.routePath &&
      moduleCode(entry) === moduleCode(module),
  );
  let group = module.metadata?.tab || module.tab || "Other";
  let parent =
    entries[0] &&
    byKey.get(
      String(
        entries[0].parentModuleId || entries[0].metadata?.parentModule || "",
      ),
    );
  if (parent) group = parent.moduleName || parent.name;
  const platform = entries.some((entry) =>
    ["platform", "both"].includes(entry.panel),
  );
  const seller = entries.some((entry) =>
    ["seller", "both"].includes(entry.panel),
  );
  return {
    linked: entries.length > 0,
    group,
    links: entries.map((entry) => ({
      name: entry.moduleName || entry.name,
      path: entry.routePath,
    })),
    panel:
      platform && seller
        ? "both"
        : seller
          ? "seller"
          : platform
            ? "platform"
            : "none",
  };
}
module.exports.savedModulePresentation = savedModulePresentation;
