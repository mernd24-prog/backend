#!/usr/bin/env node

const { knex } = require("../../src/infrastructure/postgres/postgres-client");
const { CommissionService } = require("../../src/modules/seller/services/commission.service");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const orderIdArg = args.find((arg) => arg.startsWith("--order-id="));
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const orderId = orderIdArg ? orderIdArg.slice("--order-id=".length) : null;
const limit = Math.max(1, Math.min(Number(limitArg?.slice("--limit=".length) || 500), 10000));

async function main() {
  const query = knex("orders as o")
    .distinct("o.id", "o.created_at")
    .join("order_items as oi", "oi.order_id", "o.id")
    .whereNotNull("oi.seller_id")
    .whereNotIn("o.status", ["pending_payment", "payment_failed"])
    .orderBy("o.created_at", "desc")
    .limit(limit);
  if (orderId) query.where("o.id", orderId);

  const orders = await query;
  const incomplete = [];
  for (const order of orders) {
    const audit = await CommissionService.auditCommissionCompleteness(order.id);
    if (audit.complete) continue;
    if (!apply) {
      incomplete.push({ ...audit, mode: "dry_run" });
      continue;
    }
    incomplete.push(await CommissionService.repairCommissionCompleteness(order.id, {
      userId: "commission-repair-script",
      role: "system",
    }));
  }

  process.stdout.write(`${JSON.stringify({
    mode: apply ? "apply" : "dry_run",
    scanned: orders.length,
    incomplete: incomplete.length,
    results: incomplete,
  }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => knex.destroy());
