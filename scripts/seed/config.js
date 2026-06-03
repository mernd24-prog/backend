/**
 * Seed System Configuration
 * Central configuration for all seed modules
 */

module.exports = {
  // Database Configuration
  database: {
    postgresql: {
      connectionString: process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/ecommerce',
      maxPoolSize: 10,
      logging: process.env.LOG_LEVEL === 'debug',
    },
    mongodb: {
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce',
      options: {
        maxPoolSize: 10,
        autoIndex: false,
      },
    },
  },

  // Seed Configuration
  seed: {
    // Batch Processing
    batchSize: 1000,
    maxRetries: 3,
    retryDelay: 1000, // milliseconds

    // Data Generation
    dataGeneration: {
      productsCount: 10000,
      customersCount: 10000,
      ordersCount: 50000,
      reviewsCount: 100000,
      sellersCount: 500,
      warehousesCount: 15,
    },

    // Geographic Data
    locations: {
      countryCode: 'IN',
      generateAllStates: true,
      generateCities: true,
      pincodesPerCity: 10, // Average pincodes per city
    },

    // Catalog Data
    categories: {
      rootCategories: 100,
      subcategoriesPerRoot: 50,
      childCategoriesPerSub: 15,
    },

    brands: {
      globalBrands: 100,
      indianBrands: 150,
      privateLabelBrands: 100,
      marketplaceBrands: 50,
    },

    // Tax & Compliance
    tax: {
      gstSlabs: [0, 5, 12, 18, 28],
      hsnCodesPerCategory: 5,
      taxClassesCount: 5,
    },

    // Commerce Data
    sellers: {
      businessTypes: ['Individual', 'Partnership', 'Company', 'LLP'],
      verificationStatus: 'VERIFIED',
      kycRequired: true,
    },

    products: {
      variantsPerProduct: 5, // Average
      imagesPerProduct: 4,
      attributesPerCategory: 8,
    },

    customers: {
      addressesPerCustomer: 3,
      verificationRequired: true,
    },

    orders: {
      orderStatuses: ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'],
      itemsPerOrder: 3,
      paymentMethods: ['CREDIT_CARD', 'DEBIT_CARD', 'UPI', 'NET_BANKING', 'COD'],
    },

    reviews: {
      ratingDistribution: {
        5: 0.40, // 40%
        4: 0.30, // 30%
        3: 0.15, // 15%
        2: 0.10, // 10%
        1: 0.05, // 5%
      },
    },
  },

  // Feature Flags
  features: {
    generateInventoryLedger: true,
    generateCommissions: true,
    generateAnalytics: true,
    generateRecommendations: true,
    enableTransactions: true,
    enableValidation: true,
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: 'json', // 'json' or 'pretty'
    logToFile: true,
    logDir: './scripts/seed/logs',
  },

  // Performance
  performance: {
    enableBatching: true,
    enableStreaming: false,
    enableCaching: true,
    enableCompression: false,
    connectionPoolSize: 10,
  },

  // Validation
  validation: {
    validateBeforeInsert: true,
    validateReferences: true,
    validateUniqueness: true,
    validateDataTypes: true,
  },

  // Seed Order (with dependencies)
  seedOrder: [
    'countries',
    'locations',
    'categories',
    'brands',
    'attributes',
    'options',
    'families',
    'gst',
    'hsn',
    'tax-classes',
    'commissions',
    'platform-fees',
    'badges',
    'tags',
    'collections',
    'sellers',
    'warehouses',
    'products',
    'variants',
    'inventory',
    'customers',
    'orders',
    'reviews',
    'recommendations',
    'analytics',
    'search',
    'notifications',
  ],
};
