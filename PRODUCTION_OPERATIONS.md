# Production operations runbook

## Release gate

1. Run `npm ci`, `npm run check`, and `npm test` in CI. A missing test suite is a failure.
2. Restore and run the tracked regression tests before any deployment.
3. Back up PostgreSQL and MongoDB, then run `npm run db:migrate` exactly once as a release job.
4. Deploy with rolling replacement. Route traffic only after `/ready` returns HTTP 200; use `/live` for liveness.
5. Verify payment webhook delivery, outbox backlog, queue failures, and payment reconciliation after deployment.

Do not use `db:reset` or reset-style seed commands in staging or production. Roll back the application first when a migration is not safely reversible. Prefer a forward corrective migration after data has been written in the new format.

## Required production controls

- Store secrets in the deployment platform's secret manager. Rotate every credential that has ever appeared in Git history.
- Use different, random JWT access and refresh secrets. Configure an explicit CORS allowlist.
- Require TLS at the load balancer and databases. Limit database and Redis network access to application infrastructure.
- Use Cloudinary/object storage; local uploads are intentionally disabled and not served in production.
- Run one scheduler leader logically. Database advisory locks prevent duplicate execution across application instances.
- Keep Razorpay webhooks enabled. Alerts must fire for failed signatures, provider-pending payments/refunds, and reconciliation failures.

## Backups and recovery

- PostgreSQL: daily snapshot plus point-in-time recovery/WAL retention; quarterly restore drill.
- MongoDB: daily snapshots plus oplog/PITR when supported; quarterly restore drill.
- Object storage: versioning and deletion protection for customer and tax documents.
- Redis: it is not the financial system of record, but enable managed persistence because it carries rate limits and job state.
- Record recovery time and recovery point objectives with the infrastructure owner. Test recovery in an isolated environment, including payment reconciliation before reopening checkout.

## Minimum alerts

- `/ready` unavailable for 2 minutes, HTTP 5xx above 2%, or p95 latency above the agreed API SLO.
- PostgreSQL pool saturation, slow queries, MongoDB connection exhaustion, or Redis unavailable.
- Queue/outbox oldest pending age above 5 minutes, dead-letter events, or repeated cron failures.
- Razorpay webhook failure, payment success/order-pending mismatch, refund failure, or payout reconciliation mismatch.
- Disk above 80%, memory above 85%, restart loops, and event-loop lag.

## Incident handling

For an uncertain payment, never ask the customer to pay again until the provider payment and order are reconciled. Disable shipment actions for every order whose payment is not captured/authorized under its configured payment method. For an uncertain refund, retain `provider_pending`, reconcile by webhook/job, and use the same idempotency key for an administrative retry.
