const { postgresPool } = require("../../../infrastructure/postgres/postgres-client");
const { v4: uuidv4 } = require("uuid");

class TaxRepository {
  async findInvoiceByOrderId(orderId) {
    const { rows } = await postgresPool.query(
      `SELECT *
       FROM tax_invoices
       WHERE order_id = $1
         AND COALESCE(invoice_type, 'order_customer') = 'order_customer'
       ORDER BY created_at DESC
       LIMIT 1`,
      [orderId],
    );
    return rows[0] || null;
  }

  async findInvoicesByOrderId(orderId, { invoiceType = null, sellerId = null, organizationId = undefined } = {}) {
    const values = [orderId];
    const clauses = ["order_id = $1"];
    let idx = 2;

    if (invoiceType) {
      clauses.push(`COALESCE(invoice_type, 'order_customer') = $${idx++}`);
      values.push(invoiceType);
    }
    if (sellerId) {
      clauses.push(`seller_id = $${idx++}`);
      values.push(sellerId);
    }
    if (organizationId !== undefined) {
      if (organizationId) {
        clauses.push(`organization_id = $${idx++}`);
        values.push(organizationId);
      } else {
        clauses.push("organization_id IS NULL");
      }
    }

    const { rows } = await postgresPool.query(
      `SELECT *
       FROM tax_invoices
       WHERE ${clauses.join(" AND ")}
       ORDER BY issued_at DESC, created_at DESC`,
      values,
    );
    return rows;
  }

  async findInvoiceByOrderAndType({
    orderId,
    invoiceType,
    sellerId = null,
    organizationId = undefined,
    referenceType = null,
    referenceId = null,
  }) {
    const values = [orderId, invoiceType];
    const clauses = [
      "order_id = $1",
      "COALESCE(invoice_type, 'order_customer') = $2",
    ];
    let idx = 3;

    if (sellerId) {
      clauses.push(`seller_id = $${idx++}`);
      values.push(sellerId);
    } else {
      clauses.push("seller_id IS NULL");
    }
    if (organizationId !== undefined) {
      if (organizationId) {
        clauses.push(`organization_id = $${idx++}`);
        values.push(organizationId);
      } else {
        clauses.push("organization_id IS NULL");
      }
    }
    if (referenceType) {
      clauses.push(`reference_type = $${idx++}`);
      values.push(referenceType);
    }
    if (referenceId) {
      clauses.push(`reference_id = $${idx++}`);
      values.push(referenceId);
    }

    const { rows } = await postgresPool.query(
      `SELECT *
       FROM tax_invoices
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT 1`,
      values,
    );
    return rows[0] || null;
  }

  async findInvoiceById(invoiceId) {
    const { rows } = await postgresPool.query(
      "SELECT * FROM tax_invoices WHERE id = $1 LIMIT 1",
      [invoiceId],
    );
    return rows[0] || null;
  }

  async createInvoice(payload) {
    const id = uuidv4();
    const { rows } = await postgresPool.query(
      `INSERT INTO tax_invoices (
        id, invoice_number, order_id, buyer_id, taxable_amount, tax_amount,
        cgst_amount, sgst_amount, igst_amount, tcs_amount, total_amount,
        currency, tax_mode, gstin_marketplace, gstin_seller, place_of_supply,
        invoice_type, seller_id, organization_id, organization_snapshot,
        issuer_type, recipient_type, reference_type, reference_id,
        parent_invoice_id, issued_at, metadata, created_by, updated_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
        $17,$18,$19,$20::jsonb,$21,$22,$23,$24,$25,NOW(),$26::jsonb,$27,$28
      )
      RETURNING *`,
      [
        id,
        payload.invoiceNumber,
        payload.orderId,
        payload.buyerId,
        payload.taxableAmount,
        payload.taxAmount,
        payload.cgstAmount,
        payload.sgstAmount,
        payload.igstAmount,
        payload.tcsAmount,
        payload.totalAmount,
        payload.currency || "INR",
        payload.taxMode,
        payload.gstinMarketplace || null,
        payload.gstinSeller || null,
        payload.placeOfSupply || null,
        payload.invoiceType || "order_customer",
        payload.sellerId || null,
        payload.organizationId || null,
        JSON.stringify(payload.organizationSnapshot || {}),
        payload.issuerType || null,
        payload.recipientType || null,
        payload.referenceType || null,
        payload.referenceId || null,
        payload.parentInvoiceId || null,
        JSON.stringify(payload.metadata || {}),
        payload.createdBy || null,
        payload.updatedBy || payload.createdBy || null,
      ],
    );
    return rows[0];
  }

  async listInvoices({
    fromDate = null,
    toDate = null,
    sellerId = null,
    organizationId = null,
    buyerId = null,
    invoiceType = null,
    referenceType = null,
    referenceId = null,
    state = null,
    hsnCode = null,
    search = null,
    sortBy = "issued_at",
    sortDir = "desc",
    limit = 50,
    offset = 0,
  } = {}) {
    const values = [];
    const clauses = [];
    let idx = 1;

    if (fromDate) {
      clauses.push(`ti.issued_at >= $${idx++}`);
      values.push(fromDate);
    }
    if (toDate) {
      clauses.push(`ti.issued_at <= $${idx++}`);
      values.push(toDate);
    }
    if (buyerId) {
      clauses.push(`ti.buyer_id = $${idx++}`);
      values.push(buyerId);
    }
    if (invoiceType) {
      clauses.push(`COALESCE(ti.invoice_type, 'order_customer') = $${idx++}`);
      values.push(invoiceType);
    }
    if (referenceType) {
      clauses.push(`ti.reference_type = $${idx++}`);
      values.push(referenceType);
    }
    if (referenceId) {
      clauses.push(`ti.reference_id = $${idx++}`);
      values.push(referenceId);
    }
    if (sellerId) {
      clauses.push(`(
        ti.seller_id = $${idx}
        OR EXISTS (
          SELECT 1 FROM order_items oi
          WHERE oi.order_id = ti.order_id AND oi.seller_id = $${idx}
        )
      )`);
      values.push(sellerId);
      idx += 1;
    }
    if (organizationId) {
      clauses.push(`(
        ti.organization_id = $${idx}
        OR EXISTS (
          SELECT 1 FROM order_items oi
          WHERE oi.order_id = ti.order_id AND oi.organization_id = $${idx}
        )
      )`);
      values.push(organizationId);
      idx += 1;
    }
    if (state) {
      clauses.push(`ti.place_of_supply ILIKE $${idx++}`);
      values.push(state);
    }
    if (hsnCode) {
      clauses.push(`EXISTS (
        SELECT 1 FROM order_items oi
        WHERE oi.order_id = ti.order_id AND oi.hsn_code = $${idx++}
      )`);
      values.push(hsnCode);
    }
    if (search) {
      clauses.push(`(ti.invoice_number ILIKE $${idx} OR ti.order_id::text ILIKE $${idx} OR COALESCE(ti.reference_id, '') ILIKE $${idx})`);
      values.push(`%${search}%`);
      idx += 1;
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const sortColumns = {
      issuedAt: "ti.issued_at",
      issued_at: "ti.issued_at",
      invoiceNumber: "ti.invoice_number",
      invoice_number: "ti.invoice_number",
      taxableAmount: "ti.taxable_amount",
      taxable_amount: "ti.taxable_amount",
      taxAmount: "ti.tax_amount",
      tax_amount: "ti.tax_amount",
      totalAmount: "ti.total_amount",
      total_amount: "ti.total_amount",
      invoiceType: "ti.invoice_type",
      invoice_type: "ti.invoice_type",
    };
    const orderColumn = sortColumns[sortBy] || "ti.issued_at";
    const orderDirection = String(sortDir).toLowerCase() === "asc" ? "ASC" : "DESC";
    const pagingValues = [...values, limit, offset];
    const [listResult, countResult] = await Promise.all([
      postgresPool.query(
        `SELECT ti.*
         FROM tax_invoices ti
         ${whereSql}
         ORDER BY ${orderColumn} ${orderDirection}, ti.issued_at DESC
         LIMIT $${idx++} OFFSET $${idx}`,
        pagingValues,
      ),
      postgresPool.query(
        `SELECT COUNT(*)::INT AS total
         FROM tax_invoices ti
         ${whereSql}`,
        values,
      ),
    ]);

    return {
      list: listResult.rows,
      total: Number(countResult.rows[0]?.total || 0),
    };
  }

  async findCreditNoteByReference(referenceType, referenceId) {
    const { rows } = await postgresPool.query(
      `SELECT *
       FROM tax_credit_notes
       WHERE reference_type = $1 AND reference_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [referenceType, referenceId],
    );
    return rows[0] || null;
  }

  async findCreditNoteById(creditNoteId) {
    const { rows } = await postgresPool.query(
      "SELECT * FROM tax_credit_notes WHERE id = $1 LIMIT 1",
      [creditNoteId],
    );
    return rows[0] || null;
  }

  async createCreditNote(payload) {
    const id = uuidv4();
    const { rows } = await postgresPool.query(
      `INSERT INTO tax_credit_notes (
        id, credit_note_number, invoice_id, order_id, buyer_id, organization_id,
        organization_snapshot, reference_type, reference_id, taxable_amount,
        tax_amount, cgst_amount, sgst_amount, igst_amount, total_amount,
        currency, reason, metadata, issued_at, created_by, updated_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,NOW(),$19,$20
      )
      RETURNING *`,
      [
        id,
        payload.creditNoteNumber,
        payload.invoiceId,
        payload.orderId,
        payload.buyerId,
        payload.organizationId || null,
        JSON.stringify(payload.organizationSnapshot || {}),
        payload.referenceType,
        payload.referenceId,
        payload.taxableAmount,
        payload.taxAmount,
        payload.cgstAmount,
        payload.sgstAmount,
        payload.igstAmount,
        payload.totalAmount,
        payload.currency || "INR",
        payload.reason || null,
        JSON.stringify(payload.metadata || {}),
        payload.createdBy || null,
        payload.updatedBy || payload.createdBy || null,
      ],
    );
    return rows[0];
  }

  async listCreditNotes({
    fromDate = null,
    toDate = null,
    orderId = null,
    buyerId = null,
    organizationId = null,
    referenceType = null,
    search = null,
    sortBy = "issued_at",
    sortDir = "desc",
    limit = 50,
    offset = 0,
  } = {}) {
    const values = [];
    const clauses = [];
    let idx = 1;

    if (fromDate) {
      clauses.push(`issued_at >= $${idx++}`);
      values.push(fromDate);
    }
    if (toDate) {
      clauses.push(`issued_at <= $${idx++}`);
      values.push(toDate);
    }
    if (orderId) {
      clauses.push(`order_id = $${idx++}`);
      values.push(orderId);
    }
    if (buyerId) {
      clauses.push(`buyer_id = $${idx++}`);
      values.push(buyerId);
    }
    if (organizationId) {
      clauses.push(`organization_id = $${idx++}`);
      values.push(organizationId);
    }
    if (referenceType) {
      clauses.push(`reference_type = $${idx++}`);
      values.push(referenceType);
    }
    if (search) {
      clauses.push(`(credit_note_number ILIKE $${idx} OR order_id::text ILIKE $${idx} OR reference_id ILIKE $${idx})`);
      values.push(`%${search}%`);
      idx += 1;
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const sortColumns = {
      issuedAt: "issued_at",
      issued_at: "issued_at",
      creditNoteNumber: "credit_note_number",
      credit_note_number: "credit_note_number",
      taxableAmount: "taxable_amount",
      taxable_amount: "taxable_amount",
      taxAmount: "tax_amount",
      tax_amount: "tax_amount",
      totalAmount: "total_amount",
      total_amount: "total_amount",
    };
    const orderColumn = sortColumns[sortBy] || "issued_at";
    const orderDirection = String(sortDir).toLowerCase() === "asc" ? "ASC" : "DESC";
    const pagingValues = [...values, limit, offset];
    const [listResult, countResult] = await Promise.all([
      postgresPool.query(
        `SELECT *
         FROM tax_credit_notes
         ${whereSql}
         ORDER BY ${orderColumn} ${orderDirection}, issued_at DESC
         LIMIT $${idx++} OFFSET $${idx}`,
        pagingValues,
      ),
      postgresPool.query(
        `SELECT COUNT(*)::INT AS total
         FROM tax_credit_notes
         ${whereSql}`,
        values,
      ),
    ]);
    return {
      list: listResult.rows,
      total: Number(countResult.rows[0]?.total || 0),
    };
  }

  async insertLedgerEntries(entries) {
    if (!entries.length) {
      return [];
    }

    const values = [];
    const params = [];
    let idx = 1;

    for (const entry of entries) {
      values.push(
        `($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++}::jsonb,$${idx++},NOW(),$${idx++})`,
      );
      params.push(
        uuidv4(),
        entry.orderId,
        entry.invoiceId || null,
        entry.entryType,
        entry.taxComponent,
        entry.amount,
        entry.currency || "INR",
        entry.organizationId || null,
        JSON.stringify(entry.organizationSnapshot || {}),
        entry.referenceType || "order",
        entry.referenceId || entry.orderId,
      );
    }

    const { rows } = await postgresPool.query(
      `INSERT INTO tax_ledger_entries (
        id, order_id, invoice_id, entry_type, tax_component, amount, currency,
        organization_id, organization_snapshot, reference_type, created_at, reference_id
      )
      VALUES ${values.join(",")}
      RETURNING *`,
      params,
    );

    return rows;
  }

  async listTaxReports({ fromDate, toDate, taxComponent = null, organizationId = null, limit = 200, offset = 0 }) {
    const values = [fromDate, toDate];
    let whereSql = "WHERE created_at BETWEEN $1 AND $2";
    let idx = 3;

    if (taxComponent) {
      whereSql += ` AND tax_component = $${idx++}`;
      values.push(taxComponent);
    }
    if (organizationId) {
      whereSql += ` AND organization_id = $${idx++}`;
      values.push(organizationId);
    }

    values.push(limit, offset);

    const { rows } = await postgresPool.query(
      `SELECT
         organization_id,
         tax_component,
         entry_type,
         COUNT(*)::INT AS entry_count,
         COALESCE(SUM(amount), 0)::NUMERIC AS total_amount
       FROM tax_ledger_entries
       ${whereSql}
       GROUP BY organization_id, tax_component, entry_type
       ORDER BY organization_id ASC NULLS FIRST, tax_component ASC, entry_type ASC
       LIMIT $${idx++} OFFSET $${idx}`,
      values,
    );
    return rows;
  }

  async nextInvoiceNumber(prefix = "INV", tableName = "tax_invoices", columnName = "invoice_number") {
    const { rows } = await postgresPool.query(
      `SELECT COUNT(*)::INT AS count
       FROM ${tableName}
       WHERE ${columnName} LIKE $1`,
      [`${prefix}-%`],
    );
    const nextSequence = Number(rows[0]?.count || 0) + 1;
    const pad = String(nextSequence).padStart(6, "0");
    const month = new Date().toISOString().slice(0, 7).replace("-", "");
    return `${prefix}-${month}-${pad}`;
  }
}

module.exports = { TaxRepository };
