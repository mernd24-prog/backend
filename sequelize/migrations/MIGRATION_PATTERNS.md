# Sequelize Migration Best Practices

## ❌ DEPRECATED: createTableIfNotExists Pattern

**DO NOT USE** `CREATE TABLE IF NOT EXISTS` or `queryInterface.createTableIfNotExists()` in new migrations.

### Why?
The `IF NOT EXISTS` pattern breaks when subsequent migrations try to add ALTER TABLE commands to modify columns:
- If the table was already created (from IF NOT EXISTS), schema modifications fail or behave unexpectedly
- Sequelize cannot properly validate column existence before running ALTERs
- Migration re-runs cause inconsistent state

### Example of problematic code:
```javascript
// ❌ BAD - DO NOT USE
await queryInterface.sequelize.query(`
  CREATE TABLE IF NOT EXISTS my_table (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL
  );
`);

// Later migration tries to add constraints...
await queryInterface.addColumn("my_table", "email", { type: Sequelize.STRING });
// ^ This fails if IF NOT EXISTS was used before
```

---

## ✅ RECOMMENDED: hasTable + createTable Pattern

**ALWAYS USE** explicit table existence checks with `queryInterface.createTable()` for new migrations.

### Pattern:
```javascript
module.exports = {
  id: "NNN-descriptive-name",
  
  async up({ queryInterface, Sequelize, transaction }) {
    // 1. Check if table exists using direct SQL
    const hasMyTable = await queryInterface.sequelize
      .query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'my_table');`, {
        transaction,
      })
      .then((result) => result[0]?.[0]?.exists || false);

    // 2. Only create if it doesn't exist
    if (!hasMyTable) {
      await queryInterface.createTable(
        "my_table",
        {
          id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
          name: { type: Sequelize.STRING(255), allowNull: false },
          email: { type: Sequelize.STRING(255), allowNull: true },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
        },
        { transaction },
      );
    }

    // 3. Now safe to add columns or constraints
    const columns = await queryInterface.describeTable("my_table", { transaction });
    if (!columns.status) {
      await queryInterface.addColumn("my_table", "status", {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: "active",
      }, { transaction });
    }

    // 4. Add indexes
    await queryInterface.addIndex("my_table", ["email"], { transaction });
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("my_table", { transaction }).catch(() => {});
  },
};
```

### Key Benefits:
- ✅ Clean separation: check existence → create → modify
- ✅ Safe re-runs: idempotent migrations
- ✅ Proper column validation: can safely add columns after checking
- ✅ Backward compatible: works with both new and existing databases

---

## Helper Functions (Optional)

For consistency, define helpers at the top of your migration:

```javascript
async function hasTable(queryInterface, tableName, transaction) {
  return queryInterface.sequelize
    .query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '${tableName}');`, {
      transaction,
    })
    .then((result) => result[0]?.[0]?.exists || false);
}

async function describeTable(queryInterface, tableName, transaction) {
  try {
    return await queryInterface.describeTable(tableName, { transaction });
  } catch {
    return {};
  }
}

// Usage:
if (!(await hasTable(queryInterface, "my_table", transaction))) {
  await queryInterface.createTable("my_table", { ... }, { transaction });
}
```

---

## Migration Index References

**Migrations Updated to use hasTable Pattern:**
- 022-seller-finance-ledger.js ✅

**Migrations Pending Update (using IF NOT EXISTS):**
- 000-core-commerce-foundation.js
- 017-order-flow-foundation.js
- 018-tax-credit-notes-and-invoice-filters.js
- 020-payment-manual-cod-webhook-idempotency.js
- 021-cod-payment-method-config.js
- 023-delivery-webhook-audit.js
- 025-delivery-verification.js
- 029-admin-commerce-settings.js
- 033-seller-organizations.js
- 040-cod-collections-return-settlement-lifecycle.js
- 041-item-return-payout-foundation.js
- 043-cron-runs-payout-cancellation.js
- 045-tax-document-sequences.js

---

## Testing Your Migration

1. **Fresh Database:**
   ```bash
   npm run migrate:fresh
   ```

2. **Idempotency Test (Re-run same migration):**
   ```bash
   npm run migrate:rollback
   npm run migrate:up
   ```

3. **Check Table Columns:**
   ```sql
   SELECT column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_name = 'my_table'
   ORDER BY ordinal_position;
   ```

---

## Common Pitfalls

❌ **Mixing raw SQL with Sequelize methods:**
```javascript
// Bad - inconsistent approach
await queryInterface.sequelize.query("CREATE TABLE IF NOT EXISTS ...");
await queryInterface.addColumn("table", "col", ...); // May fail
```

✅ **Use consistent approach:**
```javascript
// Good - all Sequelize methods
if (!(await hasTable(...))) {
  await queryInterface.createTable(...);
}
await queryInterface.addColumn(...);
```

❌ **Ignoring transaction parameter:**
```javascript
// Bad - bypasses transaction safety
await queryInterface.createTable("table", {...}); // Missing { transaction }
```

✅ **Always pass transaction:**
```javascript
// Good
await queryInterface.createTable("table", {...}, { transaction });
```

---

## Migration Rollback Strategy

Always implement proper `down()` function:

```javascript
async down({ queryInterface, transaction }) {
  // Reverse the up() operations in opposite order
  await queryInterface.dropTable("my_table", { transaction }).catch(() => {});
}
```

The `.catch(() => {})` ensures graceful handling if the table doesn't exist during rollback.
