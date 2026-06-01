const { postgresPool } = require("../../../infrastructure/postgres/postgres-client");
const { v4: uuidv4 } = require("uuid");

class TaxRepository {
  async findInvoiceByOrderId(orderId) {
    const { rows } = await postgresPool.query(
      "SELECT * FROM tax_invoices WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1",
      [orderId],
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
        currency, tax_mode, gstin_marketplace, gstin_seller, place_of_supply, issued_at, metadata
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),$17::jsonb
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
        JSON.stringify(payload.metadata || {}),
      ],
    );
    return rows[0];
  }

  async listInvoices({
    fromDate = null,
    toDate = null,
    sellerId = null,
    buyerId = null,
    state = null,
    hsnCode = null,
    search = null,
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
    if (sellerId) {
      clauses.push(`EXISTS (
        SELECT 1 FROM order_items oi
        WHERE oi.order_id = ti.order_id AND oi.seller_id = $${idx++}
      )`);
      values.push(sellerId);
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
      clauses.push(`(ti.invoice_number ILIKE $${idx} OR ti.order_id::text ILIKE $${idx})`);
      values.push(`%${search}%`);
      idx += 1;
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const pagingValues = [...values, limit, offset];
    const [listResult, countResult] = await Promise.all([
      postgresPool.query(
        `SELECT ti.*
         FROM tax_invoices ti
         ${whereSql}
         ORDER BY ti.issued_at DESC
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

  async createCreditNote(payload) {
    const id = uuidv4();
    const { rows } = await postgresPool.query(
      `INSERT INTO tax_credit_notes (
        id, credit_note_number, invoice_id, order_id, buyer_id, reference_type,
        reference_id, taxable_amount, tax_amount, cgst_amount, sgst_amount,
        igst_amount, total_amount, currency, reason, metadata, issued_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW()
      )
      RETURNING *`,
      [
        id,
        payload.creditNoteNumber,
        payload.invoiceId,
        payload.orderId,
        payload.buyerId,
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
        payload.metadata || {},
      ],
    );
    return rows[0];
  }

  async listCreditNotes({ fromDate = null, toDate = null, orderId = null, limit = 50, offset = 0 } = {}) {
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

    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    values.push(limit, offset);
    const { rows } = await postgresPool.query(
      `SELECT *
       FROM tax_credit_notes
       ${whereSql}
       ORDER BY issued_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      values,
    );
    return rows;
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
        `($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},NOW(),$${idx++})`,
      );
      params.push(
        uuidv4(),
        entry.orderId,
        entry.invoiceId || null,
        entry.entryType,
        entry.taxComponent,
        entry.amount,
        entry.currency || "INR",
        entry.referenceType || "order",
        entry.referenceId || entry.orderId,
      );
    }

    const { rows } = await postgresPool.query(
      `INSERT INTO tax_ledger_entries (
        id, order_id, invoice_id, entry_type, tax_component, amount, currency, reference_type, created_at, reference_id
      )
      VALUES ${values.join(",")}
      RETURNING *`,
      params,
    );

    return rows;
  }

  async listTaxReports({ fromDate, toDate, taxComponent = null, limit = 200, offset = 0 }) {
    const values = [fromDate, toDate];
    let whereSql = "WHERE created_at BETWEEN $1 AND $2";
    let idx = 3;

    if (taxComponent) {
      whereSql += ` AND tax_component = $${idx++}`;
      values.push(taxComponent);
    }

    values.push(limit, offset);

    const { rows } = await postgresPool.query(
      `SELECT
         tax_component,
         entry_type,
         COUNT(*)::INT AS entry_count,
         COALESCE(SUM(amount), 0)::NUMERIC AS total_amount
       FROM tax_ledger_entries
       ${whereSql}
       GROUP BY tax_component, entry_type
       ORDER BY tax_component ASC, entry_type ASC
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
