# Notification operations

Broadcast creation returns HTTP 202 and a campaign ID. Expansion reads 200 users per batch; when bulk backlog reaches 2,000 it waits. Bulk workers process two jobs concurrently with a queue-wide ceiling of five starts per second. Transactional mail keeps its separate queue. The campaign's `expanded` status means recipient preparation finished, not that messages were delivered.

GET /notifications/campaigns/:campaignId returns preparation status, recipient status totals and up to 50 failures. POST /notifications/campaigns/:campaignId/retry retries failed recipients and resumes failed preparation. Both require notification management permission.

Email sends have a persistent send-start marker. A timeout/crash after this marker produces `delivery_unknown`, excluded from automatic and manual failed-only retries. Check provider logs before deciding whether to resend. This intentionally favours avoiding duplicates over automatic recovery of ambiguous SMTP outcomes. Provider acceptance is not inbox delivery. Signed delivered/bounced callbacks require choosing the provider and its webhook contract; no unauthenticated callback is exposed.

Welcome mail and intermediate payout updates are suppressed. Final payout statuses remain. Low-stock messages with product/variant/SKU identity use one dedupe key per UTC calendar day. Queue dedupe lasts only as long as retained jobs; Mongo notification records have permanent unique keys. Refund events consolidate only when a shared refund reference exists; distinct partial refunds must never merge by order ID alone.

Docker Compose Redis now uses AOF every-second persistence, a persistent volume, and noeviction. Existing production Redis outside Compose must be configured separately. AOF everysec can still lose the latest second after a host failure. Do not deploy a new Redis volume over existing queue data without checking the current persistence location.

Validation:
- node scripts/test-notification-policy.js
- node scripts/test-notification-campaigns.js

The latter exercises 10,000 synthetic recipients through the real expansion method with mocked storage/queue and validates bounded batches. It is not a Redis/Mongo/SMTP load or process-crash test. Before production, run a staging campaign with test recipients, verify worker restart recovery, Mongo unique indexes, Redis persistence and memory, provider rate limits, and actual SMTP accepted/rejected responses. DLT mapping and approved OTP template IDs remain external configuration tasks. No real user messages are sent by these scripts.
