const orderTable = {
  name: "orders",
  columns: [
    "id",
    "order_number",
    "buyer_id",
    "status",
    "payment_status",
    "delivery_status",
    "currency",
    "subtotal_amount",
    "discount_amount",
    "tax_amount",
    "total_amount",
    "shipping_fee_amount",
    "shipping_address",
    "metadata",
    "created_by",
    "updated_by",
    "created_at",
  ],
};

const orderItemTable = {
  name: "order_items",
  columns: [
    "id",
    "order_id",
    "product_id",
    "product_title",
    "product_slug",
    "product_sku",
    "product_image",
    "brand",
    "category",
    "hsn_code",
    "gst_rate",
    "variant_id",
    "variant_sku",
    "variant_title",
    "attributes",
    "seller_id",
    "organization_id",
    "store_id",
    "warehouse_id",
    "seller_snapshot",
    "organization_snapshot",
    "quantity",
    "unit_price",
    "discount_amount",
    "tax_amount",
    "tax_breakup",
    "platform_fee_amount",
    "pricing_snapshot",
    "product_snapshot",
    "line_total",
  ],
};

const orderStatusHistoryTable = {
  name: "order_status_history",
  columns: [
    "id",
    "order_id",
    "from_status",
    "to_status",
    "actor_id",
    "actor_role",
    "reason",
    "note",
    "metadata",
    "created_at",
  ],
};

const orderNoteTable = {
  name: "order_notes",
  columns: [
    "id",
    "order_id",
    "actor_id",
    "actor_role",
    "visibility",
    "note",
    "created_at",
  ],
};

module.exports = { orderTable, orderItemTable, orderStatusHistoryTable, orderNoteTable };
