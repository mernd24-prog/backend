# 🎯 Master Seed System - Architecture & Design

## Overview

The Master Seed System is a production-grade, modular database seeding framework for the enterprise ecommerce platform. It generates realistic, interconnected data suitable for QA, UAT, demo environments, and comprehensive marketplace testing.

## Architecture

### High-Level Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Master Seed Orchestrator                 │
│                  (master-seed.js)                           │
└─────────────┬───────────────────────────────────────────────┘
              │
    ┌─────────┼─────────┐
    │         │         │
    ▼         ▼         ▼
┌────────┐ ┌────────┐ ┌──────────────┐
│ Config │ │ Logger │ │ DB Connection│
│ (env)  │ │        │ │ Manager      │
└────────┘ └────────┘ └──────────────┘
    │         │         │
    │    ┌────┴─────────┘
    │    │
    ▼    ▼
┌─────────────────────────────────┐
│  Utility Layer                  │
├─────────────────────────────────┤
│ • DataGenerator                 │
│ • BatchProcessor                │
│ • ValidationEngine              │
│ • SeedLogger                    │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  Module Layer (26 modules)      │
├─────────────────────────────────┤
│ ✓ countries.seed.js             │
│ ✓ locations.seed.js             │
│ ✓ categories.seed.js            │
│ ✓ brands.seed.js                │
│ ✓ sellers.seed.js               │
│ ✓ products.seed.js              │
│ ... (20 more modules)           │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  Database Layer                 │
├─────────────────────────────────┤
│ PostgreSQL  │  MongoDB          │
│ Orders      │  Products         │
│ Payments    │  Sellers          │
│ Returns     │  Categories       │
│ Commissions │  Inventory        │
└─────────────────────────────────┘
```

## Module Classification

### Foundation Modules (No Dependencies)
- **Countries** - Single record for India + others
- **Attributes** - Product attribute definitions
- **Options** - Product option definitions
- **Tax Classes** - Tax classification rules

### Geographic Modules (Depend: Countries)
- **Locations** - States, cities, pincodes
- **Warehouses** - Warehouse locations

### Catalog Modules (Depend: Categories, Brands)
- **Categories** - Full hierarchy (100+ root)
- **Brands** - 1000+ brands
- **Product Families** - Product family groupings

### Compliance Modules (No Dependencies)
- **GST** - GST slab definitions
- **HSN** - HSN code mappings
- **Commissions** - Commission rules
- **Platform Fees** - Fee structures

### Business Modules (Depend: Locations, Categories)
- **Sellers** - 500+ sellers with KYC
- **Customers** - 10,000+ customers

### Product Modules (Depend: Sellers, Categories, Brands)
- **Products** - 10,000+ products
- **Variants** - Product variants
- **Inventory** - Stock management

### Transaction Modules (Depend: Products, Customers)
- **Orders** - 50,000+ orders
- **Reviews** - 100,000+ reviews

### Analytics Modules (Depend: Orders, Products)
- **Recommendations** - Product recommendations
- **Analytics** - User analytics data
- **Search** - Search indexing data

### Metadata Modules (Depend: Categories)
- **Collections** - Product collections
- **Badges** - Product badges
- **Tags** - Product tagging
- **Notifications** - Event notifications

## Data Model Integration

### PostgreSQL Tables

```sql
-- Core Entities
orders (id, buyer_id, order_number, status, total_amount)
order_items (id, order_id, product_id, quantity, price)
payments (id, order_id, provider, status, amount)
returns (id, order_id, status, refund_amount)

-- Financial
seller_commissions (seller_id, order_id, commission_amount)
seller_payouts (seller_id, status, net_amount)
wallet_transactions (user_id, type, amount)
wallets (user_id, available_balance)

-- Tax & Compliance
tax_invoices (order_id, gstin, tax_amount)
tax_ledger_entries (invoice_id, tax_component, amount)
gst_filings (period, total_tax, status)

-- RBAC
users
roles
permissions
modules
user_roles
role_permissions
```

### MongoDB Collections

```javascript
// Product Catalog
db.products
db.productVariants
db.categories
db.brands
db.platformBrands
db.platformProductOptions
db.productAttributes

// Business
db.sellers
db.sellerProfiles
db.customers (users with role=BUYER)
db.pickupAddresses

// Geographic
db.countries
db.states
db.cities
db.pincodes
db.warehouses

// Inventory
db.inventoryReservations
db.inventoryTransactions

// User Generated
db.reviews
db.ratings
db.carts
db.wishlists

// Recommendations
db.recommendations
db.relatedProducts

// Metadata
db.tags
db.badges
db.collections
db.searches

// Tax & Compliance
db.gstSlabs
db.hsnCodes
db.taxClasses

// Commerce
db.commissions
db.platformFees

// Analytics
db.analytics
db.notifications
```

## Data Flow & Relationships

### Category to Product Flow

```
Category (MongoDB)
  ├── Attributes (MongoDB)
  ├── Brand (FK to brands)
  ├── Tax Info (FK to HSN/GST)
  │
  └─► Product (MongoDB)
       ├── Seller (FK to sellers)
       ├── Category (FK to categories)
       ├── Brand (FK to brands)
       ├── Pricing (price, mrp, salePrice, costPrice)
       ├── Stock (stock, reservedStock)
       ├── Tax Snapshot (gst, hsn, tax class)
       ├── Variants[] (MongoDB)
       │   ├── SKU (unique per seller)
       │   ├── Attributes (size, color, etc.)
       │   ├── Images (variant-specific)
       │   ├── Stock (separate for each variant)
       │   └── Pricing (variant-specific)
       │
       └─► Order (PostgreSQL)
            ├── OrderItems[] (PostgreSQL)
            │   ├── Product Snapshot
            │   ├── Variant Reference
            │   ├── Quantity & Pricing
            │   ├── Tax Snapshot
            │   └── Commission Snapshot
            │
            ├── Payments[] (PostgreSQL)
            ├── Returns[] (PostgreSQL)
            └─► Reviews[] (MongoDB)
                 ├── Rating
                 ├── Verified Purchase
                 ├── Images/Videos
                 └── Helpful Votes
```

### Seller to Order Flow

```
Seller (MongoDB)
  ├── KYC (PostgreSQL)
  ├── Warehouses[]
  ├── PickupAddresses[]
  │
  └─► Products[]
       ├── Category
       ├── Brand
       ├── HSN/GST
       │
       └─► Orders (PostgreSQL)
            ├── Order Items
            ├── Commissions (PostgreSQL)
            ├── Payments
            │
            └─► Payouts (PostgreSQL)
                 ├── Gross Amount
                 ├── Commission Amount
                 ├── Tax Amount
                 └── Net Payout
```

### Customer to Order Flow

```
Customer (MongoDB)
  ├── Addresses[]
  │   └── City → Pincode → Serviceability
  │
  ├── Cart
  │   └── Items (Products with variants)
  │
  └─► Orders (PostgreSQL)
       ├── Shipping Address (from customer.addresses)
       ├── Order Items (from cart)
       │   ├── Product Data
       │   ├── Variant Data
       │   ├── Seller Info
       │   └── Pricing Snapshot
       │
       ├── Payments
       │   └── Payment Gateway Integration
       │
       ├── Inventory Transactions (MongoDB)
       │   ├── Reservation (on order creation)
       │   ├── Sale Commit (on payment)
       │   └── Release/Return (on cancellation/return)
       │
       └─► Reviews (MongoDB)
            ├── Product Rating
            ├── Verified Purchase
            └── Analytics Update
```

## Execution Flow

### Phase 1: Initialization
1. Parse command-line arguments
2. Load environment configuration
3. Establish database connections
4. Validate connectivity

### Phase 2: Data Reset (Optional)
1. Truncate PostgreSQL tables
2. Clear MongoDB collections
3. Reset sequences

### Phase 3: Seed Execution (Sequential)
1. Execute modules in dependency order
2. Generate realistic data
3. Validate references
4. Batch insert

### Phase 4: Verification
1. Validate all references
2. Check data integrity
3. Generate statistics
4. Log results

### Phase 5: Finalization
1. Disconnect databases
2. Print summary
3. Exit with status code

## Batch Processing Strategy

### Advantages
- **Memory Efficiency**: Process 1000 records at a time
- **Error Recovery**: Retry failed batches
- **Progress Tracking**: Monitor real-time progress
- **Transaction Safety**: Atomic batch operations

### Batch Configuration
```javascript
{
  batchSize: 1000,
  maxRetries: 3,
  retryDelay: 1000, // exponential backoff
  transactional: true
}
```

### Processing Example
```
Data: 100,000 records
Batch Size: 1000
Batches: 100
  Batch 1: Records 1-1000 ✓
  Batch 2: Records 1001-2000 ✓
  ...
  Batch 100: Records 99001-100000 ✓
```

## Data Quality Assurance

### Uniqueness Validation
- ✓ Unique SKU per seller
- ✓ Unique email addresses
- ✓ Unique order numbers
- ✓ Unique barcodes
- ✓ Unique GST numbers

### Referential Integrity
- ✓ All category IDs exist
- ✓ All seller IDs exist
- ✓ All brand IDs exist
- ✓ All product IDs exist
- ✓ All warehouse IDs exist

### No Orphan Records
- ✓ Every product has seller
- ✓ Every order has customer
- ✓ Every review has product
- ✓ Every order item has product
- ✓ Every variant has product

### Realistic Relationships
- Products distributed across categories
- Sellers assigned realistic categories
- Orders spread across time period
- Reviews correlated with orders
- Inventory balanced with stock levels

## Performance Characteristics

### Seed Times (Approximate)
```
Module              Time      Records
─────────────────────────────────────
Countries           5s        5
Locations           30s       9,000+
Categories          20s       5,500+
Brands              15s       1,000+
Attributes          10s       30
Options             5s        8
Sellers             20s       500
Warehouses          3s        15
Products            3-5m      10,000
Variants            2-3m      10,000
Customers           2m        10,000
Orders              2-3m      50,000
Reviews             4-5m      100,000
─────────────────────────────────────
Total Full Seed     ~20m      ~200,000
```

### Resource Usage
- **Memory**: 1-2GB
- **CPU**: 2-4 cores utilized
- **Disk I/O**: 500MB-1GB writes
- **Network**: Minimal (local databases)

## Configuration Management

### Environment Variables
```bash
DATABASE_URL=postgresql://user:pass@localhost/ecommerce
MONGODB_URI=mongodb://localhost:27017/ecommerce
LOG_LEVEL=info
NODE_ENV=development
```

### Configuration File
- Located: `scripts/seed/config.js`
- Centralized all seed parameters
- Override via environment variables

## Error Handling & Recovery

### Strategies
1. **Batch Retry**: Retry failed batches up to 3 times
2. **Continue on Error**: Skip failed records, continue
3. **Stop on Critical**: Exit if core modules fail
4. **Logging**: All errors logged with context

### Recovery Points
- Module-level checkpointing
- Transaction rollback on failure
- Resume capability for interrupted runs

## Extensibility

### Adding New Modules
1. Create file: `scripts/seed/modules/feature.seed.js`
2. Extend `QuickSeedModule` or implement interface
3. Add to `seedModules` map
4. Add to `fullSeedOrder` array
5. Test: `npm run seed:feature`

### Custom Data Generation
Extend `DataGenerator` class with custom methods:
```javascript
class CustomGenerator extends DataGenerator {
  static generateCustomData() { ... }
}
```

## Monitoring & Debugging

### Logging Levels
- **debug**: Detailed execution trace
- **info**: Standard operation logging
- **warn**: Warnings and non-critical issues
- **error**: Critical failures

### Output
- Console output (real-time progress)
- Log files: `scripts/seed/logs/`
- Statistics: Success/failure counts
- Duration: Total execution time

## Best Practices

### Do's ✓
- Use batch processing for large datasets
- Enable transaction support
- Validate data before insertion
- Log all operations
- Handle errors gracefully
- Test modules individually

### Don'ts ✗
- Don't process all data in memory
- Don't skip validation
- Don't ignore transaction failures
- Don't hardcode credentials
- Don't skip error logging
- Don't seed production directly

## Security Considerations

### Data Sanitization
- Hash passwords (if any)
- Validate email addresses
- Sanitize strings
- Escape special characters

### Access Control
- Use environment-specific credentials
- Rotate credentials regularly
- Restrict seed script access
- Audit seed executions

### Data Privacy
- No real personal data
- Randomized sensitive fields
- Compliant with GDPR/privacy laws
- No export of real data

## Future Enhancements

### Planned Features
- [ ] Kafka integration for event streaming
- [ ] Elasticsearch bulk indexing
- [ ] Multi-database support (MySQL, etc.)
- [ ] Distributed seeding across nodes
- [ ] Machine learning data generation
- [ ] Time-series data generation
- [ ] Load testing data profiles

## Conclusion

The Master Seed System provides a robust, scalable, and maintainable approach to database seeding for enterprise ecommerce platforms. Its modular architecture, comprehensive data generation, and production-grade features make it ideal for QA, UAT, demo, and testing environments.

For questions or contributions, refer to the README.md file or module documentation.
