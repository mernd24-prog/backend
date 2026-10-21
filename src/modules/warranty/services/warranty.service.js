const { WarrantyRepository } = require("../repositories/warranty.repository");
const { ProductRepository } = require("../../product/repositories/product.repository");
const { OrderRepository } = require("../../order/repositories/order.repository");
const { EventPublisher } = require("../../../infrastructure/events/event-publisher");
const { v4: uuidv4 } = require("uuid");
const { AppError } = require("../../../shared/errors/app-error");

class WarrantyService {
  constructor({
    warrantyRepository = new WarrantyRepository(),
    productRepository = new ProductRepository(),
    orderRepository = new OrderRepository(),
    eventPublisher = new EventPublisher(),
  } = {}) {
    this.warrantyRepository = warrantyRepository;
    this.productRepository = productRepository;
    this.orderRepository = orderRepository;
    this.eventPublisher = eventPublisher;
  }

  async registerWarranty(orderId, productId, variantId = null) {
    const order = await this.orderRepository.findById(orderId);
    if (!order) throw new AppError("Order not found", 404);

    const product = await this.productRepository.findById(productId);
    if (!product) throw new AppError("Product not found", 404);

    if (!this.isWarrantyAvailable(product.warranty)) {
      throw new AppError("This product does not include warranty coverage", 400);
    }

    const existing = await this.warrantyRepository.findRegistration(
      orderId,
      productId,
      variantId,
    );
    if (existing) return existing;

    const warrantyData = {
      warrantyId: uuidv4(),
      orderId,
      productId,
      variantId,
      customerId: order.customerId,
      sellerId: order.sellerId,
      warrantyDetails: product.warranty,
      startDate: new Date(),
      endDate: this.calculateEndDate(product.warranty),
      status: "active",
      claims: [],
    };

    const warranty = await this.warrantyRepository.create(warrantyData);

    await this.eventPublisher.publish("warranty.registered", {
      warrantyId: warranty.warrantyId,
      orderId,
      productId,
      customerId: order.customerId,
    });

    return warranty;
  }

  async getWarranty(warrantyId) {
    return await this.warrantyRepository.findById(warrantyId);
  }

  async getWarrantiesByOrder(orderId) {
    return await this.warrantyRepository.findByOrderId(orderId);
  }

  async getWarrantiesByCustomer(customerId) {
    return await this.warrantyRepository.findByCustomerId(customerId);
  }

  async claimWarranty(warrantyId, claimData) {
    const warranty = await this.warrantyRepository.findById(warrantyId);
    if (!warranty) throw new Error("Warranty not found");

    if (warranty.status !== "active") throw new Error("Warranty is not active");

    const claim = {
      claimId: uuidv4(),
      ...claimData,
      status: "pending",
      createdAt: new Date(),
    };

    warranty.claims.push(claim);
    await this.warrantyRepository.update(warrantyId, warranty);

    await this.eventPublisher.publish("warranty.claimed", {
      warrantyId,
      claimId: claim.claimId,
      customerId: warranty.customerId,
    });

    return claim;
  }

  async updateClaimStatus(warrantyId, claimId, status, notes = null) {
    const warranty = await this.warrantyRepository.findById(warrantyId);
    if (!warranty) throw new Error("Warranty not found");

    const claim = warranty.claims.find(c => c.claimId === claimId);
    if (!claim) throw new Error("Claim not found");

    claim.status = status;
    if (notes) claim.notes = notes;
    claim.updatedAt = new Date();

    await this.warrantyRepository.update(warrantyId, warranty);

    return claim;
  }

  calculateEndDate(warranty) {
    const startDate = new Date();
    if (warranty.periodUnit === "years") {
      startDate.setFullYear(startDate.getFullYear() + warranty.period);
    } else if (warranty.periodUnit === "months") {
      startDate.setMonth(startDate.getMonth() + warranty.period);
    } else if (warranty.periodUnit === "weeks") {
      startDate.setDate(startDate.getDate() + warranty.period * 7);
    } else if (warranty.periodUnit === "days") {
      startDate.setDate(startDate.getDate() + warranty.period);
    }
    return startDate;
  }

  async getProductWarranty(productId) {
    const product = await this.productRepository.findById(productId);
    return this.isWarrantyAvailable(product?.warranty)
      ? product.warranty
      : null;
  }

  isWarrantyAvailable(warranty) {
    if (!warranty || warranty.enabled === false) return false;
    return (
      Number.isInteger(Number(warranty.period)) &&
      Number(warranty.period) >= 1 &&
      ["days", "weeks", "months", "years"].includes(warranty.periodUnit) &&
      Boolean(String(warranty.type || "").trim()) &&
      Boolean(String(warranty.provider || "").trim())
    );
  }
}

module.exports = { WarrantyService };
