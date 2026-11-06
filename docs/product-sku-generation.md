Product SKU generation
======================

SKUs are case-insensitively unique per seller, across that seller's products
and within each product. Different sellers may use the same manual SKU.

For create and update requests, omit a new variant's `sku`, or send an empty
string/null, to request automatic generation. The server assigns a
`SKU-` prefix plus a cryptographic UUID, and returns the saved SKU in the
product response. Manual SKUs still use the existing 3–64 character validation
and return HTTP 409 on a seller-level conflict.

Existing variants keep their saved SKUs when matched by `_id`, including when
an edit submits a blank or changed SKU. A duplicated/new variant must omit
`_id`; the UI's duplicate action clears both its identity and SKU. Whole-product
copies receive new variant identities and SKUs. A manually supplied copy SKU
applies to its default variant.

The `unique_seller_variant_sku_normalized` MongoDB index is the final guard
against concurrent saves. Automatic collisions retry at most five save
attempts; manual conflicts and unrelated duplicate-key errors are never
silently regenerated. No SKUs on existing persisted products are rewritten.

Deployment must retain the existing unique index on
`{ sellerId: 1, "variants.skuNormalized": 1 }`. Historical rows missing
`skuNormalized` need a separate data audit/backfill before claiming full
uniqueness coverage for legacy data. This change does not run a live database
migration or rewrite historical order/inventory SKU references.

Verification:

    node scripts/check-source.js
