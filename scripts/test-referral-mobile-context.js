const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { coinOrderContext } = require("../src/modules/referral/utils/coin-order-context");

// Run the service with database boundaries stubbed, without connecting to live stores.
const orders = [
  { id: "delivered", status: "delivered", payment_status: "captured", return_eligible_until: "2099-11-10T00:00:00Z" },
  { id: "cancelled", status: "cancelled", payment_status: "refunded" },
  { id: "disputed", status: "delivered", payment_status: "captured" },
];
const returns = [{ orderId: "disputed", status: "qc_failed", qcReview: { status: "customer_disputed" } }];
const sqlCalls = [];
const knex = () => ({ whereIn: (field, ids) => ({ select: async () => {
  sqlCalls.push(ids);
  return orders.filter((order) => ids.includes(order.id));
} }) });
const ReturnModel = { find: () => ({ select: () => ({ sort: () => ({ lean: async () => returns }) }) }) };
const sandbox = { module: { exports: {} }, require: (name) => {
  if (name.endsWith("coin-order-context")) return { coinOrderContext };
  if (name.endsWith("postgres-client")) return { knex };
  if (name.endsWith("return.model")) return { ReturnModel };
  return {};
} };
vm.runInNewContext(fs.readFileSync(require.resolve("../src/modules/referral/services/referral.service"), "utf8"), sandbox);
const { ReferralService } = sandbox.module.exports;
const service = new ReferralService({ referralRepository: {}, walletService: {} });

async function run() {
  const rows = await service.enrichCoinOrderContext([
    { orderId: "delivered", status: "locked", orderStatus: "confirmed" },
    { orderId: "cancelled", status: "pending" },
    { orderId: "disputed", status: "pending" },
    { source: "withdrawal", status: "paid" },
  ]);
  assert.equal(sqlCalls.length, 1, "order context is fetched in one batch");
  assert.equal(rows[0].orderStatus, "delivered");
  assert.equal(rows[0].coinStatus, "locked");
  assert.equal(rows[0].lockReason, "return_window_open");
  assert.equal(rows[0].expectedReleaseDate, orders[0].return_eligible_until);
  assert.equal(rows[1].lockReason, "awaiting_reversal");
  assert.equal(rows[2].lockReason, "return_dispute_open");
  assert.equal(rows[2].expectedReleaseDate, null);
  assert.equal(rows[3].orderStatus, undefined, "withdrawals have no invented order context");
  const chartRows = [
    { orderId: "delivered", orderStatus: "confirmed", referralStatus: "pending", value: 1, amount: 750 },
    { orderId: "cancelled", orderStatus: "confirmed", referralStatus: "pending", value: 1, amount: 1400 },
  ];
  const chart = await service.summarizeLiveOrderStatuses(chartRows);
  assert.equal(chart.find((row) => row.status === "delivered").amount, 750);
  assert.equal(chart.find((row) => row.status === "cancelled").value, 1);
  assert.equal(service.groupOrderStatusRows(chartRows, "referralStatus")[0].value, 2);

  service.getMyInfluencerProfileOrThrow = async () => ({ _id: "partner", influencerType: "child" });
  service.assertInfluencerOperational = () => {};
  service.releaseMaturedInfluencerCoins = async () => {};
  service.getMinimumWithdrawalCoins = async () => 50;
  service.getBonusProgressReport = async () => ({ items: [] });
  service.listMyReferralOrders = async () => ({ items: rows });
  service.listMyInfluencerCodes = async () => ({ items: [] });
  service.referralRepository = {
    ensureWallet: async () => ({ pendingBalance: 30 }),
    aggregateReferralPerformance: async () => ({ orderCount: 2, orderValue: 2150 }),
    aggregateLedgerTotalsByInfluencer: async () => ({ total: 30 }),
    aggregatePayoutTotalsByInfluencer: async () => ({ total: 0 }),
    aggregateLedgerByDay: async () => [],
    aggregateOrderStatusByInfluencer: async () => chartRows,
  };
  const dashboard = await service.getInfluencerDashboard();
  assert.equal(dashboard.charts.orderStatus.find((row) => row.status === "delivered").value, 1);
  assert.equal(dashboard.charts.referralOrderStatus[0].status, "pending");
  assert.equal(dashboard.recentOrders[0].expectedReleaseDate, orders[0].return_eligible_until);
  assert.equal(dashboard.summaryCards.totalLockedCoins, 30);

  // Analytics must expose both chart meanings without dropping contextual orders.
  service.getMyInfluencerProfileOrThrow = async () => ({ influencerType: "child" });
  service.assertInfluencerOperational = () => {};
  service.getInfluencerDashboard = async () => ({
    charts: { orderStatus: chart, referralOrderStatus: [{ status: "pending", value: 2 }] },
    recentOrders: rows,
  });
  const analytics = await service.getMyInfluencerAnalytics();
  assert.equal(analytics.orderStatus, chart);
  assert.equal(analytics.referralOrderStatus[0].status, "pending");
  assert.equal(analytics.recentOrders[0].lockReason, "return_window_open");
  const ledger = service.formatMobileLedgerEntry({ status: "pending", amount: 10, orderId: "delivered" });
  assert.equal(ledger.status, "pending");
  assert.equal(ledger.coinStatus, "locked");
  service.getMyInfluencerProfileOrThrow = async () => ({ _id: "parent", canCreateChildren: true });
  service.referralRepository.getInfluencerProfileById = async () => ({ _id: "child", parentInfluencerId: "parent" });
  service.enrichInfluencer = async (child) => ({ ...child, wallet: {}, primaryCode: { code: "CHILD" } });
  service.referralRepository.listReferralOrders = async () => ({ items: [
    { orderId: "delivered", status: "pending", eligibleAmount: 750 },
  ] });
  service.referralRepository.listMobileCoinLedger = async () => ({ items: [
    { orderId: "delivered", status: "pending", amount: 10 },
  ] });
  service.referralRepository.aggregateLedgerByOrderForInfluencer = async () => new Map([
    ["delivered", { statuses: ["pending"] }],
  ]);
  const child = await service.getMyChildInfluencerDetail({}, "child");
  assert.equal(child.recentOrders[0].status, "pending", "legacy child status stays compatible");
  assert.equal(child.recentOrders[0].referralOrderStatus, "pending");
  assert.equal(child.recentOrders[0].coinStatus, "locked");
  assert.equal(child.recentOrders[0].lockReason, "return_window_open");
  assert.equal(child.recentCoinActivity[0].lockReason, "return_window_open");
  console.log("MLM live order context, chart, analytics and ledger checks passed.");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
