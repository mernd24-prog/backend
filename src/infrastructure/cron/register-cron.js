const { env } = require("../../config/env");
const { logger } = require("../../shared/logger/logger");
const { outboxProcessor } = require("../events/outbox-processor");
const { ProductService } = require("../../modules/product/services/product.service");
const { CommissionService } = require("../../modules/seller/services/commission.service");

function runPeriodicJob(name, callback, intervalMs) {
  let running = false;
  setInterval(async () => {
    if (running) {
      logger.warn({ job: name }, "Cron job skipped because previous run is still active");
      return;
    }

    running = true;
    try {
      await callback();
      logger.info({ job: name }, "Cron job completed");
    } catch (error) {
      logger.error({ err: error, job: name }, "Cron job failed");
    } finally {
      running = false;
    }
  }, intervalMs);
}

function registerCronJobs() {
  if (!env.enableCron) {
    return;
  }

  const productService = new ProductService();

  runPeriodicJob("order-cleanup", async () => {}, 10 * 60 * 1000);
  runPeriodicJob("payment-retries", async () => {}, 5 * 60 * 1000);
  runPeriodicJob("analytics-aggregation", async () => {}, 30 * 60 * 1000);
  runPeriodicJob("product-scheduled-publish", async () => {
    await productService.publishScheduledProducts();
  }, 60 * 1000);
  runPeriodicJob("seller-payout-scheduler", async () => {
    await CommissionService.processScheduledPayouts();
  }, 6 * 60 * 60 * 1000);
  runPeriodicJob("outbox-flush", async () => outboxProcessor.flushPending(), 15 * 1000);
}

module.exports = { registerCronJobs };
