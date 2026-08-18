const { env } = require("../../config/env");
const { logger } = require("../../shared/logger/logger");
const { outboxProcessor } = require("../events/outbox-processor");
const { ProductService } = require("../../modules/product/services/product.service");
const { CommissionService } = require("../../modules/seller/services/commission.service");
const { settlementLifecycleService } = require("../../modules/seller/services/settlement-lifecycle.service");
const { CancellationService } = require("../../modules/cancellation/services/cancellation.service");
const { OrderService } = require("../../modules/order/services/order.service");
const { knex, postgresPool } = require("../postgres/postgres-client");
const { v4: uuidv4 } = require("uuid");
const os = require("os");

let registered = false;
let timers = [];
let activeRuns = 0;

async function runLockedJob(name, callback) {
  const runId = uuidv4();
  const startedAt = new Date();
  activeRuns += 1;
  // Acquire a dedicated client from the pool so advisory locks belong to a single connection
  const client = await postgresPool.connect();
  // Attach an error listener to the dedicated client so emitted 'error' events
  // don't become uncaught exceptions that crash the process. We'll remove the
  // listener before releasing the client.
  const onClientError = (err) => {
    logger.warn({ err, job: name }, "PostgreSQL client emitted an error during cron job");
  };
  client.on("error", onClientError);
  let acquired = false;
  try {
    const lockResult = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS acquired", [name]);
    acquired = Boolean(lockResult.rows?.[0]?.acquired);
    if (!acquired) {
      return { skipped: true, reason: "already_running" };
    }
    await knex("cron_job_runs").insert({
      id: runId, job_name: name, status: "running", started_at: startedAt,
      instance_id: `${os.hostname()}:${process.pid}`,
    });
    const result = await callback();
    await knex("cron_job_runs").where("id", runId).update({
      status: "completed", completed_at: knex.fn.now(),
      duration_ms: Date.now() - startedAt.getTime(), result: result || {},
    });
    return result;
  } catch (error) {
    await knex("cron_job_runs").insert({
      id: runId, job_name: name, status: "failed", started_at: startedAt,
      completed_at: new Date(), duration_ms: Date.now() - startedAt.getTime(),
      error: String(error.message || error), instance_id: `${os.hostname()}:${process.pid}`,
    }).catch(() => {});
    throw error;
  } finally {
    try {
      if (acquired) {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [name]).catch(() => {});
      }
    } finally {
      try {
        client.removeListener("error", onClientError);
      } catch (e) {}
      client.release();
    }
  }
  activeRuns -= 1;
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
  const orderService = new OrderService();

  runPeriodicJob("order-cleanup", async () =>
    orderService.reconcileExpiredPaymentReservations({ limit: 200 }), 5 * 60 * 1000);
  runPeriodicJob("payment-reconciliation", async () =>
    orderService.reconcilePaidOrderState({ limit: 200 }), 2 * 60 * 1000);
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

async function stopCronJobs() {
  timers.forEach((timer) => clearInterval(timer));
  timers = [];
  registered = false;
  // Wait briefly for any in-progress jobs to complete before returning. This
  // reduces the risk of calling `postgresPool.end()` while a job still holds
  // a client. We'll wait up to 8s, polling for activeRuns to hit zero.
  const waitUntil = Date.now() + 8000;
  while (activeRuns > 0 && Date.now() < waitUntil) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

module.exports = { registerCronJobs, stopCronJobs };
