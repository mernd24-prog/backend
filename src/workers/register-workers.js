const { logger } = require("../shared/logger/logger");
const { createWorker } = require("../shared/queues/queue-factory");
const { sendMail } = require("../infrastructure/mail/mailer");
const { notificationMailService } = require("../modules/notification/services/notification-mail.service");
const { env } = require("../config/env");
const { TaxService } = require("../modules/tax/services/tax.service");
const { NotificationQueueModel } = require("../modules/notification/models/notification-preference.model");

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
          await sendMail({
            to: job.data.email,
            subject: "Welcome to ecommerce",
            html: "<p>Your account is ready. Start shopping or selling.</p>",
          });
        }
        if (job.name === "templated-email") {
          return notificationMailService.sendTemplatedMail(job.data);
        }
        if (job.name === "direct-email") {
          return sendMail(job.data);
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
  logger.info({ mailQueue: env.smtp.queue }, "BullMQ workers registered");
}

module.exports = { registerWorkers, workers };
