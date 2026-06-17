#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const API_PREFIX = '/api/v1';
const COLLECTION_PATH = path.resolve('postman_collection.json');
const ROUTE_REGISTRY_PATH = path.resolve('src/api/register-routes.js');
const JSON_HEADER = { key: 'Content-Type', value: 'application/json' };
const FORM_HEADER = { key: 'Content-Type', value: 'multipart/form-data' };

const GROUP_NAMES = {
  '/auth': 'Auth',
  '/global': 'Global',
  '/users': 'Users',
  '/products': 'Products',
  '/carts': 'Cart',
  '/orders': 'Orders',
  '/cancellations': 'Cancellations',
  '/payments': 'Payments',
  '/platform': 'Platform',
  '/cms': 'CMS',
  '/sellers': 'Sellers',
  '/notifications': 'Notifications',
  '/analytics': 'Analytics',
  '/pricing': 'Pricing',
  '/coupons': 'Coupons',
  '/wallets': 'Wallet',
  '/admin/commerce-settings': 'Commerce Settings',
  '/admin': 'Admin',
  '/tax': 'Tax',
  '/subscriptions': 'Subscriptions',
  '/rbac': 'RBAC',
  '/warranty': 'Warranty',
  '/loyalty': 'Loyalty',
  '/recommendations': 'Recommendations',
  '/returns': 'Returns',
  '/fraud': 'Fraud',
  '/dynamic-pricing': 'Dynamic Pricing',
  '/sellers/commissions': 'Seller Commissions',
  '/admin/finance': 'Admin Finance',
  '/delivery': 'Delivery',
  '/deals': 'Deals',
  '/file-uploader': 'File Uploader',
  '/meta': 'Health & Meta',
  '/search': 'Search',
};

const PUBLIC_ENDPOINTS = new Set([
  'GET /health',
  'GET /api/v1/meta/routes',
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/register-otp',
  'POST /api/v1/auth/verify-registration',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/social',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/send-otp',
  'POST /api/v1/auth/verify-otp',
  'POST /api/v1/auth/resend-otp',
  'POST /api/v1/auth/forgot-password',
  'POST /api/v1/auth/reset-password',
  'POST /api/v1/payments/webhooks/razorpay',
  'GET /api/v1/products',
  'GET /api/v1/products/search',
  'GET /api/v1/products/:productId',
  'GET /api/v1/platform/categories',
  'GET /api/v1/cms',
  'GET /api/v1/cms/:slug',
  'GET /api/v1/recommendations/trending',
  'GET /api/v1/delivery/serviceability',
]);

const COLLECTION_VARIABLES = [
  ['baseUrl', 'http://localhost:4000'],
  ['accessToken', ''],
  ['refreshToken', ''],
  ['userId', ''],
  ['sellerId', ''],
  ['productId', ''],
  ['orderId', ''],
  ['paymentId', ''],
  ['returnId', ''],
  ['cancellationId', ''],
  ['moduleId', ''],
  ['permissionId', ''],
  ['roleId', ''],
  ['warehouseId', ''],
  ['shipmentId', ''],
  ['dealId', ''],
];

const SAMPLE_IDS = {
  userId: '{{userId}}',
  sellerId: '{{sellerId}}',
  productId: '{{productId}}',
  orderId: '{{orderId}}',
  paymentId: '{{paymentId}}',
  moduleId: '{{moduleId}}',
  permissionId: '{{permissionId}}',
  roleId: '{{roleId}}',
};

function sampleAddress() {
  return {
    line1: '221B MG Road',
    line2: 'Near Metro Station',
    city: 'Bengaluru',
    state: 'Karnataka',
    country: 'India',
    postalCode: '560001',
  };
}

function sampleProductBody() {
  return {
    title: 'Admin Sample Product',
    description: 'Detailed sample product description for API testing.',
    price: 999,
    mrp: 1299,
    category: 'electronics',
    stock: 25,
    productType: 'simple',
    gstInclusive: true,
    sku: 'SKU-POSTMAN-001',
    images: ['https://example.com/product.jpg'],
    status: 'draft',
  };
}

function sampleSellerProfileBody() {
  return {
    displayName: 'Demo Seller',
    businessName: 'Demo Seller Store',
    legalBusinessName: 'Demo Seller Private Limited',
    description: 'Seller profile updated from Postman.',
    supportEmail: 'seller@example.com',
    supportPhone: '9876543210',
    businessType: 'private_limited',
    gstNumber: '29ABCDE1234F1Z5',
    panNumber: 'ABCDE1234F',
    pickupAddress: sampleAddress(),
    businessAddress: sampleAddress(),
    returnAddress: sampleAddress(),
  };
}

function sampleSellerKycBody() {
  return {
    panNumber: 'ABCDE1234F',
    aadhaarNumber: '123412341234',
    legalName: 'Demo Seller Private Limited',
    businessType: 'private_limited',
    documents: {
      panDocumentUrl: 'https://example.com/pan.pdf',
      gstCertificateUrl: 'https://example.com/gst.pdf',
      bankProofUrl: 'https://example.com/bank.pdf',
    },
    bankDetails: {
      accountHolderName: 'Demo Seller',
      accountNumber: '1234567890',
      ifscCode: 'HDFC0001234',
      bankName: 'HDFC Bank',
      branchName: 'MG Road',
    },
  };
}

function sampleUserKycBody() {
  return {
    legalName: 'Postman Buyer',
    panNumber: 'ABCDE1234F',
    aadhaarNumber: '123412341234',
    documents: {
      panDocumentUrl: 'https://example.com/user-pan.pdf',
      aadhaarFrontUrl: 'https://example.com/aadhaar-front.pdf',
      aadhaarBackUrl: 'https://example.com/aadhaar-back.pdf',
      selfieUrl: 'https://example.com/selfie.jpg',
      addressProofUrl: 'https://example.com/address-proof.pdf',
    },
  };
}

function sampleUserAddressBody() {
  return {
    label: 'home',
    fullName: 'Postman Buyer',
    phone: '9876543210',
    line1: '221B MG Road',
    line2: 'Near Metro Station',
    city: 'Bengaluru',
    state: 'Karnataka',
    country: 'India',
    postalCode: '560001',
    isDefault: true,
  };
}

function sampleCartBody() {
  return {
    items: [
      {
        productId: SAMPLE_IDS.productId,
        variantId: null,
        variantSku: null,
        variantTitle: null,
        attributes: {},
        quantity: 1,
        price: 999,
      },
    ],
    wishlist: [],
  };
}

function sampleCmsPageBody() {
  return {
    slug: 'about-us',
    pageType: 'page',
    title: 'About Us',
    status: 'published',
    body: '<p>Sample CMS content for Postman.</p>',
    description: 'Sample CMS page description.',
    excerpt: 'Sample CMS excerpt.',
    category: 'static',
    tags: ['company'],
    image: { url: 'https://example.com/about.jpg', alt: 'About Us' },
    sections: [
      {
        type: 'content',
        title: 'Our Story',
        description: 'Sample section content.',
        sortOrder: 1,
      },
    ],
    seo: {
      metaTitle: 'About Us',
      metaDescription: 'Learn about the store.',
      keywords: ['about', 'company'],
      robots: 'index,follow',
    },
    visibility: { channels: ['web', 'app'], roles: ['public'] },
    sortOrder: 1,
    language: 'en',
    published: true,
    metadata: { source: 'postman' },
  };
}

function sampleCommerceSettingsBody() {
  return {
    productWorkflow: {
      moderationRevisionTiming: 'parallel',
      revisionDiffStatus: 'in_progress',
      notes: 'Updated from Postman.',
    },
    checkout: {
      figmaSignoffStatus: 'signed_off',
      figmaSignoffTargetDate: '2026-06-17',
      figmaSignoffDate: '2026-06-17',
      multiSellerOrderMode: 'single_order',
      multiSellerPolicyLocked: true,
    },
    payments: {
      razorpaySandboxStatus: 'available',
      razorpaySandboxTargetDate: '2026-06-18',
      razorpaySandboxKeyAvailable: true,
      gatewayFeePolicy: 'platform_absorbs',
    },
    cod: {
      availabilityMode: 'all_pincodes',
      allowPincodes: [],
      blockPincodes: [],
      collectionPolicy: 'platform_or_courier',
      payoutRequiresCapture: true,
    },
    wallet: {
      partialPaymentMode: 'user_opt_in',
      autoApplyMaxPercent: 20,
    },
    finance: {
      sellerPayoutBase: 'gross_customer_price',
      platformFeeTaxRate: 18,
      chargePlatformFeeTaxToSeller: true,
      payoutReleaseMilestone: 'delivered_or_fulfilled',
      payoutReleaseDaysAfterDelivery: 7,
      payoutSchedule: 'manual',
      payoutManualApprovalRequired: true,
      minimumPayoutAmount: 0,
      shippingPolicy: 'not_in_seller_payout',
    },
  };
}

function sampleModulePermissions() {
  return [
    { module: 'products', actions: ['view', 'create', 'update'] },
    { module: 'orders', actions: ['view'] },
  ];
}

function sampleCreateUserBody(role = 'sub-admin') {
  return {
    email: `${role.replace(/[^a-z0-9]/g, '')}@example.com`,
    phone: '9876543210',
    password: 'Password@123',
    profile: {
      firstName: 'Postman',
      lastName: 'User',
    },
    role,
    allowedModules: ['products', 'orders'],
    modulePermissions: sampleModulePermissions(),
  };
}

function sampleCommonBody(pathName) {
  if (pathName.includes('/countries')) {
    return { name: 'India', iso2: 'IN', iso3: 'IND', phoneCode: '+91', active: true };
  }
  if (pathName.includes('/states')) {
    return { countryId: '{{countryId}}', name: 'Karnataka', code: 'KA', active: true };
  }
  if (pathName.includes('/cities')) {
    return { stateId: '{{stateId}}', name: 'Bengaluru', active: true };
  }
  if (pathName.includes('/zip-codes')) {
    return { cityId: '{{cityId}}', zipCode: '560001', areaName: 'MG Road', active: true };
  }
  if (pathName.includes('/sub-taxes')) {
    return { taxId: '{{taxId}}', name: 'CGST', rate: 9, active: true };
  }
  if (pathName.includes('/tax-rules')) {
    return { name: 'Default GST Rule', taxId: '{{taxId}}', subTaxIds: ['{{subTaxId}}'], active: true };
  }
  if (pathName.includes('/taxes')) {
    return { name: 'GST 18%', rate: 18, type: 'gst', active: true };
  }
  return { name: 'Sample Record', active: true };
}

function samplePlatformBody(pathName) {
  if (pathName.includes('/categories')) {
    return {
      title: 'Electronics',
      categoryKey: 'electronics',
      parentKey: '',
      level: 1,
      active: true,
    };
  }
  if (pathName.includes('/brands')) {
    return { name: 'Demo Brand', slug: 'demo-brand', active: true };
  }
  if (pathName.includes('/product-families') || pathName.includes('/families')) {
    return { name: 'Smartphones', title: 'Smartphones', familyCode: 'smartphones', category: 'electronics', active: true };
  }
  if (pathName.includes('/product-variants') || pathName.includes('/variants')) {
    return { name: 'Size', code: 'size', values: ['S', 'M', 'L'], active: true };
  }
  if (pathName.includes('/hsn-codes')) {
    return { code: '851712', description: 'Mobile phones', gstRate: 18, active: true };
  }
  if (pathName.includes('/geography')) {
    return { countryCode: 'IN', countryName: 'India', currency: 'INR', active: true };
  }
  if (pathName.includes('/warranty-templates')) {
    return { name: 'One Year Warranty', period: 12, periodUnit: 'months', type: 'manufacturer', active: true };
  }
  if (pathName.includes('/finishes')) {
    return { name: 'Matte', slug: 'matte', active: true };
  }
  if (pathName.includes('/dimensions')) {
    return { name: 'Small Box', length: 10, width: 10, height: 10, unit: 'cm', active: true };
  }
  if (pathName.includes('/batches')) {
    return { name: 'Batch A', code: 'BATCH-A', active: true };
  }
  if (pathName.includes('/product-option-values')) {
    return { optionId: '{{optionId}}', name: 'Red', value: 'red', active: true };
  }
  if (pathName.includes('/product-options')) {
    return { name: 'Color', slug: 'color', displayType: 'color_swatch', active: true };
  }
  if (pathName.includes('/content-pages') || pathName.includes('/cms')) {
    return { title: 'About Us', slug: 'about-us', pageType: 'page', content: '<p>Sample content</p>', status: 'published' };
  }
  return { name: 'Sample Catalog Record', active: true };
}

function sampleBodyForRoute(route) {
  const method = route.method;
  const pathName = route.path;
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return null;
  if (pathName.includes('/webhooks/')) return { event: 'sample.event', payload: {} };
  if (pathName.includes('/file-uploader/upload')) return null;
  if (method === 'DELETE' && /\/:[^/]+$/.test(pathName)) return null;

  if (pathName.endsWith('/auth/register') || pathName.endsWith('/auth/register-otp')) {
    return {
      email: '{{userEmail}}',
      phone: '9876543210',
      password: '{{userPassword}}',
      role: 'buyer',
      profile: { firstName: 'Postman', lastName: 'Buyer' },
      referralCode: '',
    };
  }
  if (pathName.endsWith('/auth/verify-registration')) return { email: '{{userEmail}}', otp: '123456' };
  if (pathName.endsWith('/auth/login')) return { email: '{{userEmail}}', password: '{{userPassword}}' };
  if (pathName.endsWith('/auth/social')) {
    return { provider: 'google', idToken: 'google-or-firebase-id-token', email: '{{userEmail}}', role: 'buyer' };
  }
  if (pathName.endsWith('/auth/refresh')) return { refreshToken: '{{refreshToken}}' };
  if (pathName.endsWith('/auth/send-otp') || pathName.endsWith('/auth/resend-otp')) {
    return { email: '{{userEmail}}', purpose: 'registration' };
  }
  if (pathName.endsWith('/auth/verify-otp')) return { email: '{{userEmail}}', otp: '123456', purpose: 'registration' };
  if (pathName.endsWith('/auth/forgot-password')) return { email: '{{userEmail}}' };
  if (pathName.endsWith('/auth/reset-password')) return { email: '{{userEmail}}', otp: '123456', newPassword: 'NewPassword@123' };
  if (pathName.endsWith('/auth/change-password')) return { currentPassword: '{{userPassword}}', newPassword: 'NewPassword@123' };

  if (pathName.endsWith('/users/me')) return { profile: { firstName: 'Postman', lastName: 'Buyer', avatarUrl: '' } };
  if (pathName.endsWith('/users/me/kyc')) return sampleUserKycBody();
  if (pathName.endsWith('/users/me/kyc/documents')) return { documents: sampleUserKycBody().documents };
  if (pathName.includes('/users/') && pathName.includes('/kyc/review')) {
    return { verificationStatus: 'verified', rejectionReason: '' };
  }
  if (pathName.includes('/users/me/addresses')) return sampleUserAddressBody();

  if (pathName.includes('/products') && pathName.includes('/bulk/update')) {
    return { productIds: [SAMPLE_IDS.productId], status: 'active' };
  }
  if (pathName.includes('/products') && pathName.includes('/inventory')) {
    return { adjustmentType: 'add', quantity: 5, reason: 'stock_count_correction', note: 'Postman stock adjustment' };
  }
  if (pathName.includes('/products') && pathName.includes('/reject')) {
    return { rejectionReason: 'Product images are not clear', notes: 'Upload clearer images before approval' };
  }
  if (pathName.includes('/products') && (pathName.includes('/approve') || pathName.includes('/review') || pathName.includes('/moderate'))) {
    return { status: 'active', notes: 'Approved from Postman', checklist: { titleVerified: true, categoryVerified: true, complianceVerified: true, mediaVerified: true } };
  }
  if (pathName.includes('/products') && pathName.includes('/status')) {
    return { status: 'active', reason: 'Status updated from Postman' };
  }
  if (pathName.includes('/products') && pathName.includes('/archive')) return { reason: 'Archived from Postman' };
  if (pathName.includes('/products') && pathName.includes('/restore')) return { reason: 'Restored from Postman' };
  if (pathName.includes('/products') && pathName.includes('/duplicate')) return { title: 'Duplicated Product', sku: 'SKU-POSTMAN-COPY' };
  if (pathName.includes('/products') && (method === 'POST' || method === 'PATCH')) return sampleProductBody();

  if (pathName.includes('/sellers/onboarding/kyc') || pathName.includes('/sellers/me/kyc')) return sampleSellerKycBody();
  if (pathName.includes('/sellers/onboarding/profile') || pathName.includes('/sellers/me/profile')) return sampleSellerProfileBody();
  if (pathName.includes('/sellers/me/business-address') || pathName.includes('/sellers/me/pickup-address') || pathName.includes('/sellers/me/return-address')) return sampleAddress();
  if (pathName.includes('/sellers/me/bank-details')) {
    return { accountHolderName: 'Demo Seller', accountNumber: '1234567890', ifscCode: 'HDFC0001234', bankName: 'HDFC Bank', branchName: 'MG Road' };
  }
  if (pathName.includes('/sellers/me/more-info')) return { description: 'Updated seller information', supportEmail: 'seller@example.com', supportPhone: '9876543210' };
  if (pathName.includes('/sellers/me/settings')) {
    return { autoAcceptOrders: true, handlingTimeHours: 24, returnWindowDays: 7, payoutSchedule: 'weekly', shippingModes: ['standard'] };
  }
  if (pathName.includes('/sellers/me/charge-settings') || pathName.includes('/seller-charge-settings')) {
    return {
      cod: { enabled: true, chargeMode: 'flat', chargeAmount: 49, availabilityMode: 'all_pincodes' },
      delivery: { mode: 'free_over_amount', chargeAmount: 40, freeDeliveryMinOrderAmount: 999 },
      metadata: { source: 'postman' },
    };
  }
  if (pathName.includes('/sellers/me/sub-admins') && method === 'POST') return sampleCreateUserBody('seller-sub-admin');
  if (pathName.includes('/sellers/me/sub-admins') && pathName.includes('/modules')) {
    return { allowedModules: ['products', 'orders'], modulePermissions: sampleModulePermissions() };
  }
  if (pathName.includes('/sellers/me/sub-admins') && pathName.includes('/status')) return { accountStatus: 'active', status: 'active' };
  if (pathName.includes('/sellers/') && pathName.includes('/kyc/review')) return { verificationStatus: 'verified', rejectionReason: '' };

  if (pathName.includes('/orders/quote') || pathName.endsWith('/orders')) {
    return {
      currency: 'INR',
      paymentProvider: 'razorpay',
      idempotencyKey: 'postman-order-001',
      couponCode: '',
      walletAmount: 0,
      shippingAddress: sampleAddress(),
      items: [{ productId: SAMPLE_IDS.productId, variantId: null, variantSku: null, quantity: 1, attributes: {} }],
    };
  }
  if (pathName.includes('/orders/checkout/admin-quote')) {
    return {
      buyerId: SAMPLE_IDS.userId,
      currency: 'INR',
      paymentProvider: 'razorpay',
      idempotencyKey: 'postman-admin-order-001',
      couponCode: '',
      walletAmount: 0,
      shippingAddress: sampleAddress(),
      items: [{ productId: SAMPLE_IDS.productId, variantId: null, variantSku: null, quantity: 1, attributes: {} }],
    };
  }
  if (pathName.includes('/orders/') && pathName.includes('/cancel')) return { reason: 'Ordered by mistake', reasonCode: 'ordered_by_mistake', refundMethod: 'auto' };
  if (pathName.includes('/orders/') && pathName.includes('/status')) return { status: 'confirmed', note: 'Status updated from Postman' };
  if (pathName.includes('/orders/') && pathName.includes('/notes')) return { note: 'Internal admin note from Postman', visibility: 'internal' };

  if (pathName.includes('/carts/me')) return sampleCartBody();

  if (pathName.includes('/payments/initiate')) return { orderId: SAMPLE_IDS.orderId, provider: 'razorpay', currency: 'INR', idempotencyKey: 'postman-payment-001' };
  if (pathName.includes('/payments/verify')) {
    return { provider: 'razorpay', orderId: SAMPLE_IDS.orderId, razorpayOrderId: 'order_xxx', razorpayPaymentId: 'pay_xxx', razorpaySignature: 'signature_xxx' };
  }
  if (pathName.includes('/payments/admin/cod-config')) return { enabled: true, chargeAmount: 49, minOrderAmount: 0, maxOrderAmount: 10000, currency: 'INR', metadata: {} };
  if (pathName.includes('/payments/') && pathName.includes('/approve')) return { referenceId: 'MANUAL-PAY-001', reason: 'Payment verified manually' };
  if (pathName.includes('/payments/') && pathName.includes('/reject')) return { referenceId: 'MANUAL-PAY-001', reason: 'Payment proof invalid' };

  if (pathName.includes('/rbac/modules/reorder')) return { modules: [{ id: SAMPLE_IDS.moduleId, order: 1, parentModuleId: null }] };
  if (pathName.includes('/rbac/modules') && pathName.includes('/status')) return { status: 'active' };
  if (pathName.includes('/rbac/modules')) return { name: 'Postman Module', slug: 'postman-module', description: 'Created from Postman', moduleType: 'module', status: 'active' };
  if (pathName.includes('/rbac/permissions')) return { moduleId: SAMPLE_IDS.moduleId, name: 'Postman View', slug: 'postman-module:view', action: 'view', active: true };
  if (pathName.includes('/rbac/roles') && pathName.includes('/permissions/bulk')) return { permissionIds: [SAMPLE_IDS.permissionId] };
  if (pathName.includes('/rbac/roles') && pathName.includes('/permissions')) return { permissionId: SAMPLE_IDS.permissionId };
  if (pathName.includes('/rbac/roles')) return { name: 'Postman Role', slug: 'postman-role', type: 'custom', active: true };
  if (pathName.includes('/rbac/users') && pathName.includes('/permissions/bulk')) return { permissionIds: [SAMPLE_IDS.permissionId] };
  if (pathName.includes('/rbac/users') && pathName.includes('/permissions')) return method === 'PUT' ? { permissionIds: [SAMPLE_IDS.permissionId], deniedPermissionIds: [] } : { permissionId: SAMPLE_IDS.permissionId };
  if (pathName.includes('/rbac/users') && pathName.includes('/roles/bulk')) return { roleIds: [SAMPLE_IDS.roleId] };
  if (pathName.includes('/rbac/users') && pathName.includes('/roles')) return { roleId: SAMPLE_IDS.roleId };
  if (pathName.includes('/rbac/users') && pathName.includes('/copy-from')) return { sourceUserId: SAMPLE_IDS.userId, copyModules: true, copyPermissions: true, mergeMode: 'replace' };
  if (pathName.includes('/rbac/users') && pathName.includes('/apply-template')) return { templateSlug: 'seller-basic', mergeMode: 'merge' };
  if (pathName.includes('/rbac/users') && pathName.includes('/force-logout')) return {};
  if (pathName.includes('/rbac/templates')) return { slug: 'postman-template', name: 'Postman Template', permissionSlugs: ['products:view'], isActive: true };

  if (pathName.includes('/admin/access/admins') || pathName.includes('/admin/admin-users/admin')) return sampleCreateUserBody('admin');
  if (pathName.includes('/admin/access/sub-admins') || pathName.includes('/admin/admin-users/sub-admin')) return sampleCreateUserBody('sub-admin');
  if (pathName.includes('/admin/seller-users/seller-admin')) return sampleCreateUserBody('seller-admin');
  if (pathName.includes('/admin/seller-users/seller-sub-admin')) return sampleCreateUserBody('seller-sub-admin');
  if (pathName.includes('/admin/users') && method === 'POST') return sampleCreateUserBody('buyer');
  if (pathName.includes('/admin/users') || pathName.includes('/admin/admin-users')) return { profile: { firstName: 'Updated', lastName: 'User' }, accountStatus: 'active', allowedModules: ['products'] };
  if (pathName.includes('/admin/sellers') && pathName.includes('/kyc/status')) return { verificationStatus: 'verified', rejectionReason: '' };
  if (pathName.includes('/admin/sellers') && pathName.includes('/bank/status')) return { status: 'verified', reason: '' };
  if (pathName.includes('/admin/sellers') && pathName.includes('/onboarding/status')) return { onboardingStatus: 'ready_for_go_live', note: 'Ready for go live' };
  if (pathName.includes('/admin/sellers') && pathName.includes('/go-live')) return { goLiveStatus: 'live', note: 'Approved for live selling' };
  if (pathName.includes('/admin/sellers') && pathName.includes('/status')) return { accountStatus: 'active', reason: 'Admin status update' };
  if (pathName.endsWith('/admin/payouts')) {
    return {
      sellerId: SAMPLE_IDS.sellerId,
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      grossAmount: 1000,
      commissionAmount: 100,
      processingFeeAmount: 0,
      taxWithheldAmount: 10,
      netPayoutAmount: 890,
      currency: 'INR',
      status: 'scheduled',
      scheduledAt: '2026-07-01T10:00:00.000Z',
      metadata: { source: 'postman' },
    };
  }
  if (pathName.includes('/admin/system/queues')) return {};
  if (pathName.includes('/admin/system/dead-letter') && pathName.includes('/discard')) return { reason: 'Discarded after manual review' };
  if (pathName.includes('/admin/cms')) return sampleCmsPageBody();
  if (pathName.endsWith('/admin/commerce-settings')) return sampleCommerceSettingsBody();

  if (pathName.includes('/admin/common') || pathName.includes('/global')) {
    if (method === 'DELETE' && !/\/:[^/]+$/.test(pathName)) return { ids: ['{{recordId}}'] };
    if (pathName.includes('/status')) return { ids: ['{{recordId}}'], isDisable: false };
    return sampleCommonBody(pathName);
  }

  if (pathName.includes('/platform') && !pathName.includes('/api-keys') && !pathName.includes('/webhooks') && !pathName.includes('/feature-flags')) return samplePlatformBody(pathName);
  if (pathName.includes('/api-keys')) return { name: 'Postman API Key', scopes: ['orders:read'], active: true };
  if (pathName.includes('/webhooks')) return { url: 'https://example.com/webhook', events: ['order.created'], active: true };
  if (pathName.includes('/feature-flags')) return { key: 'postman_feature', enabled: true, rollout: 100 };

  if (pathName.includes('/admin/inventory/warehouses')) {
    if (pathName.includes('/status')) return { ids: ['{{warehouseId}}'], isDisable: false };
    if (method === 'DELETE' && !/\/:[^/]+$/.test(pathName)) return { ids: ['{{warehouseId}}'] };
    return { name: 'Main Warehouse', code: 'WH-001', address: sampleAddress(), active: true };
  }
  if (pathName.includes('/release-expired')) return { olderThanMinutes: 30 };

  if (pathName.includes('/admin/shipping/packages')) {
    if (pathName.includes('/status')) return { ids: ['{{packageId}}'], isDisable: false };
    if (method === 'DELETE' && !/\/:[^/]+$/.test(pathName)) return { ids: ['{{packageId}}'] };
    return { name: 'Small Package', length: 10, width: 10, height: 10, weight: 1, active: true };
  }
  if (pathName.includes('/admin/shipping/pickup-addresses')) {
    if (pathName.includes('/status')) return { ids: ['{{pickupAddressId}}'], isDisable: false };
    if (method === 'DELETE' && !/\/:[^/]+$/.test(pathName)) return { ids: ['{{pickupAddressId}}'] };
    return { name: 'Primary Pickup', contactName: 'Warehouse Manager', phone: '9876543210', address: sampleAddress(), active: true };
  }

  if (pathName.includes('/returns')) {
    if (pathName.endsWith('/returns')) return { orderId: SAMPLE_IDS.orderId, reason: 'defective', description: 'Item arrived damaged', items: [{ orderItemId: '{{orderItemId}}', quantity: 1 }] };
    if (pathName.includes('/approve')) return { refundAmount: 999, note: 'Approved after inspection' };
    if (pathName.includes('/reject')) return { reason: 'Return window expired' };
    if (pathName.includes('/schedule')) return { pickupDate: '2026-06-20', carrierName: 'Manual Courier' };
    if (pathName.includes('/ship-back')) return { trackingNumber: 'TRK123456' };
    if (pathName.includes('/tracking')) return { status: 'in_transit', note: 'Package in transit' };
    if (pathName.includes('/receive')) return { receivedAt: '2026-06-20T10:00:00.000Z', note: 'Received at warehouse' };
    if (pathName.includes('/qc')) return { passed: true, notes: 'QC passed' };
    if (pathName.includes('/refund')) return { refundMethod: 'original_source', note: 'Refund from Postman' };
    if (pathName.includes('/replacement')) return { replacementProductId: SAMPLE_IDS.productId, note: 'Replacement created' };
    if (pathName.includes('/close')) return { reason: 'Resolved', note: 'Return closed' };
  }

  if (pathName.includes('/cancellations')) {
    if (pathName.includes('/manual-refund')) return { referenceId: 'REFUND-001', note: 'Manual refund completed' };
    return { note: 'Retry cancellation recovery' };
  }

  if (pathName.includes('/delivery/agents')) return { name: 'Delivery Agent', phone: '9876543210', email: 'agent@example.com', active: true };
  if (pathName.includes('/delivery/shipments') && pathName.includes('/assign-agent')) return { deliveryAgentId: '{{deliveryAgentId}}' };
  if (pathName.includes('/delivery/shipments') && pathName.includes('/tracking')) return { status: 'in_transit', location: 'Bengaluru', note: 'Updated from Postman' };
  if (pathName.includes('/delivery/shipments') && pathName.includes('/delivery-otp')) return { channel: 'sms' };
  if (pathName.includes('/delivery/shipments') && pathName.includes('/confirm-delivery')) return { otp: '123456', deliveredTo: 'Customer' };
  if (pathName.includes('/delivery/shipments')) return { orderId: SAMPLE_IDS.orderId, carrierName: 'Manual Courier', serviceType: 'standard' };
  if (pathName.includes('/delivery/manifests')) return { shipmentIds: ['{{shipmentId}}'], manifestDate: '2026-06-20' };
  if (pathName.includes('/eway-bill')) return { ewayBillNumber: 'EWB123456789', status: 'generated' };

  if (pathName.includes('/tax/orders') && pathName.includes('/marketplace-invoices')) return {};
  if (pathName.includes('/tax/orders') && pathName.includes('/invoice')) return { forceRegenerate: false };
  if (pathName.includes('/tax/credit-notes')) return { invoiceId: '{{invoiceId}}', reason: 'Return refund', amount: 999 };
  if (pathName.includes('/tax/') && pathName.includes('/dispatch')) return { channel: 'email', recipientEmail: 'customer@example.com' };
  if (pathName.includes('/tax/document-dispatches') && pathName.includes('/retry')) return { note: 'Retry document dispatch' };

  if (pathName.includes('/subscriptions') && pathName.includes('/purchase')) return { planId: '{{planId}}', paymentProvider: 'razorpay' };
  if (pathName.includes('/subscriptions') && (pathName.includes('/pause') || pathName.includes('/resume') || pathName.includes('/cancel'))) return { reason: 'Requested from Postman' };
  if (pathName.includes('/subscriptions') && pathName.includes('/plans')) return { name: 'Gold Plan', price: 999, billingCycle: 'monthly', active: true };
  if (pathName.includes('/subscriptions') && pathName.includes('/platform-fee-config')) return { category: 'default', feePercent: 10, active: true };
  if (pathName.includes('/subscriptions') && pathName.includes('/status')) return { status: 'active', reason: 'Admin update' };

  if (pathName.includes('/admin/finance/commission-rules')) return { name: 'Default Commission', category: 'default', commissionType: 'percentage', commissionValue: 10, active: true };
  if (pathName.includes('/admin/finance/platform-fee-rules')) return { name: 'Default Platform Fee', category: 'default', feeType: 'percentage', feeValue: 5, active: true };
  if (pathName.includes('/sellers/commissions')) {
    if (pathName.includes('/fail')) return { reason: 'Bank rejected payout' };
    if (pathName.includes('/hold')) return { reason: 'Verification pending' };
    if (pathName.includes('/release-hold')) return { note: 'Hold released' };
    if (pathName.includes('/resolve')) return { resolutionNote: 'Negative balance resolved' };
    return { referenceId: 'PAYOUT-REF-001', note: 'Processed from Postman' };
  }

  if (pathName.includes('/admin/referral')) {
    if (pathName.includes('/rules')) return { commissionType: 'percentage', commissionValue: 5, active: true };
    if (pathName.includes('/codes')) return { code: 'POSTMAN10', influencerId: '{{influencerId}}', active: true };
    if (pathName.includes('/payouts')) return { note: 'Referral payout action from Postman' };
    return { name: 'Demo Influencer', email: 'influencer@example.com', phone: '9876543210', status: 'active' };
  }

  if (pathName.includes('/deals')) {
    if (pathName.includes('/commission-rule')) return { commissionType: 'percentage', commissionValue: 12 };
    if (pathName.includes('/sponsorship')) return { placement: 'home_top', budget: 5000, startsAt: '2026-06-20T00:00:00.000Z', endsAt: '2026-06-30T00:00:00.000Z' };
    if (pathName.includes('/payouts')) return { fromDate: '2026-06-01', toDate: '2026-06-30' };
    if (pathName.includes('/reject')) return { reason: 'Deal does not meet policy' };
    if (pathName.match(/\/(submit|approve|pause|resume|cancel)$/)) return { note: 'Deal workflow action from Postman' };
    return { title: 'Postman Deal', sellerId: SAMPLE_IDS.sellerId, productIds: [SAMPLE_IDS.productId], startsAt: '2026-06-20T00:00:00.000Z', endsAt: '2026-06-30T00:00:00.000Z', status: 'draft' };
  }

  if (pathName.includes('/notifications/preferences')) return { channels: { email: true, sms: false, push: true }, frequency: 'real_time' };
  if (pathName.includes('/notifications')) return { title: 'Postman Notification', message: 'Hello from Postman', targetType: 'all' };
  if (pathName.includes('/analytics/events')) return { eventType: 'page_view', entityType: 'product', entityId: SAMPLE_IDS.productId, metadata: { source: 'postman' } };
  if (pathName.includes('/loyalty/points')) return { points: 100, reason: 'Manual adjustment', transactionId: 'POSTMAN-LOYALTY-001' };
  if (pathName.includes('/loyalty/redeem')) return { points: 50 };
  if (pathName.includes('/recommendations') && pathName.includes('/interact')) return { interactionType: 'click' };
  if (pathName.includes('/search')) return { scope: 'all' };
  if (pathName.includes('/fraud')) return { status: 'reviewed', decision: 'clear', notes: 'Reviewed from Postman' };
  if (pathName.includes('/warranty/register')) return { orderId: SAMPLE_IDS.orderId, productId: SAMPLE_IDS.productId, serialNumber: 'SN123456' };
  if (pathName.includes('/warranty') && pathName.includes('/claims')) return pathName.includes('/status') ? { status: 'approved', note: 'Claim approved' } : { reason: 'Product not working', description: 'Warranty claim from Postman' };
  if (pathName.includes('/pricing/coupons') || pathName.includes('/coupons/coupons')) return { code: 'POSTMAN10', type: 'percentage', value: 10, active: true };
  if (pathName.includes('/promotion-banners')) return { title: 'Postman Banner', slug: 'postman-banner', pageType: 'promotion-banner', content: '<p>Banner</p>', status: 'published' };
  if (pathName.includes('/dynamic-pricing/adjust')) return { productId: SAMPLE_IDS.productId, adjustmentType: 'percentage', value: 10 };
  if (pathName.includes('/wallets')) return { note: 'Wallet action sample' };

  if (pathName.includes('/status')) return { status: 'active', reason: 'Updated from Postman' };
  if (pathName.includes('/approve')) return { reason: 'Approved from Postman', referenceId: 'APPROVAL-001' };
  if (pathName.includes('/reject')) return { reason: 'Rejected from Postman' };
  if (pathName.includes('/retry')) return { note: 'Retry from Postman' };
  if (method === 'DELETE' && !/\/:[^/]+$/.test(pathName)) return { ids: ['{{recordId}}'] };
  return { note: 'Sample request body. Confirm exact fields in the matching validation file.' };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toRequirePath(fromFile, requirePath) {
  const withExtension = requirePath.endsWith('.js') ? requirePath : `${requirePath}.js`;
  return path.normalize(path.resolve(path.dirname(fromFile), withExtension));
}

function parseImports(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const imports = new Map();
  const importRegex = /const\s+(?:\{\s*(\w+)\s*,?\s*\}|(\w+))\s*=\s*require\(["']([^"']+)["']\)/g;

  for (const match of source.matchAll(importRegex)) {
    imports.set(match[1] || match[2], toRequirePath(filePath, match[3]));
  }

  return { source, imports };
}

function parseRouteRegistry() {
  const { source, imports } = parseImports(ROUTE_REGISTRY_PATH);

  const mounts = [];
  const mountRegex = /app\.use\(\s*`\$\{env\.apiPrefix\}([^`]+)`\s*,\s*([A-Za-z_$][\w$]*)/;
  for (const line of source.split('\n')) {
    const match = line.match(mountRegex);
    if (match) {
      mounts.push({
        basePath: match[1],
        exportName: match[2],
        filePath: imports.get(match[2]),
      });
    }
  }
  if (!mounts.length) {
    throw new Error(`No route mounts discovered from ${ROUTE_REGISTRY_PATH}`);
  }
  return mounts;
}

function parseRouteFile(filePath, basePath = '', visited = new Set()) {
  const visitKey = `${filePath}:${basePath}`;
  if (visited.has(visitKey)) return [];
  visited.add(visitKey);

  const { source, imports } = parseImports(filePath);
  const routeRegex = /\b\w+(?:Routes|Router)?\.(get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\2/gi;
  const useRegex = /\b\w+(?:Routes|Router)?\.use\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*([A-Za-z_$][\w$]*)/gi;
  const routes = [];
  for (const match of source.matchAll(routeRegex)) {
    routes.push({ method: match[1].toUpperCase(), path: joinPaths(basePath, match[3]) });
  }
  for (const match of source.matchAll(useRegex)) {
    const childPath = imports.get(match[3]);
    if (!childPath || !fs.existsSync(childPath)) continue;
    routes.push(...parseRouteFile(childPath, joinPaths(basePath, match[2]), visited));
  }
  return routes;
}

function discoverRoutes() {
  const routes = [{ group: 'Health & Meta', method: 'GET', path: '/health' }];
  for (const mount of parseRouteRegistry()) {
    if (!mount.filePath || !fs.existsSync(mount.filePath)) {
      process.stderr.write(`Skipping route mount without readable file: ${mount.exportName}\n`);
      continue;
    }
    for (const route of parseRouteFile(mount.filePath)) {
      routes.push({
        group: GROUP_NAMES[mount.basePath] || titleFromBasePath(mount.basePath),
        method: route.method,
        path: `${API_PREFIX}${joinPaths(mount.basePath, route.path)}`,
      });
    }
  }
  return dedupe(routes);
}

function joinPaths(...parts) {
  const joined = parts
    .filter((part) => part !== undefined && part !== null && String(part) !== '')
    .map((part) => String(part).replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return joined ? `/${joined}` : '';
}

function dedupe(routes) {
  const seen = new Set();
  return routes.filter((route) => {
    const key = routeKey(route);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function routeKey(route) {
  return `${route.method} ${route.path}`;
}

function rawUrlFromRequest(request) {
  if (!request?.url) return '';
  return typeof request.url === 'string' ? request.url : request.url.raw;
}

function requestKey(item) {
  if (!item.request) return null;
  const rawUrl = rawUrlFromRequest(item.request);
  return `${item.request.method} ${String(rawUrl).replace('{{baseUrl}}', '')}`;
}

function ensureCollectionVariables(collection) {
  const existing = new Map((collection.variable || []).map((item) => [item.key, item]));
  collection.variable = collection.variable || [];
  for (const [key, value] of COLLECTION_VARIABLES) {
    if (existing.has(key)) continue;
    collection.variable.push({ key, value, type: 'string' });
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function headerIndex(headers = [], key) {
  return headers.findIndex((header) => String(header.key || '').toLowerCase() === key.toLowerCase());
}

function setHeader(request, header) {
  request.header = Array.isArray(request.header) ? request.header : [];
  const index = headerIndex(request.header, header.key);
  if (index === -1) request.header.push(clone(header));
  else request.header[index] = { ...request.header[index], ...header };
}

function removeHeader(request, key) {
  request.header = (request.header || []).filter((header) => String(header.key || '').toLowerCase() !== key.toLowerCase());
}

function setBearerAuth(request, route) {
  removeHeader(request, 'Authorization');
  const key = routeKey(route);
  if (PUBLIC_ENDPOINTS.has(key)) {
    delete request.auth;
    return;
  }
  request.auth = {
    type: 'bearer',
    bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }],
  };
}

function makeResponseBody(route) {
  const key = routeKey(route);
  if (key === 'POST /api/v1/auth/login' || key === 'POST /api/v1/auth/refresh') {
    return {
      success: true,
      data: {
        user: {
          id: '{{userId}}',
          email: '{{userEmail}}',
          role: 'admin',
          allowedModules: ['admin', 'products', 'orders'],
          effectivePermissions: ['products:view', 'orders:view'],
        },
        tokens: {
          accessToken: '{{accessToken}}',
          refreshToken: '{{refreshToken}}',
        },
        flowState: {
          requiresOnboarding: false,
        },
      },
    };
  }
  if (route.method === 'GET') {
    return {
      success: true,
      data: route.path.includes('/:') ? { id: '{{resourceId}}', status: 'active' } : [],
      meta: { total: 0, page: 1, limit: 20 },
    };
  }
  if (route.method === 'DELETE') {
    return {
      success: true,
      data: { deleted: true },
      message: 'Deleted successfully',
    };
  }
  return {
    success: true,
    data: {
      id: '{{resourceId}}',
      status: route.path.includes('/reject') ? 'rejected' : 'active',
    },
    message: route.method === 'POST' ? 'Created successfully' : 'Updated successfully',
  };
}

function makeErrorBody() {
  return {
    success: false,
    message: 'Validation failed',
    code: 'VALIDATION_ERROR',
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: {
        fields: [
          { field: 'fieldName', message: 'fieldName is required' },
        ],
      },
    },
  };
}

function makePostmanResponse(route, item, code, name, body) {
  const originalRequest = clone(item.request);
  return {
    name,
    originalRequest,
    status: code >= 400 ? 'Bad Request' : code === 201 ? 'Created' : 'OK',
    code,
    _postman_previewlanguage: 'json',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: JSON.stringify(body, null, 2),
  };
}

function isMultipartRoute(route) {
  return route.path.includes('/file-uploader/upload');
}

function setJsonBody(request, body) {
  request.body = {
    mode: 'raw',
    raw: JSON.stringify(body, null, 2),
    options: {
      raw: {
        language: 'json',
      },
    },
  };
  setHeader(request, JSON_HEADER);
}

function setMultipartBody(request, route) {
  request.body = {
    mode: 'formdata',
    formdata: [
      { key: 'file', type: 'file', src: [] },
      { key: 'module', value: route.path.includes('document') ? 'seller-kyc' : 'products', type: 'text' },
      {
        key: route.path.includes('document') ? 'documentKey' : 'imageType',
        value: route.path.includes('document') ? 'panDocumentUrl' : 'gallery',
        type: 'text',
      },
    ],
  };
  setHeader(request, FORM_HEADER);
}

function enrichRequestItem(item, route) {
  item.name = routeKey(route);
  item.request = item.request || {};
  item.request.method = route.method;
  item.request.header = Array.isArray(item.request.header) ? item.request.header : [];
  setBearerAuth(item.request, route);

  const body = sampleBodyForRoute(route);
  if (isMultipartRoute(route)) {
    setMultipartBody(item.request, route);
  } else if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method)) {
    setJsonBody(item.request, body);
  } else {
    delete item.request.body;
    removeHeader(item.request, 'Content-Type');
  }

  const successCode = route.method === 'POST' ? 201 : 200;
  item.response = [
    makePostmanResponse(route, item, successCode, `${successCode} Success example`, makeResponseBody(route)),
    makePostmanResponse(route, item, 400, '400 Validation error example', makeErrorBody()),
  ];
  return item;
}

function collectRequestKeys(collection) {
  const keys = new Set();
  const visit = (items = []) => {
    for (const item of items) {
      const key = requestKey(item);
      if (key) keys.add(key);
      if (item.item) visit(item.item);
    }
  };
  visit(collection.item);
  return keys;
}

function findOrCreateFolder(collection, name) {
  let folder = collection.item.find((item) => item.name === name && Array.isArray(item.item));
  if (!folder) {
    folder = { name, item: [] };
    collection.item.push(folder);
  }
  return folder;
}

function createRequestItem(route) {
  const key = routeKey(route);
  const item = {
    name: key,
    request: {
      method: route.method,
      header: [],
      url: `{{baseUrl}}${route.path}`,
    },
    response: [],
  };

  return enrichRequestItem(item, route);
}

function titleFromBasePath(basePath) {
  return basePath
    .split('/')
    .filter(Boolean)
    .map((part) => part.replace(/-/g, ' '))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function main() {
  const collection = readJson(COLLECTION_PATH);
  const discovered = discoverRoutes();
  ensureCollectionVariables(collection);
  const existingKeys = collectRequestKeys(collection);
  const routeKeys = new Set(discovered.map(routeKey));
  const routeByKey = new Map(discovered.map((route) => [routeKey(route), route]));
  const added = [];
  let enriched = 0;
  let removed = 0;

  const enrichExisting = (items = []) => {
    for (const item of items) {
      if (item.item) {
        enrichExisting(item.item);
        continue;
      }
      const key = requestKey(item);
      const route = routeByKey.get(key);
      if (!route) continue;
      enrichRequestItem(item, route);
      enriched += 1;
    }
  };

  enrichExisting(collection.item);

  const pruneUnregistered = (items = []) => {
    const kept = [];
    for (const item of items) {
      if (item.item) {
        item.item = pruneUnregistered(item.item);
        kept.push(item);
        continue;
      }
      const key = requestKey(item);
      if (key && !routeKeys.has(key)) {
        removed += 1;
        continue;
      }
      kept.push(item);
    }
    return kept;
  };

  collection.item = pruneUnregistered(collection.item);
  const currentKeys = collectRequestKeys(collection);

  for (const route of discovered) {
    const key = routeKey(route);
    if (currentKeys.has(key)) continue;
    findOrCreateFolder(collection, route.group).item.push(createRequestItem(route));
    currentKeys.add(key);
    added.push(key);
  }

  fs.writeFileSync(COLLECTION_PATH, `${JSON.stringify(collection, null, 2)}\n`);
  process.stdout.write(`Discovered ${discovered.length} API requests.\n`);
  process.stdout.write(`Enriched ${enriched} existing Postman request${enriched === 1 ? '' : 's'} with auth, sample body, and example responses.\n`);
  process.stdout.write(`Added ${added.length} missing Postman request${added.length === 1 ? '' : 's'}.\n`);
  process.stdout.write(`Removed ${removed} stale Postman request${removed === 1 ? '' : 's'} not found in registered routes.\n`);

  const finalKeys = collectRequestKeys(collection);
  const extra = [...finalKeys].filter((key) => !routeKeys.has(key)).sort();
  if (extra.length) {
    process.stdout.write(`Collection requests not found in registered routes: ${extra.length}\n`);
  }
}

main();
