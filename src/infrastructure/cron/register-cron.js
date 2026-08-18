const { env } = require("../../config/env");
const { logger } = require("../../shared/logger/logger");
const { outboxProcessor } = require("../events/outbox-processor");
const { ProductService } = require("../../modules/product/services/product.service");
const { CommissionService } = require("../../modules/seller/services/commission.service");
const { settlementLifecycleService } = require("../../modules/seller/services/settlement-lifecycle.service");
const { CancellationService } = require("../../modules/cancellation/services/cancellation.service");
const { knex } = require("../postgres/postgres-client");
const { v4: uuidv4 } = require("uuid");
const os = require("os");

let registered = false;
let timers = [];

async function runLockedJob(name, callback) {
  const runId = uuidv4();
  const startedAt = new Date();
  try {
    return await knex.transaction(async (trx) => {
      const lockResult = await trx.raw("SELECT pg_try_advisory_xact_lock(hashtext(?)) AS acquired", [name]);
      const acquired = Boolean(lockResult.rows?.[0]?.acquired);
      if (!acquired) return { skipped: true, reason: "already_running" };
      await trx("cron_job_runs").insert({
        id: runId, job_name: name, status: "running", started_at: startedAt,
        instance_id: `${os.hostname()}:${process.pid}`,
      });
      const result = await callback();
      await trx("cron_job_runs").where("id", runId).update({
        status: "completed", completed_at: trx.fn.now(),
        duration_ms: Date.now() - startedAt.getTime(), result: result || {},
      });
      return result;
    });
  } catch (error) {
    await knex("cron_job_runs").insert({
      id: runId, job_name: name, status: "failed", started_at: startedAt,
      completed_at: new Date(), duration_ms: Date.now() - startedAt.getTime(),
      error: String(error.message || error), instance_id: `${os.hostname()}:${process.pid}`,
    }).catch(() => {});
    throw error;
  }
}

function runPeriodicJob(name, callback, intervalMs) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) {
      logger.warn({ job: name }, "Cron job skipped because previous run is still active");
      return;
    }

    running = true;
    try {
      const result = await runLockedJob(name, callback);
      if (result?.skipped) {
        logger.info({ job: name, reason: result.reason }, "Cron job skipped by database lock");
        return;
      }
      logger.info({ job: name }, "Cron job completed");
    } catch (error) {
      logger.error({ err: error, job: name }, "Cron job failed");
    } finally {
      running = false;
    }
  }, intervalMs);
  timers.push(timer);
  return timer;
}

function registerCronJobs() {
  if (!env.enableCron || registered) {
    return;
  }
  registered = true;

  const productService = new ProductService();
  const cancellationService = new CancellationService();

  runPeriodicJob("order-cleanup", async () => {}, 10 * 60 * 1000);
  runPeriodicJob("payment-retries", async () => {}, 5 * 60 * 1000);
  runPeriodicJob("analytics-aggregation", async () => {}, 30 * 60 * 1000);
  runPeriodicJob("product-scheduled-publish", async () => {
    await productService.publishScheduledProducts();
  }, 60 * 1000);
  runPeriodicJob("seller-payout-scheduler", async () => {
    await CommissionService.processScheduledPayouts();
  }, 6 * 60 * 60 * 1000);
  runPeriodicJob("razorpayx-payout-status-sync", async () => {
    return CommissionService.syncPendingRazorpayXPayouts({
      actor: { userId: "system:razorpayx-payout-sync", role: "system" },
    });
  }, 2 * 60 * 1000);
  runPeriodicJob("return-window-fulfillment", async () => {
    const eligibleItems = await settlementLifecycleService.markEligibleOrderItems();
    const fulfilledOrders = await settlementLifecycleService.finalizeEligibleOrders();
    const autoPayouts = await CommissionService.processScheduledPayouts({
      force: true,
      actor: { userId: "system:return-window", role: "system" },
    });
    return { eligibleItems, fulfilledOrders, autoPayouts };
  }, 15 * 60 * 1000);
  runPeriodicJob("cancellation-refund-reconciliation", async () => {
    return cancellationService.reconcileProviderRefunds({ limit: 100 });
  }, 5 * 60 * 1000);
  runPeriodicJob("rto-financial-reconciliation", async () => {
    return cancellationService.reconcileRtoSettlements({ limit: 100 });
  }, 5 * 60 * 1000);
  runPeriodicJob("outbox-flush", async () => outboxProcessor.flushPending(), 15 * 1000);
}

function stopCronJobs() {
  timers.forEach((timer) => clearInterval(timer));
  timers = [];
  registered = false;
}

module.exports = { registerCronJobs, stopCronJobs };
