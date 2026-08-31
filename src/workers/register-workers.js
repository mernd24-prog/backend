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
            subject: "Welcome to Sam Global",
            text: "Welcome to Sam Global. Your account is ready, and you can now continue shopping or selling.",
            html: `<!doctype html>
              <html>
                <body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#111827;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:30px 12px;">
                    <tr>
                      <td align="center">
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #d9dee8;border-radius:8px;overflow:hidden;">
                          <tr>
                            <td style="background:#ffffff;border-top:4px solid #1b1d60;border-bottom:1px solid #eef0f4;padding:22px 28px;">
                              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                  <td style="font-size:18px;font-weight:800;color:#1b1d60;">Sam Global</td>
                                  <td align="right" style="font-size:12px;color:#667085;text-transform:uppercase;letter-spacing:.04em;">Official Notification</td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding:28px;">
                              <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;color:#111827;">Welcome to Sam Global</h1>
                              <p style="margin:0;font-size:15px;line-height:1.7;color:#344054;">Your account is ready, and you can now continue shopping or selling.</p>
                              <p style="margin:26px 0 0;border-top:1px solid #eef0f4;padding-top:16px;font-size:12px;line-height:1.6;color:#667085;">This is an automated account notification from Sam Global.</p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </body>
              </html>`,
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
