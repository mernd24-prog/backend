#!/usr/bin/env node

const { knex } = require("../../src/infrastructure/postgres/postgres-client");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const orderIdArg = args.find((arg) => arg.startsWith("--order-id="));
const orderId = orderIdArg ? orderIdArg.slice("--order-id=".length) : null;

const money = (value) => Number(Number(value || 0).toFixed(2));
const parseJson = (value) => {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

async function main() {
  if (!orderId) throw new Error("--order-id is required");

  const results = await knex.transaction(async (trx) => {
    const rows = await trx("seller_commissions")
      .where("order_id", orderId)
      .whereNot("status", "paid")
      .where((query) => query.where("net_amount", "<", 0).orWhereRaw("refund_amount > amount"))
      .forUpdate();

    const repaired = [];
    for (const row of rows) {
      const metadata = parseJson(row.metadata);
      const recordedCustomerRefund = money(
        Object.values(metadata.appliedRefunds || {}).reduce(
          (total, amount) => total + Number(amount || 0),
          0,
        ) || metadata.lastRefundAdjustment?.customerRefundAmount ||
        metadata.lastRefundAdjustment?.refundAmount || row.refund_amount,
      );
      const originalUnpaidPayable = money(Math.max(
        Number(row.net_amount || 0) + Number(row.refund_amount || 0),
        0,
      ));
      const correctedLiability = money(Math.min(recordedCustomerRefund, originalUnpaidPayable));
      const correctedNet = money(Math.max(originalUnpaidPayable - correctedLiability, 0));
      const correctedStatus = correctedNet === 0 && correctedLiability > 0 ? "refunded" : row.status;

      const result = {
        id: row.id,
        orderItemId: row.order_item_id,
        before: {
          refundAmount: money(row.refund_amount),
          netAmount: money(row.net_amount),
          status: row.status,
        },
        after: {
          refundAmount: correctedLiability,
          netAmount: correctedNet,
          status: correctedStatus,
        },
      };

      if (apply) {
        await trx("seller_commissions").where("id", row.id).update({
          refund_amount: correctedLiability,
          net_amount: correctedNet,
          status: correctedStatus,
          hold_reason: null,
          metadata: JSON.stringify({
            ...metadata,
            balanceRepair: {
              reason: "legacy_refund_over_deduction",
              previousRefundAmount: money(row.refund_amount),
              previousNetAmount: money(row.net_amount),
              repairedAt: new Date().toISOString(),
              repairedBy: "repair-refund-commission-balances",
            },
          }),
          updated_at: trx.fn.now(),
        });
        if (row.order_item_id && correctedStatus === "refunded") {
          await trx("order_items").where("id", row.order_item_id).update({
            payout_status: "refunded",
            payout_hold_reason: null,
          });
        }
      }
      repaired.push(result);
    }
    return repaired;
  });

  process.stdout.write(`${JSON.stringify({
    mode: apply ? "apply" : "dry_run",
    orderId,
    repaired: results.length,
    results,
  }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => knex.destroy());
