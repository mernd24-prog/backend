const { logger } = require("../shared/logger/logger");
const { createWorker } = require("../shared/queues/queue-factory");
const { sendMail } = require("../infrastructure/mail/mailer");
const { notificationMailService } = require("../modules/notification/services/notification-mail.service");
const { renderEmailTemplate } = require("../modules/notification/services/email-template-catalog");
const { env } = require("../config/env");
const { TaxService } = require("../modules/tax/services/tax.service");
const { NotificationQueueModel } = require("../modules/notification/models/notification-preference.model");
const { StockNotificationRepository } = require("../modules/stock-notification/repositories/stock-notification.repository");

let registered = false;
let workers = [];

function registerWorkers() {
  if (registered) {
    return;
  }

  registered = true;
  workers = [
    createWorker(
      "notifications",
      async (job) => {
        if (job.name === "welcome-email") {
          const template = renderEmailTemplate({
            templateKey: "account_welcome",
            recipientType: "customer",
            payload: { email: job.data.email, action: "account_created" },
          });
          await sendMail({
            to: job.data.email,
            subject: template.subject,
            text: template.text,
            html: template.html,
          });
        }
        if (job.name === "templated-email") {
          return notificationMailService.sendTemplatedMail(job.data);
        }
        if (job.name === "direct-email") {
          return sendMail(job.data);
        }
        if (job.name === "stock-notification-email") {
          const repository = new StockNotificationRepository();
          try {
            const result = await sendMail(job.data);
            if (job.data.notificationId) {
              await repository.markNotified(job.data.notificationId);
            }
            return result;
          } catch (error) {
            if (job.data.notificationId) {
              await repository.markFailed(job.data.notificationId, error.message);
            }
            throw error;
          }
        }
        if (job.name === "tax-document-email") {
          const queueItem = await NotificationQueueModel.findById(job.data.dispatchId);
          if (!queueItem) return null;
          return new TaxService().sendQueuedTaxDocument(queueItem, job.data.rendered || {});
        }
        return null;
      },
      {
        concurrency: env.smtp.queue.concurrency,
        limiter: {
          max: env.smtp.queue.maxPerInterval,
          duration: env.smtp.queue.intervalMs,
        },
      },
    ),
  ];
  workers.forEach((worker) => {
    worker.on("error", (error) => {
      logger.error({ err: error, queue: worker.name }, "BullMQ worker error");
    });
    worker.on("failed", (job, error) => {
      logger.error(
        { err: error, queue: worker.name, jobId: job?.id, jobName: job?.name },
        "BullMQ job failed",
      );
    });
  });
  logger.info({ mailQueue: env.smtp.queue }, "BullMQ workers registered");
}

async function closeWorkers() {
  const activeWorkers = [...workers];
  workers = [];
  registered = false;
  await Promise.allSettled(activeWorkers.map((worker) => worker.close()));
}

module.exports = { registerWorkers, closeWorkers };
