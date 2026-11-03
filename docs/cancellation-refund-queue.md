Cancellation refund approval queue
===================================

Admin refund approval now atomically records `refund_status=pending` and
`metadata.refundSubmissionState=queued` in PostgreSQL and returns immediately.
No Razorpay request runs in that HTTP approval request. This durable database
queue does not depend on Redis or introduce a new table.

The cron worker's `cancellation-refund-submission` job runs every five seconds,
claims up to 25 queued rows atomically and processes them. Enable and run the
existing cron worker in deployment. Multiple workers cannot claim the same row.
Queued rows survive restarts. Cancellation refunds already submitted to the
provider remain covered by webhooks and five-minute reconciliation.

UI details refresh every five seconds while the current page contains pending
refunds, show queue/provider status and references, and display approval,
submission and refund-status transitions with timestamps and failure details.

An interrupted submission older than 15 minutes, or a submission exception,
requires provider verification. It is not automatically resubmitted: a payment
provider may have accepted the transfer before a timeout or server crash.
Reapproval and generic retry are blocked while that outcome is uncertain.
Verify the existing provider refund and reconcile it before any new transfer.
The provider reference is saved before downstream finance processing.

This queue handles explicit admin cancellation-refund approval. Return refunds
retain their existing attempt timeline and sync workflow; this change does not
move return refund submissions into the cancellation queue.

Check: `node scripts/test-cancellation-refund-queue.js`.
