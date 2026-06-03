const { env } = require("../config/env");
const { authRoutes } = require("../modules/auth/routes/auth.routes");
const { userRoutes } = require("../modules/user/routes/user.routes");
const { productRoutes } = require("../modules/product/routes/product.routes");
const { cartRoutes } = require("../modules/cart/routes/cart.routes");
const { orderRoutes } = require("../modules/order/routes/order.routes");
const { paymentRoutes } = require("../modules/payment/routes/payment.routes");
const { sellerRoutes } = require("../modules/seller/routes/seller.routes");
const { notificationRoutes } = require("../modules/notification/routes/notification.routes");
const { analyticsRoutes } = require("../modules/analytics/routes/analytics.routes");
const { pricingRoutes } = require("../modules/pricing/routes/pricing.routes");
const { walletRoutes } = require("../modules/wallet/routes/wallet.routes");
const { adminRoutes } = require("../modules/admin/routes/admin.routes");
const { platformRoutes } = require("../modules/platform/routes/platform.routes");
const { cmsRoutes } = require("../modules/cms/routes/cms.routes");
const { taxRoutes } = require("../modules/tax/routes/tax.routes");
const { subscriptionRoutes } = require("../modules/subscription/routes/subscription.routes");
const { rbacRoutes } = require("../modules/rbac/routes/rbac.routes");
const { warrantyRoutes } = require("../modules/warranty/routes/warranty.routes");
const loyaltyRoutes = require("../modules/loyalty/routes/loyalty.routes");
const recommendationRoutes = require("../modules/recommendation/routes/recommendation.routes");
const returnRoutes = require("../modules/returns/routes/return.routes");
const fraudRoutes = require("../modules/fraud/routes/fraud.routes");
const dynamicPricingRoutes = require("../modules/pricing/routes/dynamic-pricing.routes");
const commissionRoutes = require("../modules/seller/routes/commission.routes");
const notificationPreferenceRoutes = require("../modules/notification/routes/notification-preference.routes");
const { deliveryRoutes } = require("../modules/delivery/routes/delivery.routes");
const { fileUploaderRoutes } = require("../shared/routes/file-uploader.routes");
const { metaRoutes } = require("../shared/routes/meta.routes");
const searchRoutes = require("../shared/routes/search.routes");
const { commonManagementRoutes } = require("../modules/admin/routes/common-management.routes");

function registerRoutes(app) {
  app.use(`${env.apiPrefix}/auth`, authRoutes);
  app.use(`${env.apiPrefix}/global`, commonManagementRoutes);
  app.use(`${env.apiPrefix}/users`, userRoutes);
  app.use(`${env.apiPrefix}/products`, productRoutes);
  app.use(`${env.apiPrefix}/carts`, cartRoutes);
  app.use(`${env.apiPrefix}/orders`, orderRoutes);
  app.use(`${env.apiPrefix}/payments`, paymentRoutes);
  app.use(`${env.apiPrefix}/platform`, platformRoutes);
  app.use(`${env.apiPrefix}/cms`, cmsRoutes);
  app.use(`${env.apiPrefix}/sellers`, sellerRoutes);
  app.use(`${env.apiPrefix}/notifications`, notificationRoutes);
  app.use(`${env.apiPrefix}/analytics`, analyticsRoutes);
  app.use(`${env.apiPrefix}/pricing`, pricingRoutes);
  app.use(`${env.apiPrefix}/coupons`, pricingRoutes);
  app.use(`${env.apiPrefix}/wallets`, walletRoutes);
  app.use(`${env.apiPrefix}/admin`, adminRoutes);
  app.use(`${env.apiPrefix}/tax`, taxRoutes);
  app.use(`${env.apiPrefix}/subscriptions`, subscriptionRoutes);
  app.use(`${env.apiPrefix}/rbac`, rbacRoutes);
  app.use(`${env.apiPrefix}/warranty`, warrantyRoutes);
  
  // Production features - Phase 5
  app.use(`${env.apiPrefix}/loyalty`, loyaltyRoutes);
  app.use(`${env.apiPrefix}/recommendations`, recommendationRoutes);
  app.use(`${env.apiPrefix}/returns`, returnRoutes);
  app.use(`${env.apiPrefix}/fraud`, fraudRoutes);
  app.use(`${env.apiPrefix}/dynamic-pricing`, dynamicPricingRoutes);
  app.use(`${env.apiPrefix}/sellers/commissions`, commissionRoutes);
  app.use(`${env.apiPrefix}/notifications`, notificationPreferenceRoutes);
  app.use(`${env.apiPrefix}/delivery`, deliveryRoutes);
  app.use(`${env.apiPrefix}/file-uploader`, fileUploaderRoutes);
  app.use(`${env.apiPrefix}/meta`, metaRoutes);
  app.use(`${env.apiPrefix}/search`, searchRoutes);
}

module.exports = { registerRoutes };
