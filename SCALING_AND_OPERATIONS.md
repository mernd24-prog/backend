# Scaling and operations

The default runtime remains backward compatible: `PROCESS_ROLE=all` starts the
HTTP API, queue workers, cron jobs, realtime subscribers, and domain handlers in
one process.

## Horizontal deployment

For higher traffic, use the same application image with separate roles:

| Deployment | `PROCESS_ROLE` | Suggested replicas | Purpose |
| --- | --- | ---: | --- |
| API | `api` | 2+ | HTTP routes, sockets, and synchronous domain handlers |
| Worker | `worker` | 1+ | BullMQ jobs and asynchronous domain handlers |
| Scheduler | `scheduler` | 1 | Cron reconciliation and outbox flushing |
| Realtime | `realtime` | As needed | Dedicated realtime subscribers |

The scheduler already uses PostgreSQL advisory locks, so overlapping scheduler
instances do not execute the same periodic job concurrently. Keep one scheduler
replica unless failover requires more.

Capabilities can also be disabled explicitly with `ENABLE_WORKERS`,
`ENABLE_CRON`, `ENABLE_REALTIME_SUBSCRIBERS`, and `ENABLE_DOMAIN_HANDLERS`.

## Database connection budgets

Calculate the total connection budget before increasing replicas:

`replicas × (POSTGRES_POOL_MAX + KNEX_POOL_MAX + SEQUELIZE_POOL_MAX)`

Use PgBouncer in transaction-pooling mode for large replica counts. Financial
transactions and advisory locks must continue using the primary database.

MongoDB pool sizing is controlled by `MONGO_MIN_POOL_SIZE` and
`MONGO_MAX_POOL_SIZE`. The total possible Mongo connections are approximately
`replicas × MONGO_MAX_POOL_SIZE`. Start small, observe pool wait time and query
latency, then increase deliberately.

## Cache behavior

The shared cache helper provides:

- Redis caching with a bounded in-process fallback;
- per-process request coalescing so concurrent misses execute one fetch;
- small TTL jitter to reduce simultaneous expiration spikes;
- pattern invalidation across Redis and the in-process cache.

Writes must invalidate all relevant catalog/read-model keys. Prefer domain-event
driven invalidation rather than adding long TTL values.

## Database scaling sequence

Before sharding:

1. Record real p95/p99 query latency and inspect query plans.
2. Add compound indexes matching production filters and sorts.
3. Archive or partition time-growing PostgreSQL tables.
4. Add read replicas for reports and non-critical history reads.
5. Add PgBouncer and validate failover behavior.
6. Shard only after measured primary write/storage limits are reached.

If MongoDB sharding becomes necessary, tenant-owned catalog data should use a
high-cardinality tenant key such as hashed `organizationId` or `sellerId`.
Low-cardinality fields such as status, approval status, or revision status are
not suitable shard keys.

## Required production validation

- Load-test browsing, search, checkout, and flash-sale inventory contention.
- Verify duplicate checkout/payment requests remain idempotent.
- Test Redis, Elasticsearch, MongoDB, and PostgreSQL failure modes.
- Alert on API p95/p99 latency, error rate, database pool saturation, queue age,
  queue failures, outbox dead letters, and search indexing lag.
- Regularly test database backup restoration rather than only backup creation.
