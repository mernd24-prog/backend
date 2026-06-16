"use strict";

const { knex } = require("../../../infrastructure/postgres/postgres-client");
const { v4: uuidv4 } = require("uuid");

class DealRepository {
  jsonb(value, fallback = {}) {
    let normalized = value;
    if (normalized === undefined || normalized === null || normalized === "") normalized = fallback;
    if (typeof normalized === "string") {
      try {
        normalized = JSON.parse(normalized);
      } catch {
        normalized = fallback;
      }
    }
    return knex.raw("?::jsonb", [JSON.stringify(normalized)]);
  }

  parseJson(value, fallback = {}) {
    if (!value) return fallback;
    if (typeof value === "object") return value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  generateDealNumber(date = new Date()) {
    const datePart = date.toISOString().slice(0, 10).replace(/-/g, "");
    return `DL-${datePart}-${uuidv4().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  }

  generatePayoutNumber(date = new Date()) {
    const datePart = date.toISOString().slice(0, 10).replace(/-/g, "");
    return `DPO-${datePart}-${uuidv4().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  }

  normalizeDealRow(row = {}) {
    if (!row) return null;
    return {
      ...row,
      dealId: row.id,
      dealNumber: row.deal_number,
      sellerId: row.seller_id,
      productId: row.product_id,
      variantId: row.variant_id,
      variantSku: row.variant_sku,
      dealType: row.deal_type,
      originalPrice: Number(row.original_price || 0),
      dealPrice: row.deal_price === null || row.deal_price === undefined ? null : Number(row.deal_price),
      discountPercent: row.discount_percent === null || row.discount_percent === undefined ? null : Number(row.discount_percent),
      allocatedQuantity: Number(row.allocated_quantity || 0),
      reservedQuantity: Number(row.reserved_quantity || 0),
      soldQuantity: Number(row.sold_quantity || 0),
      maxQuantityPerOrder: row.max_quantity_per_order === null || row.max_quantity_per_order === undefined ? null : Number(row.max_quantity_per_order),
      startAt: row.start_at,
      endAt: row.end_at,
      fulfillmentModel: row.fulfillment_model,
      deliveryVerificationRequired: Boolean(row.delivery_verification_required),
      deliveryVerificationMethods: this.parseJson(row.delivery_verification_methods, []),
      inventoryPolicy: this.parseJson(row.inventory_policy, {}),
      financePolicy: this.parseJson(row.finance_policy, {}),
      sponsorshipPolicy: this.parseJson(row.sponsorship_policy, {}),
      commissionRuleSnapshot: this.parseJson(row.commission_rule_snapshot, {}),
      termsSnapshot: this.parseJson(row.terms_snapshot, {}),
      metadata: this.parseJson(row.metadata, {}),
    };
  }

  normalizeDealPayload(payload = {}) {
    return {
      deal_number: payload.dealNumber || this.generateDealNumber(),
      title: payload.title,
      description: payload.description || null,
      seller_id: payload.sellerId,
      product_id: payload.productId,
      variant_id: payload.variantId || null,
      variant_sku: payload.variantSku || null,
      category: payload.category || null,
      deal_type: payload.dealType,
      status: payload.status,
      original_price: payload.originalPrice,
      deal_price: payload.dealPrice ?? null,
      discount_percent: payload.discountPercent ?? null,
      allocated_quantity: payload.allocatedQuantity || 0,
      reserved_quantity: payload.reservedQuantity || 0,
      sold_quantity: payload.soldQuantity || 0,
      max_quantity_per_order: payload.maxQuantityPerOrder ?? null,
      start_at: payload.startAt,
      end_at: payload.endAt,
      approved_at: payload.approvedAt || null,
      approved_by: payload.approvedBy || null,
      rejected_at: payload.rejectedAt || null,
      rejection_reason: payload.rejectionReason || null,
      paused_at: payload.pausedAt || null,
      cancelled_at: payload.cancelledAt || null,
      fulfillment_model: payload.fulfillmentModel,
      delivery_verification_required: Boolean(payload.deliveryVerificationRequired),
      delivery_verification_methods: this.jsonb(payload.deliveryVerificationMethods || [], []),
      inventory_policy: this.jsonb(payload.inventoryPolicy || {}, {}),
      finance_policy: this.jsonb(payload.financePolicy || {}, {}),
      sponsorship_policy: this.jsonb(payload.sponsorshipPolicy || {}, {}),
      commission_rule_snapshot: this.jsonb(payload.commissionRuleSnapshot || {}, {}),
      terms_snapshot: this.jsonb(payload.termsSnapshot || {}, {}),
      metadata: this.jsonb(payload.metadata || {}, {}),
      created_by: payload.createdBy || null,
      updated_by: payload.updatedBy || payload.createdBy || null,
    };
  }

  async listDeals({
    status = null,
    sellerId = null,
    productId = null,
    dealType = null,
    placement = null,
    fromDate = null,
    toDate = null,
    search = null,
    sortBy = "created_at",
    sortDir = "desc",
    limit = 50,
    offset = 0,
  } = {}) {
    const query = knex("deals as d");
    if (placement) {
      query.innerJoin("deal_sponsorships as sp", "sp.deal_id", "d.id").where("sp.placement", placement);
    }
    if (status) query.where("d.status", status);
    if (sellerId) query.where("d.seller_id", sellerId);
    if (productId) query.where("d.product_id", productId);
    if (dealType) query.where("d.deal_type", dealType);
    if (fromDate) query.where("d.created_at", ">=", fromDate);
    if (toDate) query.where("d.created_at", "<=", toDate);
    if (search) {
      query.where((builder) => builder
        .whereILike("d.title", `%${search}%`)
        .orWhereILike("d.deal_number", `%${search}%`)
        .orWhereILike("d.product_id", `%${search}%`)
        .orWhereILike("d.variant_sku", `%${search}%`)
        .orWhereILike("d.seller_id", `%${search}%`));
    }

    const sortColumns = {
      created_at: "d.created_at",
      updated_at: "d.updated_at",
      start_at: "d.start_at",
      end_at: "d.end_at",
      status: "d.status",
      title: "d.title",
      sold_quantity: "d.sold_quantity",
    };
    const sortColumn = sortColumns[sortBy] || "d.created_at";
    const direction = String(sortDir).toLowerCase() === "asc" ? "asc" : "desc";
    const countQuery = query.clone().clearSelect().clearOrder();
    const [{ count }] = await countQuery.countDistinct({ count: "d.id" });
    const rows = await query
      .clone()
      .select("d.*")
      .distinct("d.id")
      .orderBy(sortColumn, direction)
      .orderBy("d.created_at", "desc")
      .limit(Number(limit))
      .offset(Number(offset));

    return { items: rows.map((row) => this.normalizeDealRow(row)), total: Number(count || 0), limit: Number(limit), offset: Number(offset) };
  }

  async findDealById(dealId, trx = knex) {
    const [deal] = await trx("deals").where("id", dealId).limit(1);
    return this.normalizeDealRow(deal);
  }

  async findDealRawById(dealId, trx = knex) {
    const [deal] = await trx("deals").where("id", dealId).limit(1);
    return deal || null;
  }

  async getDealDetail(dealId) {
    const deal = await this.findDealById(dealId);
    if (!deal) return null;
    const [timeline, sales, payouts, sponsorships, commissionRules] = await Promise.all([
      knex("deal_timeline").where("deal_id", dealId).orderBy("created_at", "asc"),
      knex("deal_sales").where("deal_id", dealId).orderBy("created_at", "desc").limit(100),
      knex("deal_payouts").where((builder) => builder.where("deal_id", dealId).orWhereRaw("metadata->>'dealId' = ?", [dealId])).orderBy("created_at", "desc"),
      knex("deal_sponsorships").where("deal_id", dealId).orderBy("priority", "asc"),
      knex("deal_commission_rules").where("deal_id", dealId).orderBy("created_at", "desc"),
    ]);
    return { ...deal, timeline, sales, payouts, sponsorships, commissionRules };
  }

  async findActiveDealForItem({ productId, variantId = null, variantSku = null, sellerId = null }, trx = knex) {
    const now = new Date();
    const query = trx("deals")
      .where("product_id", String(productId))
      .whereIn("status", ["active"])
      .andWhere("start_at", "<=", now)
      .andWhere("end_at", ">", now)
      .andWhereRaw("(allocated_quantity = 0 OR sold_quantity + reserved_quantity < allocated_quantity)");
    if (sellerId) query.andWhere("seller_id", String(sellerId));
    query.andWhere((builder) => {
      builder.whereNull("variant_id").whereNull("variant_sku");
      if (variantId) builder.orWhere("variant_id", String(variantId));
      if (variantSku) builder.orWhere("variant_sku", String(variantSku));
    });
    const [row] = await query.orderByRaw("CASE WHEN variant_id IS NOT NULL OR variant_sku IS NOT NULL THEN 0 ELSE 1 END").orderBy("created_at", "desc").limit(1);
    return this.normalizeDealRow(row);
  }

  async createDeal(payload, timeline) {
    return knex.transaction(async (trx) => {
      const [deal] = await trx("deals").insert({ id: payload.id || uuidv4(), ...this.normalizeDealPayload(payload) }).returning("*");
      await this.insertTimeline(trx, { ...timeline, dealId: deal.id });
      return this.normalizeDealRow(deal);
    });
  }

  async updateDeal(dealId, payload, timeline) {
    return knex.transaction(async (trx) => {
      const data = this.normalizeDealPayload({
        ...payload,
        dealNumber: payload.dealNumber || undefined,
        createdBy: undefined,
      });
      delete data.deal_number;
      delete data.created_by;
      const [deal] = await trx("deals")
        .where("id", dealId)
        .update({ ...data, updated_at: knex.fn.now() })
        .returning("*");
      if (!deal) return null;
      await this.insertTimeline(trx, { ...timeline, dealId });
      return this.normalizeDealRow(deal);
    });
  }

  async updateDealStatus(dealId, payload = {}, timeline = {}) {
    return knex.transaction(async (trx) => {
      const [current] = await trx("deals").where("id", dealId).forUpdate().limit(1);
      if (!current) return null;
      const [deal] = await trx("deals")
        .where("id", dealId)
        .update({
          status: payload.status,
          approved_at: payload.approvedAt ?? current.approved_at,
          approved_by: payload.approvedBy ?? current.approved_by,
          rejected_at: payload.rejectedAt ?? current.rejected_at,
          rejection_reason: payload.rejectionReason ?? current.rejection_reason,
          paused_at: payload.pausedAt ?? current.paused_at,
          cancelled_at: payload.cancelledAt ?? current.cancelled_at,
          updated_by: payload.updatedBy || current.updated_by,
          updated_at: knex.fn.now(),
          metadata: payload.metadata
            ? knex.raw("COALESCE(metadata, '{}'::jsonb) || ?::jsonb", [JSON.stringify(payload.metadata)])
            : current.metadata,
        })
        .returning("*");
      await this.insertTimeline(trx, {
        ...timeline,
        dealId,
        fromStatus: current.status,
        toStatus: payload.status,
      });
      return this.normalizeDealRow(deal);
    });
  }

  async insertTimeline(trx, payload = {}) {
    return trx("deal_timeline").insert({
      id: uuidv4(),
      deal_id: payload.dealId,
      event_type: payload.eventType,
      from_status: payload.fromStatus || null,
      to_status: payload.toStatus || null,
      note: payload.note || null,
      reason: payload.reason || null,
      payload: this.jsonb(payload.payload || {}, {}),
      actor_id: payload.actorId || null,
      actor_role: payload.actorRole || null,
    });
  }

  async upsertCommissionRule(dealId, payload = {}, actor = {}) {
    return knex.transaction(async (trx) => {
      const [existing] = await trx("deal_commission_rules").where({ deal_id: dealId, status: "active" }).forUpdate().limit(1);
      if (existing) {
        await trx("deal_commission_rules").where("id", existing.id).update({ status: "inactive", updated_at: knex.fn.now(), updated_by: actor.userId || null });
      }
      const [rule] = await trx("deal_commission_rules").insert({
        id: uuidv4(),
        deal_id: dealId,
        seller_id: payload.sellerId,
        rule_type: payload.ruleType,
        commission_percent: payload.commissionPercent || 0,
        fixed_fee: payload.fixedFee || 0,
        cap_amount: payload.capAmount ?? null,
        tiers: this.jsonb(payload.tiers || [], []),
        applies_on: payload.appliesOn || "sale",
        status: "active",
        metadata: this.jsonb(payload.metadata || {}, {}),
        created_by: actor.userId || null,
        updated_by: actor.userId || null,
      }).returning("*");
      await trx("deals").where("id", dealId).update({
        commission_rule_snapshot: this.jsonb(rule, {}),
        updated_by: actor.userId || null,
        updated_at: knex.fn.now(),
      });
      await this.insertTimeline(trx, {
        dealId,
        eventType: "commission_rule_updated",
        payload: { rule },
        actorId: actor.userId,
        actorRole: actor.role,
      });
      return rule;
    });
  }

  async upsertSponsorship(dealId, payload = {}, actor = {}) {
    return knex.transaction(async (trx) => {
      const [existing] = await trx("deal_sponsorships").where({ deal_id: dealId, placement: payload.placement }).forUpdate().limit(1);
      const data = {
        deal_id: dealId,
        placement: payload.placement,
        title: payload.title || null,
        cta_text: payload.ctaText || null,
        asset_url: payload.assetUrl || null,
        target_url: payload.targetUrl || null,
        priority: Number(payload.priority || 100),
        start_at: payload.startAt || null,
        end_at: payload.endAt || null,
        status: payload.status || "active",
        region_scope: this.jsonb(payload.regionScope || {}, {}),
        audience_scope: this.jsonb(payload.audienceScope || {}, {}),
        metadata: this.jsonb(payload.metadata || {}, {}),
        updated_by: actor.userId || null,
        updated_at: knex.fn.now(),
      };
      const [row] = existing
        ? await trx("deal_sponsorships").where("id", existing.id).update(data).returning("*")
        : await trx("deal_sponsorships").insert({
          id: uuidv4(),
          ...data,
          created_by: actor.userId || null,
        }).returning("*");
      await this.insertTimeline(trx, {
        dealId,
        eventType: "sponsorship_updated",
        payload: row,
        actorId: actor.userId,
        actorRole: actor.role,
      });
      return row;
    });
  }

  async removeSponsorship(sponsorshipId, actor = {}) {
    const [row] = await knex("deal_sponsorships")
      .where("id", sponsorshipId)
      .update({ status: "inactive", updated_by: actor.userId || null, updated_at: knex.fn.now() })
      .returning("*");
    return row || null;
  }

  async listActivePlacements({ placement, limit = 20 } = {}) {
    const now = new Date();
    return knex("deal_sponsorships as sp")
      .innerJoin("deals as d", "d.id", "sp.deal_id")
      .select("sp.*", "d.title as deal_title", "d.deal_number", "d.product_id", "d.variant_id", "d.variant_sku", "d.deal_price", "d.original_price", "d.discount_percent", "d.end_at as deal_end_at")
      .where("sp.placement", placement)
      .where("sp.status", "active")
      .where("d.status", "active")
      .andWhere("d.start_at", "<=", now)
      .andWhere("d.end_at", ">", now)
      .andWhere((builder) => builder.whereNull("sp.start_at").orWhere("sp.start_at", "<=", now))
      .andWhere((builder) => builder.whereNull("sp.end_at").orWhere("sp.end_at", ">", now))
      .orderBy("sp.priority", "asc")
      .orderBy("sp.created_at", "desc")
      .limit(Number(limit));
  }

  async reserveOrderSales({ orderId, orderItems = [], actor = {} }) {
    const dealItems = orderItems.filter((item) => this.parseJson(item.deal_snapshot, item.dealSnapshot || {}).dealId || item.deal_id);
    if (!dealItems.length) return { reserved: 0, items: [] };

    return knex.transaction(async (trx) => {
      const inserted = [];
      for (const item of dealItems) {
        const snapshot = this.parseJson(item.deal_snapshot, item.dealSnapshot || {});
        const dealId = item.deal_id || snapshot.dealId || snapshot.id;
        const quantity = Number(item.quantity || 0);
        const [deal] = await trx("deals").where("id", dealId).forUpdate().limit(1);
        if (!deal || !["active", "scheduled"].includes(deal.status)) {
          throw new Error("Deal is no longer available");
        }
        if (Number(deal.allocated_quantity || 0) > 0 && Number(deal.sold_quantity || 0) + Number(deal.reserved_quantity || 0) + quantity > Number(deal.allocated_quantity || 0)) {
          throw new Error("Deal allocated quantity is sold out");
        }
        await trx("deals").where("id", dealId).update({
          reserved_quantity: Number(deal.reserved_quantity || 0) + quantity,
          updated_at: knex.fn.now(),
        });
        const lineTotal = Number(item.line_total || item.lineTotal || 0);
        const commissionAmount = Number(item.platform_fee_amount || item.platformFeeAmount || 0);
        const [sale] = await trx("deal_sales")
          .insert({
            id: uuidv4(),
            deal_id: dealId,
            order_id: orderId,
            order_item_id: item.id,
            seller_id: item.seller_id || item.sellerId || deal.seller_id,
            product_id: item.product_id || item.productId || deal.product_id,
            variant_id: item.variant_id || item.variantId || null,
            variant_sku: item.variant_sku || item.variantSku || null,
            quantity,
            unit_price: Number(item.unit_price || item.unitPrice || 0),
            line_total: lineTotal,
            commission_amount: commissionAmount,
            payout_amount: Math.max(0, Number((lineTotal - commissionAmount).toFixed(2))),
            sale_status: "reserved",
            payout_eligible: false,
            fulfillment_snapshot: this.jsonb(item.fulfillment_snapshot || item.fulfillmentSnapshot || {}, {}),
            deal_snapshot: this.jsonb(snapshot, {}),
          })
          .onConflict(["deal_id", "order_item_id"])
          .ignore()
          .returning("*");
        if (sale) {
          inserted.push(sale);
          await this.insertTimeline(trx, {
            dealId,
            eventType: "sale_reserved",
            payload: { orderId, orderItemId: item.id, quantity, lineTotal },
            actorId: actor.userId,
            actorRole: actor.role || "system",
          });
        }
      }
      return { reserved: inserted.length, items: inserted };
    });
  }

  async updateSalesForOrder(orderId, payload = {}) {
    return knex.transaction(async (trx) => {
      const sales = await trx("deal_sales").where("order_id", orderId).forUpdate();
      if (!sales.length) return { updated: 0, items: [] };
      const updated = [];
      for (const sale of sales) {
        if (
          sale.sale_status === payload.status &&
          (payload.payoutEligible === undefined || Boolean(sale.payout_eligible) === Boolean(payload.payoutEligible))
        ) {
          updated.push(sale);
          continue;
        }
        if (payload.status === "confirmed" && sale.sale_status === "reserved") {
          await trx("deals").where("id", sale.deal_id).update({
            reserved_quantity: knex.raw("GREATEST(reserved_quantity - ?, 0)", [Number(sale.quantity || 0)]),
            sold_quantity: knex.raw("sold_quantity + ?", [Number(sale.quantity || 0)]),
            updated_at: knex.fn.now(),
          });
        }
        if (["cancelled", "refunded"].includes(payload.status) && ["reserved", "confirmed", "delivered_verified"].includes(sale.sale_status)) {
          const decrementColumn = sale.sale_status === "reserved" ? "reserved_quantity" : "sold_quantity";
          await trx("deals").where("id", sale.deal_id).update({
            [decrementColumn]: knex.raw(`GREATEST(${decrementColumn} - ?, 0)`, [Number(sale.quantity || 0)]),
            updated_at: knex.fn.now(),
          });
        }
        const [row] = await trx("deal_sales")
          .where("id", sale.id)
          .update({
            sale_status: payload.status || sale.sale_status,
            payout_eligible: payload.payoutEligible ?? sale.payout_eligible,
            updated_at: knex.fn.now(),
          })
          .returning("*");
        updated.push(row);
        await this.insertTimeline(trx, {
          dealId: sale.deal_id,
          eventType: payload.eventType || `sale_${payload.status}`,
          payload: { orderId, orderItemId: sale.order_item_id, saleId: sale.id, status: payload.status },
          actorId: payload.actor?.userId,
          actorRole: payload.actor?.role || "system",
        });
      }
      return { updated: updated.length, items: updated };
    });
  }

  async cancelOrderItemSales(orderId, cancellationId, cancellationItems = [], actor = {}) {
    if (!cancellationItems.length) return { updated: 0, items: [] };
    const quantityByOrderItem = new Map(
      cancellationItems.map((item) => [String(item.orderItemId), Number(item.quantity || 0)]),
    );

    return knex.transaction(async (trx) => {
      const sales = await trx("deal_sales")
        .where("order_id", orderId)
        .whereIn("order_item_id", [...quantityByOrderItem.keys()])
        .forUpdate();
      const updated = [];

      for (const sale of sales) {
        const history = this.parseJson(sale.cancellation_history, []);
        if (history.some((entry) => entry.cancellationId === cancellationId)) {
          updated.push(sale);
          continue;
        }
        const cancellationQuantity = quantityByOrderItem.get(String(sale.order_item_id)) || 0;
        const remainingQuantity = Number(sale.quantity || 0) - Number(sale.cancelled_quantity || 0);
        if (!Number.isInteger(cancellationQuantity) || cancellationQuantity <= 0 || cancellationQuantity > remainingQuantity) {
          throw new Error(`Invalid deal cancellation quantity for order item ${sale.order_item_id}`);
        }
        const ratio = cancellationQuantity / Math.max(remainingQuantity, 1);
        const sourceSaleStatus = history[0]?.sourceSaleStatus || sale.sale_status;
        const decrementColumn = sourceSaleStatus === "reserved" ? "reserved_quantity" : "sold_quantity";
        await trx("deals").where("id", sale.deal_id).update({
          [decrementColumn]: knex.raw(`GREATEST(${decrementColumn} - ?, 0)`, [cancellationQuantity]),
          updated_at: knex.fn.now(),
        });
        const nextCancelledQuantity = Number(sale.cancelled_quantity || 0) + cancellationQuantity;
        const nextStatus = nextCancelledQuantity >= Number(sale.quantity || 0) ? "cancelled" : "partially_cancelled";
        const [row] = await trx("deal_sales").where("id", sale.id).update({
          cancelled_quantity: nextCancelledQuantity,
          sale_status: nextStatus,
          payout_eligible: nextStatus === "cancelled" ? false : sale.payout_eligible,
          line_total: Number((Number(sale.line_total || 0) * (1 - ratio)).toFixed(2)),
          commission_amount: Number((Number(sale.commission_amount || 0) * (1 - ratio)).toFixed(2)),
          payout_amount: Number((Number(sale.payout_amount || 0) * (1 - ratio)).toFixed(2)),
          cancellation_history: this.jsonb([
            ...history,
            {
              cancellationId,
              quantity: cancellationQuantity,
              sourceSaleStatus,
              actorId: actor.userId || null,
              actorRole: actor.role || "system",
              at: new Date().toISOString(),
            },
          ], []),
          updated_at: knex.fn.now(),
        }).returning("*");
        updated.push(row);
        await this.insertTimeline(trx, {
          dealId: sale.deal_id,
          eventType: nextStatus === "cancelled" ? "sale_cancelled" : "sale_partially_cancelled",
          payload: {
            orderId,
            orderItemId: sale.order_item_id,
            saleId: sale.id,
            cancellationId,
            quantity: cancellationQuantity,
          },
          actorId: actor.userId,
          actorRole: actor.role || "system",
        });
      }
      return { updated: updated.length, items: updated };
    });
  }

  async generatePayout(payload = {}, actor = {}) {
    return knex.transaction(async (trx) => {
      const query = trx("deal_sales as ds")
        .innerJoin("deals as d", "d.id", "ds.deal_id")
        .select("ds.*", "d.delivery_verification_required", "d.title as deal_title")
        .whereBetween("ds.created_at", [payload.periodStart, `${payload.periodEnd} 23:59:59`])
        .whereNull("ds.payout_id")
        .whereNotIn("ds.sale_status", ["cancelled", "refunded"])
        .forUpdate();
      if (payload.sellerId) query.where("ds.seller_id", payload.sellerId);
      if (payload.dealId) query.where("ds.deal_id", payload.dealId);
      const sales = await query;
      const eligible = sales.filter((sale) => {
        if (payload.requireDeliveryVerified === false) return sale.sale_status === "confirmed" || sale.sale_status === "delivered_verified";
        if (payload.requireDeliveryVerified === true || sale.delivery_verification_required) return sale.sale_status === "delivered_verified";
        return sale.sale_status === "confirmed" || sale.sale_status === "delivered_verified";
      });
      if (!eligible.length) {
        return { generated: 0, items: [], message: "No eligible deal sales found" };
      }
      const grouped = new Map();
      eligible.forEach((sale) => {
        const key = `${sale.seller_id}:${payload.dealId ? sale.deal_id : "all"}`;
        const current = grouped.get(key) || {
          sellerId: sale.seller_id,
          dealId: payload.dealId ? sale.deal_id : null,
          sales: [],
          totalSalesAmount: 0,
          commissionAmount: 0,
          payoutAmount: 0,
        };
        current.sales.push(sale);
        current.totalSalesAmount += Number(sale.line_total || 0);
        current.commissionAmount += Number(sale.commission_amount || 0);
        current.payoutAmount += Number(sale.payout_amount || 0);
        grouped.set(key, current);
      });
      const payouts = [];
      for (const group of grouped.values()) {
        const [payout] = await trx("deal_payouts").insert({
          id: uuidv4(),
          payout_number: this.generatePayoutNumber(),
          seller_id: group.sellerId,
          deal_id: group.dealId,
          period_start: payload.periodStart,
          period_end: payload.periodEnd,
          total_sales_amount: Number(group.totalSalesAmount.toFixed(2)),
          commission_amount: Number(group.commissionAmount.toFixed(2)),
          payout_amount: Number(group.payoutAmount.toFixed(2)),
          currency: "INR",
          status: "generated",
          sale_ids: this.jsonb(group.sales.map((sale) => sale.id), []),
          notes: payload.note || null,
          metadata: this.jsonb({
            generatedBy: actor.userId || null,
            source: "deal_payout_generation",
            dealId: payload.dealId || null,
          }),
          created_by: actor.userId || null,
        }).returning("*");
        await trx("deal_sales").whereIn("id", group.sales.map((sale) => sale.id)).update({ payout_id: payout.id, updated_at: knex.fn.now() });
        if (group.dealId) {
          await this.insertTimeline(trx, {
            dealId: group.dealId,
            eventType: "payout_generated",
            payload: payout,
            actorId: actor.userId,
            actorRole: actor.role,
          });
        }
        payouts.push(payout);
      }
      return { generated: payouts.length, items: payouts };
    });
  }

  async listPayouts(filters = {}) {
    const query = knex("deal_payouts");
    if (filters.sellerId) query.where("seller_id", filters.sellerId);
    if (filters.dealId) query.where("deal_id", filters.dealId);
    if (filters.status) query.where("status", filters.status);
    if (filters.fromDate) query.where("created_at", ">=", filters.fromDate);
    if (filters.toDate) query.where("created_at", "<=", filters.toDate);
    const [{ count }] = await query.clone().clearSelect().clearOrder().count({ count: "*" });
    const items = await query.orderBy("created_at", "desc").limit(Number(filters.limit || 50)).offset(Number(filters.offset || 0));
    return { items, total: Number(count || 0), limit: Number(filters.limit || 50), offset: Number(filters.offset || 0) };
  }

  async processPayout(payoutId, payload = {}, actor = {}) {
    return knex.transaction(async (trx) => {
      const [payout] = await trx("deal_payouts").where("id", payoutId).forUpdate().limit(1);
      if (!payout) return null;
      const processedAt = new Date();
      const [updated] = await trx("deal_payouts").where("id", payoutId).update({
        status: payload.status,
        payment_reference: payload.paymentReference || payout.payment_reference,
        notes: payload.note || payout.notes,
        processed_by: actor.userId || null,
        processed_at: processedAt,
        updated_at: knex.fn.now(),
      }).returning("*");
      if (payload.status === "paid") {
        await trx("deal_sales").where("payout_id", payoutId).update({ payout_eligible: false, updated_at: knex.fn.now() });
      }
      if (payout.deal_id) {
        await this.insertTimeline(trx, {
          dealId: payout.deal_id,
          eventType: "payout_processed",
          payload: { payoutId, status: payload.status, paymentReference: payload.paymentReference || null },
          actorId: actor.userId,
          actorRole: actor.role,
        });
      }
      return updated;
    });
  }

  async getAnalytics(filters = {}) {
    const salesQuery = knex("deal_sales as ds").innerJoin("deals as d", "d.id", "ds.deal_id");
    if (filters.sellerId) salesQuery.where("ds.seller_id", filters.sellerId);
    if (filters.dealId) salesQuery.where("ds.deal_id", filters.dealId);
    if (filters.fromDate) salesQuery.where("ds.created_at", ">=", filters.fromDate);
    if (filters.toDate) salesQuery.where("ds.created_at", "<=", filters.toDate);

    const [summary] = await salesQuery.clone()
      .select(knex.raw("COUNT(*)::int as sale_count"))
      .sum({ units_sold: "ds.quantity" })
      .sum({ revenue: "ds.line_total" })
      .sum({ commission: "ds.commission_amount" })
      .sum({ payout: "ds.payout_amount" });
    const topDeals = await salesQuery.clone()
      .select("ds.deal_id", "d.title", "d.deal_number")
      .sum({ units_sold: "ds.quantity" })
      .sum({ revenue: "ds.line_total" })
      .sum({ commission: "ds.commission_amount" })
      .groupBy("ds.deal_id", "d.title", "d.deal_number")
      .orderBy("revenue", "desc")
      .limit(Number(filters.limit || 20));
    const statusCounts = await knex("deals")
      .modify((query) => {
        if (filters.sellerId) query.where("seller_id", filters.sellerId);
      })
      .select("status")
      .count({ count: "*" })
      .groupBy("status");
    return {
      summary: {
        saleCount: Number(summary?.sale_count || 0),
        unitsSold: Number(summary?.units_sold || 0),
        revenue: Number(summary?.revenue || 0),
        commission: Number(summary?.commission || 0),
        payout: Number(summary?.payout || 0),
      },
      topDeals,
      statusCounts,
    };
  }

  async expireDueDeals(actor = {}) {
    return knex.transaction(async (trx) => {
      const now = new Date();
      const rows = await trx("deals")
        .whereIn("status", ["active", "scheduled"])
        .andWhere("end_at", "<=", now)
        .forUpdate();
      for (const row of rows) {
        await trx("deals").where("id", row.id).update({ status: "expired", updated_at: knex.fn.now(), updated_by: actor.userId || "system" });
        await this.insertTimeline(trx, {
          dealId: row.id,
          eventType: "deal_expired",
          fromStatus: row.status,
          toStatus: "expired",
          actorId: actor.userId || "system",
          actorRole: actor.role || "system",
        });
      }
      const soldOut = await trx("deals")
        .where("status", "active")
        .where("allocated_quantity", ">", 0)
        .whereRaw("sold_quantity >= allocated_quantity")
        .forUpdate();
      for (const row of soldOut) {
        await trx("deals").where("id", row.id).update({ status: "completed", updated_at: knex.fn.now(), updated_by: actor.userId || "system" });
        await this.insertTimeline(trx, {
          dealId: row.id,
          eventType: "deal_completed",
          fromStatus: row.status,
          toStatus: "completed",
          actorId: actor.userId || "system",
          actorRole: actor.role || "system",
        });
      }
      return { expired: rows.length, completed: soldOut.length };
    });
  }
}

module.exports = { DealRepository };
