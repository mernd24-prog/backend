const { env } = require("../../../config/env");
const { logger } = require("../../../shared/logger/logger");
const { ContentPageModel } = require("../../platform/models/content-page.model");
const { OrderRepository } = require("../../order/repositories/order.repository");

const ROUTE_TOKEN_MASK = "sam-global-route-token-v1";
const ROUTE_TOKEN_VERSION = "rt1";

const STANDARD_KNOWLEDGE_BASE = [
  {
    topic: "Orders & Tracking",
    keywords: ["order", "track", "tracking", "status", "shipment", "delivery", "where is my order", "dispatch"],
    title: "How do I track my order?",
    answer:
      "You can track your order in real-time by going to **My Account > Orders** and clicking on **Track Order** next to your purchase. You will see live tracking events from dispatch to doorstep delivery.",
    category: "ORDER_ISSUE",
    link: "/orders",
  },
  {
    topic: "Order Cancellation",
    keywords: ["cancel", "cancellation", "stop order", "cancel order"],
    title: "How do I cancel my order?",
    answer:
      "You can cancel your order directly from **My Account > Orders** before it is dispatched by clicking **Cancel Order**. If the order has already shipped, you can refuse delivery or initiate a return once delivered.",
    category: "ORDER_ISSUE",
    link: "/orders",
  },
  {
    topic: "Returns & Exchanges",
    keywords: ["return", "exchange", "replace", "damaged", "wrong item", "return window"],
    title: "What is your return & exchange policy?",
    answer:
      "We offer a 7-day hassle-free return and replacement policy for eligible products. To initiate a return, go to **My Account > Orders**, select the delivered item, and click **Request Return / Replacement** with photos of the issue.",
    category: "REFUND_RETURN_ISSUE",
    link: "/customer/returns",
  },
  {
    topic: "Refunds & Timelines",
    keywords: ["refund", "money back", "refund status", "refund time", "wallet refund"],
    title: "When will I receive my refund?",
    answer:
      "Once a returned item is received and inspected at our warehouse, refunds are initiated within 24-48 hours. Wallet refunds are instant, while bank/card refunds take 5-7 business days to reflect in your original payment method.",
    category: "REFUND_RETURN_ISSUE",
    link: "/customer/wallet",
  },
  {
    topic: "Payment Methods & Security",
    keywords: ["payment", "cashfree", "razorpay", "upi", "card", "cod", "cash on delivery", "failed payment"],
    title: "What payment methods are supported?",
    answer:
      "We support UPI (Google Pay, PhonePe, Paytm), Credit & Debit Cards (Visa, MasterCard, RuPay), Net Banking, SAM Wallet balance, and Cash on Delivery (COD) on eligible pin codes.",
    category: "PAYMENT_ISSUE",
    link: "/payments",
  },
  {
    topic: "Payment Deducted but Order Failed",
    keywords: ["payment deducted", "money debited", "failed transaction", "pending payment"],
    title: "My money was deducted but no order confirmation was received. What should I do?",
    answer:
      "If money was debited from your bank/UPI but your order was not created, banks usually auto-reverse the amount within 24-48 hours. If you do not see it within 3 business days, please raise a support ticket with your transaction reference (UTR/Bank Ref ID).",
    category: "PAYMENT_ISSUE",
    link: "/support",
  },
  {
    topic: "Shipping & Delivery Times",
    keywords: ["shipping", "delivery time", "how long", "courier", "express delivery", "estimated delivery"],
    title: "How long does delivery take?",
    answer:
      "Standard delivery typically takes 3 to 7 business days depending on your delivery pin code. Metro cities often receive deliveries within 2-4 business days. Real-time ETA is shown on each product page and during checkout.",
    category: "DELIVERY_ISSUE",
    link: "/orders",
  },
  {
    topic: "Account & Profile",
    keywords: ["password", "login", "otp", "profile", "change email", "phone number", "account"],
    title: "How do I update my profile or reset my password?",
    answer:
      "Navigate to **My Account > Profile Settings** to update your name, contact phone, delivery addresses, and login credentials securely.",
    category: "ACCOUNT_ISSUE",
    link: "/profile",
  },
  {
    topic: "Warranty & Support",
    keywords: ["warranty", "claim", "repair", "service center", "guarantee"],
    title: "How do I claim product warranty?",
    answer:
      "Products covered under manufacturer warranty come with a warranty card/invoice. You can download your tax invoice from **My Account > Orders** and reach out to the authorized brand service center or raise a warranty support request.",
    category: "PRODUCT_ISSUE",
    link: "/customer/warranty",
  },
];

function routeMaskByte(index) {
  return ROUTE_TOKEN_MASK.charCodeAt(index % ROUTE_TOKEN_MASK.length);
}

function encodeRouteToken(kind, payload = {}) {
  const text = JSON.stringify({ t: ROUTE_TOKEN_VERSION, k: kind, ...payload });
  const sourceBytes = Buffer.from(text, "utf8");
  const maskedBytes = sourceBytes.map((byte, index) => byte ^ routeMaskByte(index) ^ ((index * 31) & 255));
  return Buffer.from(maskedBytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

class SupportAiService {
  constructor({
    orderRepository = new OrderRepository(),
    geminiApiKey = env.ai?.geminiApiKey || "",
    geminiModel = env.ai?.geminiModel || "gemini-2.5-flash",
  } = {}) {
    this.orderRepository = orderRepository;
    this.geminiApiKey = geminiApiKey;
    this.geminiModel = geminiModel;
  }

  /**
   * Main entrypoint for processing an AI support chat message.
   */
  async processChatMessage({ message, history = [], auth = null }) {
    const cleanUserMessage = String(message || "").trim();
    const intent = this.detectIntent(cleanUserMessage);

    // 1. Gather Approved Knowledge (CMS FAQs + Built-in Knowledge Base)
    const knowledgeBase = await this.retrieveApprovedKnowledge(cleanUserMessage);

    // 2. Fetch Customer Context if Authenticated
    const customerContext = await this.retrieveCustomerContext(auth);

    const accountResponse = this.buildAccountAwareResponse({
      userMessage: cleanUserMessage,
      intent,
      customerContext,
    });
    if (accountResponse) {
      return accountResponse;
    }

    // 3. Attempt Gemini Grounded Generation if configured
    if (this.geminiApiKey) {
      try {
        const geminiResult = await this.generateWithGemini({
          userMessage: cleanUserMessage,
          history,
          knowledgeBase,
          customerContext,
        });

        if (geminiResult) {
          return this.normalizeResponseLinks(geminiResult, {
            userMessage: cleanUserMessage,
            intent,
            customerContext,
          });
        }
      } catch (err) {
        logger.warn({ err }, "[SupportAiService] Gemini invocation failed; falling back to rule-based retrieval");
      }
    }

    // 4. Fallback Rule-Based Knowledge Matching
    return this.generateFallbackResponse({
      userMessage: cleanUserMessage,
      knowledgeBase,
      customerContext,
      intent,
    });
  }

  /**
   * Retrieves approved knowledge from MongoDB CMS pages and static base.
   */
  async retrieveApprovedKnowledge(query = "") {
    const knowledge = [...STANDARD_KNOWLEDGE_BASE];

    try {
      const cmsPages = await ContentPageModel.find({
        slug: {
          $in: [
            "faq-details",
            "support-center",
            "refund-policy",
            "shipping-policy",
            "cancellation-policy",
            "terms-conditions",
            "privacy-policy",
          ],
        },
      })
        .select("slug title description sections points")
        .lean()
        .catch(() => []);

      for (const page of cmsPages) {
        // Extract FAQs from sections
        if (Array.isArray(page.sections)) {
          for (const section of page.sections) {
            const topic = section.title || page.title || "Help";
            if (Array.isArray(section.points)) {
              for (const point of section.points) {
                if (point.title && point.description) {
                  knowledge.push({
                    topic,
                    title: point.title,
                    answer: point.description,
                    category: this.inferCategory(point.title + " " + point.description),
                    link: `/faq`,
                  });
                }
              }
            }
          }
        }

        // Extract direct points
        if (Array.isArray(page.points)) {
          for (const point of page.points) {
            if (point.title && point.description) {
              knowledge.push({
                topic: page.title || "Policy",
                title: point.title,
                answer: point.description,
                category: this.inferCategory(point.title + " " + point.description),
                link: `/policies/${page.slug}`,
              });
            }
          }
        }
      }
    } catch (error) {
      logger.warn({ err: error }, "[SupportAiService] Error loading CMS knowledge; using static knowledge base");
    }

    // Score and rank knowledge relevant to the user query
    const scoredKnowledge = this.rankKnowledgeByRelevance(query, knowledge);
    return scoredKnowledge.slice(0, 8);
  }

  /**
   * Retrieves order and account history for authenticated customers.
   */
  async retrieveCustomerContext(auth) {
    if (!auth?.sub) {
      return {
        isAuthenticated: false,
        summary: "Guest user (Not logged in)",
        recentOrders: [],
      };
    }

    try {
      const rawOrders = await this.orderRepository.listOrdersByBuyer(auth.sub, {
        limit: 5,
      });

      const recentOrders = (rawOrders || []).map((ord) => ({
        id: ord.id,
        orderNumber: ord.order_number || ord.orderNumber || ord.id,
        status: ord.status || "CONFIRMED",
        deliveryStatus: ord.delivery_status || ord.deliveryStatus || null,
        paymentStatus: ord.payment_status || ord.paymentStatus || "PAID",
        paymentMethod: ord.payment_method || ord.paymentMethod || "ONLINE",
        totalAmount: ord.grand_total || ord.totalAmount || ord.total || 0,
        currency: ord.currency || "INR",
        placedAt: ord.created_at || ord.createdAt,
        expectedDeliveryAt: this.getExpectedDeliveryAt(ord),
        latestTracking: this.getLatestTrackingSnapshot(ord),
        hasInvoice: Boolean(ord.relations?.invoice || ord.relations?.invoices?.length),
        hasCancellationRequest: Boolean(ord.relations?.cancellations?.length),
        cancellationStatus: ord.relations?.cancellations?.[0]?.status || null,
        shipmentCount: Array.isArray(ord.relations?.shipments) ? ord.relations.shipments.length : 0,
        itemsCount: Array.isArray(ord.items) ? ord.items.length : 1,
        items: Array.isArray(ord.items)
          ? ord.items.map((i) => ({
              title: i.title || i.product_title || i.name || "Product",
              quantity: i.quantity || 1,
              price: i.unit_price || i.price || 0,
              status: i.effective_status || i.delivery_status || i.status || null,
              returnable: i.returnable,
              returnStatus: i.returnStatus || i.return_status || null,
            }))
          : [],
      }));

      return {
        isAuthenticated: true,
        userId: auth.sub,
        userName: auth.user?.name || auth.name || "Customer",
        userEmail: auth.user?.email || auth.email || "",
        recentOrders,
      };
    } catch (err) {
      logger.warn({ err }, "[SupportAiService] Failed to load customer context");
      return {
        isAuthenticated: true,
        userId: auth.sub,
        recentOrders: [],
      };
    }
  }

  /**
   * Invokes Google Gemini API with grounded context and strict formatting.
   */
  async generateWithGemini({ userMessage, history = [], knowledgeBase = [], customerContext = {} }) {
    const prompt = this.buildGroundedPrompt({
      userMessage,
      history,
      knowledgeBase,
      customerContext,
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.geminiModel,
    )}:generateContent?key=${encodeURIComponent(this.geminiApiKey)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`Gemini API returned status ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      throw new Error("Empty candidate response from Gemini API");
    }

    const parsed = JSON.parse(rawText);
    return {
      reply: parsed.reply || "I am here to assist you with any questions about your orders, returns, and store policies.",
      found: parsed.found === true,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : parsed.found ? 0.95 : 0.2,
      suggestedCategory: parsed.suggestedCategory || "ORDER_ISSUE",
      suggestedSubject: parsed.suggestedSubject || userMessage.slice(0, 80),
      suggestedMessage: parsed.suggestedMessage || userMessage,
      relevantLinks: Array.isArray(parsed.relevantLinks) ? parsed.relevantLinks : [],
    };
  }

  getExpectedDeliveryAt(order = {}) {
    const direct = order.expected_delivery_at || order.expectedDeliveryAt || order.estimated_delivery_at || null;
    if (direct) return direct;

    const groups = order.relations?.sellerFulfillmentGroups || [];
    const groupEta = groups
      .map((group) => group.expectedDeliveryAt || group.expected_delivery_at)
      .filter(Boolean)
      .sort((left, right) => new Date(left) - new Date(right))[0];
    if (groupEta) return groupEta;

    const shipments = order.relations?.shipments || [];
    return shipments
      .map((shipment) => shipment.expected_delivery_at || shipment.expectedDeliveryAt)
      .filter(Boolean)
      .sort((left, right) => new Date(left) - new Date(right))[0] || null;
  }

  getLatestTrackingSnapshot(order = {}) {
    const shipments = order.relations?.shipments || [];
    const events = shipments.flatMap((shipment) =>
      (shipment.trackingEvents || []).map((event) => ({
        status: event.status || event.to_status || shipment.status || null,
        note: event.note || event.message || null,
        at: event.event_time || event.created_at || event.at || shipment.updated_at || shipment.created_at || null,
      })),
    );
    return events
      .filter((event) => event.status || event.note)
      .sort((left, right) => new Date(right.at || 0) - new Date(left.at || 0))[0] || null;
  }

  detectIntent(message = "") {
    const lower = String(message || "").toLowerCase();
    const hasOrderReference = Boolean(this.extractOrderReference(message));
    const hasOrder = lower.includes("order") || lower.includes("shipment") || lower.includes("delivery") || hasOrderReference;
    const hasPersonalOrder =
      hasOrderReference ||
      (hasOrder &&
        (lower.includes("where is my order") ||
        lower.includes("track my order") ||
        lower.includes("order status") ||
        lower.includes("status for") ||
        lower.includes("my recent order") ||
        lower.includes("my latest order") ||
        lower.includes("recent order") ||
        lower.includes("latest order") ||
        lower.includes("my order") ||
        lower.includes("mera order") ||
        lower.includes("order kaha") ||
        lower.includes("order kahan") ||
        lower.includes("order kidhar") ||
        lower.includes("order kab") ||
        lower.includes("order detail") ||
          lower.includes("order details")));

    if (hasPersonalOrder && (lower.includes("cancel") || lower.includes("cancellation"))) {
      return { type: "ORDER_CANCEL", category: "ORDER_ISSUE", requiresAccount: true };
    }
    if (hasPersonalOrder && (lower.includes("invoice") || lower.includes("bill"))) {
      return { type: "ORDER_INVOICE", category: "ORDER_ISSUE", requiresAccount: true };
    }
    if (hasPersonalOrder && (lower.includes("return") || lower.includes("exchange") || lower.includes("replace"))) {
      return { type: "ORDER_RETURN", category: "REFUND_RETURN_ISSUE", requiresAccount: true };
    }
    if (hasPersonalOrder && (lower.includes("refund") || lower.includes("money back"))) {
      return { type: "ORDER_REFUND", category: "REFUND_RETURN_ISSUE", requiresAccount: true };
    }
    if (
      hasPersonalOrder &&
      (lower.includes("payment") ||
        lower.includes("paid") ||
        lower.includes("deducted") ||
        lower.includes("debited") ||
        lower.includes("charged"))
    ) {
      return { type: "ORDER_PAYMENT", category: "PAYMENT_ISSUE", requiresAccount: true };
    }
    if (hasPersonalOrder) {
      return { type: "ORDER_STATUS", category: "ORDER_ISSUE", requiresAccount: true };
    }

    return {
      type: "GENERAL",
      category: this.inferCategory(message),
      requiresAccount: false,
    };
  }

  isPersonalOrderQuery(message = "") {
    return this.detectIntent(message).requiresAccount;
  }

  extractOrderReference(message = "") {
    const text = String(message || "");
    const orderNumber = text.match(/\bORD-[A-Z0-9-]+\b/i)?.[0];
    if (orderNumber) return orderNumber.toLowerCase();

    const uuid = text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)?.[0];
    return uuid ? uuid.toLowerCase() : "";
  }

  findRelevantOrder(message = "", recentOrders = []) {
    if (!Array.isArray(recentOrders) || !recentOrders.length) return null;

    const reference = this.extractOrderReference(message);
    if (reference) {
      const matched = recentOrders.find((order) => {
        const id = String(order.id || order.orderId || order.order_id || "").toLowerCase();
        const number = String(order.orderNumber || order.order_number || "").toLowerCase();
        return id === reference || number === reference || number.includes(reference);
      });
      if (matched) return matched;
    }

    return recentOrders[0];
  }

  formatMoney(amount, currency = "INR") {
    const numeric = Number(amount || 0);
    if (String(currency || "INR").toUpperCase() === "INR") {
      return `₹${numeric}`;
    }
    return `${currency || ""} ${numeric}`.trim();
  }

  humanizeStatus(value = "") {
    const status = String(value || "").trim();
    if (!status) return "Not available";
    return status
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  orderHasStatus(order = {}, needles = []) {
    const values = [
      order.status,
      order.deliveryStatus,
      order.paymentStatus,
      order.latestTracking?.status,
      ...(Array.isArray(order.items) ? order.items.flatMap((item) => [item.status, item.returnStatus]) : []),
    ]
      .map((value) => String(value || "").toLowerCase())
      .filter(Boolean);

    return needles.some((needle) => values.some((value) => value.includes(needle)));
  }

  formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  formatOrderItems(order = {}) {
    const items = Array.isArray(order.items) ? order.items : [];
    if (!items.length) return "Item details are available on the order page";
    return items
      .slice(0, 3)
      .map((item) => {
        const quantity = Number(item.quantity || 1);
        return quantity > 1 ? `${item.title} x ${quantity}` : item.title;
      })
      .join(", ");
  }

  buildOrderSnapshotLines(order = {}) {
    const lines = [
      `**Order**: #${order.orderNumber || order.order_number || "your order"}`,
      `**Order Status**: ${this.humanizeStatus(order.status || "CONFIRMED")}`,
      `**Payment**: ${this.humanizeStatus(order.paymentStatus || order.payment_status || "PAID")}`,
      `**Total**: ${this.formatMoney(order.totalAmount || order.grand_total || order.total || 0, order.currency)}`,
      `**Items**: ${this.formatOrderItems(order)}`,
    ];

    if (order.deliveryStatus) {
      lines.splice(2, 0, `**Delivery**: ${this.humanizeStatus(order.deliveryStatus)}`);
    }
    if (order.latestTracking?.status || order.latestTracking?.note) {
      lines.push(
        `**Latest Update**: ${this.humanizeStatus(order.latestTracking.status)}${order.latestTracking.note ? ` - ${order.latestTracking.note}` : ""}`,
      );
    }
    const eta = this.formatDate(order.expectedDeliveryAt);
    if (eta && !this.orderHasStatus(order, ["delivered"])) {
      lines.push(`**Expected Delivery**: ${eta}`);
    }

    return lines;
  }

  getOrderGuidance(order = {}, intent = {}) {
    const status = String(order.status || "").toLowerCase();
    const delivery = String(order.deliveryStatus || order.latestTracking?.status || "").toLowerCase();
    const payment = String(order.paymentStatus || "").toLowerCase();

    if (payment.includes("failed")) {
      return "Payment is marked failed. If money was deducted, banks usually reverse it automatically; raise a ticket with the UTR/reference if it is not reversed within the expected bank timeline.";
    }
    if (status.includes("cancel")) {
      return "This order is marked cancelled. Refund updates, if applicable, will be available from the order page.";
    }
    if (delivery.includes("delivered") || status.includes("delivered")) {
      if (intent.type === "ORDER_RETURN") {
        return "Since the order is delivered, return/replacement options can be checked item-wise from the order page.";
      }
      return "This order is delivered. You can download invoice, request eligible return/replacement, or raise a ticket from the order page if something is wrong.";
    }
    if (delivery.includes("out_for_delivery")) {
      return "This order is out for delivery. Please keep your phone reachable for the delivery partner.";
    }
    if (delivery.includes("transit") || delivery.includes("shipped") || status.includes("shipped")) {
      return "This order is on the way. Tracking milestones are available on the order page.";
    }
    if (status.includes("confirmed") || status.includes("processing") || status.includes("packed")) {
      return "This order is being prepared. Cancellation may be available until it is packed/shipped, based on seller and fulfillment status.";
    }
    return "Open the order page for the latest actions available for this order.";
  }

  buildQuickActions(intent = {}, order = null) {
    if (!order) {
      return [{ label: "View Orders", url: "/orders", action: "VIEW_ORDERS" }];
    }

    const orderUrl = this.getOrderDetailUrl(order);
    const trackUrl = this.getOrderDetailUrl(order, { track: true });
    const actions = [
      { label: "View Details", url: orderUrl, action: "VIEW_ORDER" },
      { label: "Track Order", url: trackUrl, action: "TRACK_ORDER" },
    ];

    const isDelivered = this.orderHasStatus(order, ["delivered"]);
    const isCancelled = this.orderHasStatus(order, ["cancelled", "canceled"]);

    if (intent.type === "ORDER_CANCEL" && !isDelivered && !isCancelled) {
      actions.push({ label: "Check Cancellation", url: orderUrl, action: "CHECK_CANCELLATION" });
    } else if (intent.type === "ORDER_RETURN" || (intent.type === "ORDER_CANCEL" && isDelivered)) {
      actions.push({ label: "Request Return", url: orderUrl, action: "REQUEST_RETURN" });
    } else if (intent.type === "ORDER_INVOICE") {
      actions.push({ label: "Download Invoice", url: orderUrl, action: "DOWNLOAD_INVOICE" });
    } else if (intent.type === "ORDER_REFUND") {
      actions.push({ label: "Check Refund", url: orderUrl, action: "CHECK_REFUND" });
    }

    actions.push({ label: "Raise Ticket", url: "/support", action: "RAISE_TICKET" });
    return actions;
  }

  withSupportMetadata(response = {}, { intent = {}, order = null, needsLogin = false, canRaiseTicket = true } = {}) {
    return {
      ...response,
      intent: intent.type || "GENERAL",
      needsLogin,
      canRaiseTicket,
      quickActions: needsLogin
        ? [{ label: "Login", url: "/login", action: "LOGIN" }]
        : this.buildQuickActions(intent, order),
    };
  }

  buildAccountAwareResponse({ userMessage = "", intent = {}, customerContext = {} }) {
    if (!intent.requiresAccount) return null;

    if (!customerContext.isAuthenticated) {
      return this.buildGuestOrderResponse(userMessage, intent);
    }

    const orders = customerContext.recentOrders || [];
    if (!orders.length) {
      return {
        ...this.withSupportMetadata({
          reply:
            "I checked your account, but I couldn't find any recent orders here. If payment was deducted, please raise a ticket with your UTR/payment reference so our team can trace it faster.",
          found: true,
          confidence: 0.8,
          suggestedCategory: intent.category || "ORDER_ISSUE",
          suggestedSubject: "Order not found in account",
          suggestedMessage: userMessage,
          relevantLinks: [{ label: "View Orders", url: "/orders" }],
        }, { intent, order: null }),
      };
    }

    const requestedReference = this.extractOrderReference(userMessage);
    const order = this.findRelevantOrder(userMessage, orders);
    const matchedRequestedOrder =
      !requestedReference ||
      String(order?.id || "").toLowerCase() === requestedReference ||
      String(order?.orderNumber || "").toLowerCase() === requestedReference;

    if (requestedReference && !matchedRequestedOrder) {
      return {
        ...this.withSupportMetadata({
          reply:
            "I couldn't match that order reference with the recent orders in your account. Please open **[My Orders](/orders)** to select the order, or raise a ticket if the order is missing after payment.",
          found: false,
          confidence: 0.55,
          suggestedCategory: intent.category || "ORDER_ISSUE",
          suggestedSubject: "Order reference not found",
          suggestedMessage: userMessage,
          relevantLinks: [{ label: "View Orders", url: "/orders" }],
        }, { intent, order: null }),
      };
    }

    return this.buildOrderIntentResponse({
      userMessage,
      intent,
      order,
    });
  }

  buildOrderIntentResponse({ userMessage = "", intent = {}, order = {} }) {
    const orderUrl = this.getOrderDetailUrl(order);
    const trackUrl = this.getOrderDetailUrl(order, { track: true });
    const orderNumber = order.orderNumber || order.order_number || "your order";
    const status = order.status || "CONFIRMED";
    const paymentStatus = order.paymentStatus || order.payment_status || "PAID";
    const category = intent.category || "ORDER_ISSUE";
    const snapshotLines = this.buildOrderSnapshotLines(order);
    const guidance = this.getOrderGuidance(order, intent);

    const responses = {
      ORDER_CANCEL: {
        intro:
          "I found the order. Cancellation options depend on its current fulfillment stage.",
        next: `${guidance}\n\nOpen **[order details](${orderUrl})** to check the cancellation button and available next steps.`,
        subject: `Cancellation help for Order #${orderNumber}`,
      },
      ORDER_INVOICE: {
        intro: "I found the order. Invoice/download options are available from the order detail page.",
        next: `${order.hasInvoice ? "Invoice looks available for this order." : "If invoice is not visible yet, it may appear after confirmation/dispatch depending on fulfillment."}\n\nOpen **[order details](${orderUrl})** and use the invoice option there.`,
        subject: `Invoice help for Order #${orderNumber}`,
      },
      ORDER_RETURN: {
        intro:
          "I found the order. Return or replacement eligibility is checked item-wise from the order detail page.",
        next: `${guidance}\n\nOpen **[order details](${orderUrl})** and choose the eligible item to request return/replacement.`,
        subject: `Return help for Order #${orderNumber}`,
      },
      ORDER_REFUND: {
        intro: "I found the order. Refund status depends on the linked return/cancellation and payment method.",
        next: `${guidance}\n\nOpen **[order details](${orderUrl})** to check refund updates. If money was deducted but the order is missing, raise a ticket with the payment reference.`,
        subject: `Refund help for Order #${orderNumber}`,
      },
      ORDER_PAYMENT: {
        intro: "I found the order and checked the payment status available in your account.",
        next: `${this.humanizeStatus(paymentStatus)} is the current payment status shown for this order.\n\nOpen **[order details](${orderUrl})** for payment details, invoice, and next available actions.`,
        subject: `Payment help for Order #${orderNumber}`,
      },
      ORDER_STATUS: {
        intro: "Here is the latest information I found for your order.",
        next: `${guidance}\n\nTrack delivery milestones or view invoice/actions from **[order details](${orderUrl})**.`,
        subject: `Inquiry regarding Order #${orderNumber}`,
      },
    };

    const copy = responses[intent.type] || responses.ORDER_STATUS;
    if (intent.type === "ORDER_CANCEL" && this.orderHasStatus(order, ["delivered"])) {
      copy.next = `This order is already delivered, so direct cancellation is no longer available. You can check return/replacement eligibility from **[order details](${orderUrl})** or raise a ticket if there is an issue with the delivered item.`;
    } else if (intent.type === "ORDER_CANCEL" && this.orderHasStatus(order, ["cancelled", "canceled"])) {
      copy.next = `This order is already cancelled. Refund details, if applicable, are available from **[order details](${orderUrl})**.`;
    }

    return this.withSupportMetadata({
      reply: `${copy.intro}\n\n${snapshotLines.map((line) => `- ${line}`).join("\n")}\n\n${copy.next}`,
      found: true,
      confidence: 0.95,
      suggestedCategory: category,
      suggestedSubject: copy.subject,
      suggestedMessage: userMessage,
      relevantLinks: [
        { label: "View Order Details", url: orderUrl },
        { label: "Track Order", url: trackUrl },
      ],
    }, { intent, order });
  }

  getOrderDetailUrl(order = {}, { track = false } = {}) {
    const orderId = order.id || order.orderId || order.order_id;
    if (!orderId) return "/orders";
    const token = encodeRouteToken("order", { id: String(orderId) });
    const suffix = track ? "/track" : "";
    return `/orders/i/${encodeURIComponent(token)}${suffix}`;
  }

  buildGuestOrderResponse(userMessage = "", intent = {}) {
    return {
      ...this.withSupportMetadata({
        reply:
          "I am unable to get your order information because you are not logged in. Please log in to your account, then open **My Account > Orders** to view your order status, tracking, invoice, cancellation, return, or refund options.",
        found: false,
        confidence: 0.95,
        suggestedCategory: intent.category || "ORDER_ISSUE",
        suggestedSubject: "Login required for order status",
        suggestedMessage: userMessage,
        relevantLinks: [{ label: "Login to View Orders", url: "/login" }],
      }, { intent, needsLogin: true, canRaiseTicket: false }),
    };
  }

  normalizeResponseLinks(response = {}, { userMessage = "", intent = null, customerContext = {} } = {}) {
    const resolvedIntent = intent || this.detectIntent(userMessage);
    if (!resolvedIntent.requiresAccount || !customerContext.isAuthenticated) {
      return response;
    }

    const latest = customerContext.recentOrders?.[0];
    if (!latest?.id) return response;

    const orderUrl = this.getOrderDetailUrl(latest);
    const reply = String(response.reply || "").replace(/\]\(\/orders\)/g, `](${orderUrl})`);
    const relevantLinks = (Array.isArray(response.relevantLinks) ? response.relevantLinks : []).map((link) => {
      if (link?.url !== "/orders") return link;
      return { ...link, label: link.label || "View Order Details", url: orderUrl };
    });

    const hasOrderDetailLink = relevantLinks.some((link) => link?.url === orderUrl);
    return {
      ...response,
      reply,
      relevantLinks: hasOrderDetailLink
        ? relevantLinks
        : [{ label: "View Order Details", url: orderUrl }, ...relevantLinks],
    };
  }

  /**
   * Builds the strict Grounded System Prompt for Gemini.
   */
  buildGroundedPrompt({ userMessage, history = [], knowledgeBase = [], customerContext = {} }) {
    const knowledgeText = knowledgeBase
      .map(
        (k, idx) =>
          `[Source ${idx + 1}] Topic: ${k.topic}\nQuestion/Title: ${k.title}\nPolicy/Answer: ${k.answer}\nURL: ${k.link || ""}`,
      )
      .join("\n\n");

    let contextText = `User Authentication: ${customerContext.isAuthenticated ? "LOGGED IN" : "GUEST"}\n`;
    if (customerContext.isAuthenticated) {
      contextText += `Customer Name: ${customerContext.userName || "Customer"}\n`;
      if (customerContext.recentOrders?.length > 0) {
        contextText += `Recent Customer Orders:\n`;
        customerContext.recentOrders.forEach((o, i) => {
          const itemNames = o.items.map((it) => `${it.quantity}x ${it.title}`).join(", ");
          contextText += `  ${i + 1}. Order #${o.orderNumber} | Status: ${o.status} | Payment: ${o.paymentStatus} | Total: ₹${o.totalAmount} | Placed: ${o.placedAt} | Safe URL: ${this.getOrderDetailUrl(o)} | Track URL: ${this.getOrderDetailUrl(o, { track: true })} | Items: [${itemNames}]\n`;
        });
      } else {
        contextText += `Recent Orders: No past orders found for this account.\n`;
      }
    }

    const formattedHistory = history
      .slice(-6)
      .map((h) => `${h.role === "user" ? "Customer" : "AI Assistant"}: ${h.content || h.text || ""}`)
      .join("\n");

    return `
You are the Official AI Customer Support Assistant for "SAM-GLOBAL" E-Commerce platform.
Your objective is to provide friendly, accurate, concise, and helpful answers to shoppers.

### CRITICAL GROUNDING RULES:
1. Grounding: You MUST ONLY answer based on the [APPROVED STORE KNOWLEDGE] and [CUSTOMER CONTEXT] provided below.
2. Anti-Hallucination: Do NOT fabricate discount codes, fake delivery promises, policy exemptions, or unauthorized refunds.
3. Order Queries: If the customer asks about their order status and they are logged in, use their real order information from [CUSTOMER CONTEXT]. If they are a guest asking about an order, advise them to log in to view their orders.
4. Privacy: Never expose internal order IDs, database IDs, UUIDs, user IDs, payment IDs, or raw system identifiers. Use only customer-facing order numbers and the provided safe order URLs.
5. Escalation / Not Found: If the question cannot be answered from the provided knowledge and context (or requires human assistance/dispute resolution), set "found": false, formulate a polite handover message, and provide a recommended support category.

---

### [APPROVED STORE KNOWLEDGE]
${knowledgeText}

---

### [CUSTOMER CONTEXT]
${contextText}

---

### [CHAT HISTORY]
${formattedHistory ? formattedHistory : "No previous messages."}

---

### Current Customer Query:
"${userMessage}"

---

### REQUIRED JSON OUTPUT FORMAT:
You MUST respond strictly with a valid JSON object matching this exact structure:
{
  "reply": "string (Markdown formatted answer. Include helpful steps or order status details if found. If not found, explain politely and offer to connect them with human support.)",
  "found": true | false,
  "confidence": 0.0 to 1.0,
  "suggestedCategory": "ORDER_ISSUE" | "DELIVERY_ISSUE" | "PAYMENT_ISSUE" | "REFUND_RETURN_ISSUE" | "PRODUCT_ISSUE" | "ACCOUNT_ISSUE" | "OTHER",
  "suggestedSubject": "string (Brief 5-10 word summary of the user issue for prefilling ticket)",
  "suggestedMessage": "string (Summary of customer query and context for support agents)",
  "relevantLinks": [
    { "label": "string", "url": "string" }
  ]
}
`;
  }

  /**
   * Fallback rule-based matching engine when Gemini is offline or not configured.
   */
  generateFallbackResponse({ userMessage, knowledgeBase = [], customerContext = {}, intent = null }) {
    const lower = userMessage.toLowerCase();
    const resolvedIntent = intent || this.detectIntent(userMessage);
    const accountResponse = this.buildAccountAwareResponse({
      userMessage,
      intent: resolvedIntent,
      customerContext,
    });

    if (accountResponse) {
      return accountResponse;
    }

    // Check for explicit escalation, complaints, or human agent requests
    const isDisputeOrComplaint =
      lower.includes("human") ||
      lower.includes("agent") ||
      lower.includes("representative") ||
      lower.includes("speak to") ||
      lower.includes("talk to") ||
      lower.includes("raise a ticket") ||
      lower.includes("raise ticket") ||
      lower.includes("complaint") ||
      lower.includes("rude") ||
      lower.includes("threw") ||
      lower.includes("scam") ||
      lower.includes("fraud") ||
      lower.includes("stole") ||
      lower.includes("lost package") ||
      lower.includes("misbehaved");

    if (isDisputeOrComplaint) {
      const inferredCategory = this.inferCategory(userMessage);
      return {
        reply:
          "I understand this requires personalized attention from our customer care team. Would you like to raise a support ticket so a specialist can investigate and resolve this for you?",
        found: false,
        confidence: 0.2,
        suggestedCategory: inferredCategory,
        suggestedSubject: userMessage.length > 80 ? userMessage.slice(0, 77) + "..." : userMessage,
        suggestedMessage: userMessage,
        relevantLinks: [{ label: "Help Center", url: "/support" }],
      };
    }

    // Match against knowledge base
    const bestMatch = knowledgeBase.find((k) => {
      const matchKeywords = (k.keywords || []).some((kw) => lower.includes(kw));
      const matchTitle = (k.title || "").toLowerCase().includes(lower) || lower.includes((k.title || "").toLowerCase().slice(0, 15));
      return matchKeywords || matchTitle;
    });

    if (bestMatch) {
      return {
        reply: `${bestMatch.answer}\n\n*Reference: ${bestMatch.topic}*`,
        found: true,
        confidence: 0.9,
        suggestedCategory: bestMatch.category || "OTHER",
        suggestedSubject: bestMatch.title || userMessage.slice(0, 80),
        suggestedMessage: userMessage,
        relevantLinks: bestMatch.link ? [{ label: bestMatch.topic, url: bestMatch.link }] : [],
      };
    }

    // Default "Not Found" response -> Prompts Raise Ticket
    const inferredCategory = this.inferCategory(userMessage);
    return {
      reply:
        "I couldn't find exact information matching your request in our approved knowledge base. Would you like to raise a support ticket so our customer service team can assist you directly?",
      found: false,
      confidence: 0.1,
      suggestedCategory: inferredCategory,
      suggestedSubject: userMessage.length > 80 ? userMessage.slice(0, 77) + "..." : userMessage,
      suggestedMessage: userMessage,
      relevantLinks: [{ label: "Help Center", url: "/customer/support" }],
    };
  }

  /**
   * Categorizes query based on keyword analysis.
   */
  inferCategory(text = "") {
    const str = String(text || "").toLowerCase();
    if (str.includes("return") || str.includes("refund") || str.includes("replace") || str.includes("exchange")) {
      return "REFUND_RETURN_ISSUE";
    }
    if (str.includes("delivery") || str.includes("courier") || str.includes("shipping") || str.includes("late") || str.includes("dispatch")) {
      return "DELIVERY_ISSUE";
    }
    if (str.includes("payment") || str.includes("charged") || str.includes("money") || str.includes("upi") || str.includes("card") || str.includes("cod")) {
      return "PAYMENT_ISSUE";
    }
    if (str.includes("order") || str.includes("item") || str.includes("cancel") || str.includes("invoice")) {
      return "ORDER_ISSUE";
    }
    if (str.includes("account") || str.includes("password") || str.includes("login") || str.includes("otp") || str.includes("profile")) {
      return "ACCOUNT_ISSUE";
    }
    if (str.includes("product") || str.includes("warranty") || str.includes("damage") || str.includes("defect") || str.includes("quality")) {
      return "PRODUCT_ISSUE";
    }
    return "OTHER";
  }

  /**
   * Helper: Rank knowledge by relevance score.
   */
  rankKnowledgeByRelevance(query = "", items = []) {
    const tokens = query
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2);

    if (!tokens.length) return items;

    return items
      .map((item) => {
        let score = 0;
        const targetStr = `${item.topic} ${item.title} ${item.answer} ${(item.keywords || []).join(" ")}`.toLowerCase();

        for (const token of tokens) {
          if (targetStr.includes(token)) {
            score += 1;
          }
        }
        return { item, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);
  }
}

module.exports = { SupportAiService };
