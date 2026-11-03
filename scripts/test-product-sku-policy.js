const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const policy = require("../src/modules/product/services/sku-policy");
const { AppError } = require("../src/shared/errors/app-error");

const collision = (sku) => Object.assign(new Error("duplicate"), {
  code: 11000,
  keyPattern: { sellerId: 1, "variants.skuNormalized": 1 },
  keyValue: { "variants.skuNormalized": sku.toLowerCase() },
});

async function run() {
  const generated = Array.from({ length: 2000 }, policy.generateSku);
  assert.equal(new Set(generated).size, generated.length);
  assert.ok(generated.every((sku) => /^[A-Z0-9][A-Z0-9._/-]{1,62}[A-Z0-9]$/.test(sku)));
  const variant = policy.assignGeneratedSku({ isDefault: true });
  const original = variant.sku;
  const payload = { sku: original, variants: [variant, { sku: "MANUAL-123" }] };
  let calls = 0;
  await policy.saveWithSkuRetry(payload, async () => {
    if (++calls === 1) throw collision(original);
    return payload;
  });
  assert.equal(calls, 2);
  assert.notEqual(variant.sku, original);
  assert.equal(payload.sku, variant.sku);
  assert.equal(variant.skuNormalized, variant.sku.toLowerCase());
  assert.equal(payload.variants[1].sku, "MANUAL-123");
  assert.equal(JSON.stringify(variant).includes("automaticallyGeneratedSku"), false);
  await assert.rejects(policy.saveWithSkuRetry(payload, async () => { throw collision("MANUAL-123"); }), /SKU is already used/);
  const unrelated = Object.assign(new Error("slug conflict"), { code: 11000, keyPattern: { slug: 1 } });
  await assert.rejects(policy.saveWithSkuRetry(payload, async () => { throw unrelated; }), (error) => error === unrelated);
  calls = 0;
  await assert.rejects(policy.saveWithSkuRetry(payload, async () => {
    calls += 1;
    throw collision(variant.sku);
  }), /Could not allocate/);
  assert.equal(calls, 5, "collision retries must be bounded");

  const saved = new Set();
  const simultaneous = [0, 1].map(() => ({ variants: [
    { ...policy.assignGeneratedSku({}), sku: "SKU-SAME", skuNormalized: "sku-same" },
  ] }));
  await Promise.all(simultaneous.map((candidate) => policy.saveWithSkuRetry(candidate, async () => {
    const key = candidate.variants[0].sku.toLowerCase();
    if (saved.has(key)) throw collision(key);
    saved.add(key);
    return candidate;
  })));
  assert.equal(saved.size, 2, "simultaneous requests recover from a database uniqueness conflict");

  // Exercise the real normalization and edit-preservation methods without databases.
  const source = fs.readFileSync(require.resolve("../src/modules/product/services/product.service"), "utf8");
  const names = ["hasPayloadValue", "toVariantNumber", "toPlainVariant", "syncRootAndDefaultVariant", "validateProductSkusAndImages"];
  const methods = names.map((name) => {
    const start = source.indexOf(`  ${name === "validateProductSkusAndImages" ? "async " : ""}${name}(`);
    const next = source.slice(start + 5).search(/\n  (?:async )?[A-Za-z_]+\(/);
    return source.slice(start, next < 0 ? source.length : start + 5 + next);
  }).join("\n");
  const context = { ...policy, AppError, normalizeHttpUrl: (value) => value,
    escapeRegExp: (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") };
  vm.runInNewContext(`class Probe { ${methods} } moduleProbe = new Probe();`, context);
  const service = context.moduleProbe;
  service.normalizeVariantAttributes = (value) => value;
  const created = service.syncRootAndDefaultVariant({ variants: [{ sku: "", price: 10, mrp: 10, stock: 1 }] });
  assert.ok(created.variants[0][policy.AUTO_SKU]);
  assert.equal(created.sku, created.variants[0].sku);
  const edited = service.syncRootAndDefaultVariant({ variants: [
    { _id: "existing", sku: "CHANGED", price: 20 }, { sku: null, price: 30 },
  ] }, { variants: [{ _id: "existing", sku: "SAVED-SKU", price: 10 }] });
  assert.equal(edited.variants[0].sku, "SAVED-SKU");
  assert.ok(edited.variants[1][policy.AUTO_SKU]);
  const manual = service.syncRootAndDefaultVariant({ variants: [{ sku: "MANUAL-ABC", price: 10 }] });
  assert.equal(manual.variants[0].sku, "MANUAL-ABC");
  assert.equal(manual.variants[0][policy.AUTO_SKU], undefined);
  service.normalizeImageUrl = (value) => value;
  const candidate = { variants: [policy.assignGeneratedSku({ images: ["https://example.com/image.png"] })] };
  const firstSku = candidate.variants[0].sku;
  let checks = 0;
  service.productRepository = { findOne: async (filter) => {
    assert.equal(filter.sellerId, "seller-a", "preflight uniqueness is scoped to the seller");
    return checks++ === 0 ? { _id: "conflict" } : null;
  } };
  await service.validateProductSkusAndImages(candidate, "seller-a");
  assert.notEqual(candidate.variants[0].sku, firstSku);
  service.productRepository.findOne = async () => ({ _id: "conflict" });
  await assert.rejects(service.validateProductSkusAndImages({ variants: [
    { sku: "MANUAL-123", images: ["https://example.com/image.png"] },
  ] }, "seller-a"), /already used/);

  // Validation accepts automatic input but still rejects malformed manual input.
  const { createProductSchema } = require("../src/modules/product/validation/product.validation");
  const variantSchema = createProductSchema.extract("body.variants").$_terms.items[0];
  const skuSchema = variantSchema.extract("sku");
  for (const sku of [undefined, null, "", "  ", "MANUAL-ABC"]) assert.equal(skuSchema.validate(sku).error, undefined);
  for (const sku of ["ab", "bad sku", "-BAD", "x".repeat(65)]) assert.ok(skuSchema.validate(sku).error);
  console.log("Product SKU generation, collision retries, manual validation and edit preservation checks passed.");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
