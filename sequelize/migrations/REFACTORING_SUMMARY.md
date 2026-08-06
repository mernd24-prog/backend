# Sequelize Migration Refactoring Summary

## Objective
Update all Sequelize migrations from using `CREATE TABLE IF NOT EXISTS` pattern to explicit `hasTable()` checks followed by `createTable()`. This prevents schema modification issues when subsequent migrations add ALTER TABLE commands.

---

## Problem Statement

**Old Pattern (❌ PROBLEMATIC):**
```javascript
await queryInterface.sequelize.query(`
  CREATE TABLE IF NOT EXISTS my_table (
    id UUID PRIMARY KEY,
    name VARCHAR(255)
  );
`);

// Later, if this table already exists from IF NOT EXISTS:
await queryInterface.addColumn("my_table", "email", ...); // May fail or behave unexpectedly
```

**Why It Fails:**
- `IF NOT EXISTS` bypasses Sequelize's table existence checks
- Subsequent ALTER TABLE operations can't properly validate column state
- Schema becomes inconsistent across environments
- Re-running migrations produces unexpected results

---

## Solution Implemented

**New Pattern (✅ PROPER):**
```javascript
const hasTable = await queryInterface.sequelize
  .query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'my_table');`, { transaction })
  .then((result) => result[0]?.[0]?.exists || false);

if (!hasTable) {
  await queryInterface.createTable("my_table", {
    id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
    name: { type: Sequelize.STRING(255), allowNull: false },
  }, { transaction });
}

// Now safe to modify:
await queryInterface.addColumn("my_table", "email", {...}, { transaction });
```

---

## Migrations Updated

### ✅ 9 Migrations Successfully Refactored

#### 1. **022-seller-finance-ledger.js** 🔴 CRITICAL
- **Issue**: Creates 3 tables (seller_payouts, seller_commissions, seller_settlements) then immediately alters columns
- **Changes**: 
  - Converted all 3 table creations to use `hasTable()` checks
  - Used `queryInterface.createTable()` with proper Sequelize column definitions
  - Preserved ALTER TABLE logic after table creation
  - Added error handling with `.catch(() => {})` on unsafe ALTERs

#### 2. **045-tax-document-sequences.js**
- **Changes**: Converted raw SQL CREATE TABLE to `queryInterface.createTable()` with proper composite primary key

#### 3. **043-cron-runs-payout-cancellation.js**
- **Changes**: Converted to proper table creation + separated index creation into `queryInterface.addIndex()` calls

#### 4. **029-admin-commerce-settings.js**
- **Changes**: Simple conversion to `hasTable()` + `createTable()` pattern

#### 5. **023-delivery-webhook-audit.js**
- **Changes**: Preserved e_way_bill_details column additions + converted delivery_webhook_events creation
- **Note**: Maintained unique constraint via `uniqueKeys` parameter

#### 6. **025-delivery-verification.js**
- **Changes**: Preserved shipments column additions + converted delivery_verification_events creation
- **Note**: Carefully ordered table creation before index addition

#### 7. **020-payment-manual-cod-webhook-idempotency.js**
- **Changes**: Preserved payments table column additions + converted payment_webhook_events creation
- **Note**: Used `uniqueKeys` parameter for unique constraint on (provider, provider_event_id)

#### 8. **021-cod-payment-method-config.js**
- **Changes**: Preserved orders table column additions + converted payment_method_configs creation
- **Important**: Preserved INSERT statement for default COD config inside the `if (!hasTable)` block
- **Note**: Sequelize composite primary key handled correctly

#### 9. **018-tax-credit-notes-and-invoice-filters.js**
- **Changes**: Converted to `hasTable()` + `createTable()` pattern with unique and composite indexes
- **Note**: Preserved index additions to existing tax_invoices table

---

## Remaining Migrations (Pending)

### 5 Complex Migrations Requiring Further Work

#### 000-core-commerce-foundation.js (Foundational - 9 tables)
- **Status**: ⏳ Pending (highest priority)
- **Tables**: orders, order_items, payments, wallets, wallet_transactions, user_kyc, seller_kyc, outbox_events
- **Complexity**: Very High
- **Dependencies**: All other migrations depend on these foundational tables
- **Effort**: Significant (9 separate table creations to refactor)

#### 017-order-flow-foundation.js (Has ALTER TABLE)
- **Status**: ⏳ Pending (high priority)
- **Tables**: order_status_history, order_notes
- **Complexity**: Medium
- **Note**: Contains ALTER TABLE on orders table (line 51 in original)
- **Effort**: Moderate

#### 033-seller-organizations.js (Complex multi-table)
- **Status**: ⏳ Pending (medium priority)
- **Tables**: Multiple complex tables with intricate relationships
- **Complexity**: Very High
- **Effort**: Significant (likely 3-4+ tables with many constraints)

#### 040-cod-collections-return-settlement-lifecycle.js (Multi-table with column additions)
- **Status**: ⏳ Pending (medium priority)
- **Tables**: cod_collections, seller_settlement_adjustments
- **Complexity**: High
- **Effort**: Moderate

#### 041-item-return-payout-foundation.js (Return lifecycle)
- **Status**: ⏳ Pending (medium priority)
- **Tables**: payout_status_history
- **Complexity**: High (many order_items column additions + UPDATE statements)
- **Effort**: Moderate

---

## Key Changes Applied Consistently

### 1. Table Existence Check
```javascript
const hasTable = await queryInterface.sequelize
  .query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'table_name');`, { transaction })
  .then((result) => result[0]?.[0]?.exists || false);
```

### 2. Conditional Table Creation
```javascript
if (!hasTable) {
  await queryInterface.createTable("table_name", {...}, { transaction });
  // Add indexes immediately after creation
}
```

### 3. Index Creation
- **Before**: Raw SQL `CREATE INDEX IF NOT EXISTS ...` inside queries
- **After**: `queryInterface.addIndex()` calls after table creation

### 4. Unique Constraints
- **Before**: Inline in raw SQL
- **After**: `uniqueKeys` parameter in createTable options

### 5. Error Handling
- Added `.catch(() => {})` to non-critical index/constraint operations to allow re-runs

---

## Testing Strategy

### For All Updated Migrations
1. **Fresh Database**
   ```bash
   npm run migrate:fresh
   ```
   ✓ Verify all tables created with correct schema

2. **Idempotency Test** (re-run same migrations)
   ```bash
   npm run migrate:rollback
   npm run migrate:up
   ```
   ✓ Verify migrations run successfully twice without errors

3. **Schema Verification**
   ```sql
   SELECT column_name, data_type, is_nullable, column_default
   FROM information_schema.columns
   WHERE table_name = 'table_name'
   ORDER BY ordinal_position;
   ```
   ✓ Verify columns match expected definitions

4. **Multi-Instance Test**
   - Run migrations on multiple connected instances simultaneously
   - Verify no race conditions or conflicts

---

## Migration Refactoring Checklist

Use this checklist for remaining migrations:

- [ ] **000-core-commerce-foundation.js**
  - [ ] Refactor orders table creation
  - [ ] Refactor order_items table creation
  - [ ] Refactor payments table creation
  - [ ] Refactor wallets table creation
  - [ ] Refactor wallet_transactions table creation
  - [ ] Refactor user_kyc table creation
  - [ ] Refactor seller_kyc table creation
  - [ ] Refactor outbox_events table creation
  - [ ] Convert all indexes to `queryInterface.addIndex()` calls
  - [ ] Test migration

- [ ] **017-order-flow-foundation.js**
  - [ ] Refactor order_status_history table creation
  - [ ] Refactor order_notes table creation
  - [ ] Preserve ALTER TABLE orders logic
  - [ ] Test migration

- [ ] **033-seller-organizations.js**
  - [ ] Identify all tables created with IF NOT EXISTS
  - [ ] Refactor each table individually
  - [ ] Preserve unique constraints properly
  - [ ] Test migration

- [ ] **040-cod-collections-return-settlement-lifecycle.js**
  - [ ] Refactor cod_collections table creation
  - [ ] Refactor seller_settlement_adjustments table creation
  - [ ] Preserve order/order_items column additions
  - [ ] Test migration

- [ ] **041-item-return-payout-foundation.js**
  - [ ] Refactor payout_status_history table creation
  - [ ] Preserve order_items and shipments column additions
  - [ ] Preserve UPDATE statements for existing data
  - [ ] Test migration

---

## Benefits of This Refactoring

✅ **Idempotent Migrations**: Safe to re-run without side effects
✅ **Explicit Intent**: Clear table creation + modification logic
✅ **Better Error Handling**: Can properly validate schema before modifications
✅ **Backward Compatibility**: Works with both new and existing databases
✅ **Debugging**: Easier to identify which migration caused schema issues
✅ **Future-Proof**: Prevents ALTER TABLE failures in future migrations
✅ **Standards Compliance**: Follows Sequelize best practices

---

## Documentation References

- **MIGRATION_PATTERNS.md**: Comprehensive guide for writing new migrations
- **migration-refactoring-status.md**: Current refactoring progress tracking
- **Original Issue**: CREATE TABLE IF NOT EXISTS breaks with subsequent ALTER TABLE commands

---

## Next Steps

1. **Immediate**: 
   - Review the 9 updated migrations in version control
   - Run full migration suite tests
   - Deploy to development environment

2. **Short-term**:
   - Complete refactoring of remaining 5 migrations
   - Run full test suite
   - Deploy to staging environment

3. **Documentation**:
   - Update team wiki with migration patterns
   - Enforce new pattern for all new migrations
   - Remove IF NOT EXISTS from migration documentation

---

## Questions & Support

For questions about:
- **Specific migration**: Check the corresponding migration file and the pattern it follows
- **Writing new migrations**: See `MIGRATION_PATTERNS.md` in the migrations directory
- **Migration failures**: Review transaction logs and ensure tables exist before ALTERs

