const { PAYMENT_PROVIDER } = require("../../shared/domain/commerce-constants");
const { RazorpayProvider } = require("./providers/razorpay.provider");
const { ManualPaymentProvider } = require("./providers/manual.provider");
const { AppError } = require("../../shared/errors/app-error");

class PaymentProviderRegistry {
  constructor() {
    this.providers = {
      [PAYMENT_PROVIDER.RAZORPAY]: new RazorpayProvider(),
      [PAYMENT_PROVIDER.COD]: new ManualPaymentProvider(PAYMENT_PROVIDER.COD),
      [PAYMENT_PROVIDER.MANUAL_BANK_TRANSFER]: new ManualPaymentProvider(PAYMENT_PROVIDER.MANUAL_BANK_TRANSFER),
      [PAYMENT_PROVIDER.MANUAL_UPI]: new ManualPaymentProvider(PAYMENT_PROVIDER.MANUAL_UPI),
      [PAYMENT_PROVIDER.WALLET_ONLY]: new ManualPaymentProvider(PAYMENT_PROVIDER.WALLET_ONLY),
    };
  }

  get(providerName) {
    const provider = this.providers[providerName];
    if (!provider) {
      throw new AppError(`Payment provider '${providerName}' is not supported`, 400);
    }

    return provider;
  }
}

const paymentProviderRegistry = new PaymentProviderRegistry();

module.exports = { PaymentProviderRegistry, paymentProviderRegistry };
