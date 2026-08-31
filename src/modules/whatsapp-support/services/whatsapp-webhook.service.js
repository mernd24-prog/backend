const crypto = require("crypto");
const { env } = require("../../../config/env");
const { logger } = require("../../../shared/logger/logger");
const { AppError } = require("../../../shared/errors/app-error");
const { apitxtService } = require("../../../integrations/apitxt");
const { WhatsappFaqRepository } = require("../repositories/whatsapp-faq.repository");
const { WhatsappFaqAiService } = require("./whatsapp-faq-ai.service");

const SUPPORTED_TEXT_TYPES = new Set(["text", "message", "whatsapp_text"]);

function maskPhone(phone = "") {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${digits.slice(0, 2)}****${digits.slice(-4)}`;
}

function hashPhone(phone = "") {
  return crypto.createHash("sha256").update(String(phone || "").trim()).digest("hex");
}

class WhatsappWebhookService {
  constructor({
    repository = new WhatsappFaqRepository(),
    aiService = new WhatsappFaqAiService(),
    providerService = apitxtService,
    webhookSecret = env.apitxt?.webhookSecret || "",
  } = {}) {
    this.repository = repository;
    this.aiService = aiService;
    this.providerService = providerService;
    this.webhookSecret = webhookSecret;
  }

  verifyWebhook(req) {
    if (!this.webhookSecret) return true;

    const signature = req.get("x-apitxt-signature") ||
      req.get("x-signature") ||
      req.get("x-hub-signature-256") ||
      "";
    if (!signature) throw new AppError("Missing webhook signature", 401);

    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const digest = crypto
      .createHmac("sha256", this.webhookSecret)
      .update(rawBody)
      .digest("hex");
    const expected = signature.startsWith("sha256=") ? `sha256=${digest}` : digest;

    const left = Buffer.from(String(signature));
    const right = Buffer.from(expected);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
      throw new AppError("Invalid webhook signature", 401);
    }
    return true;
  }

  extractWebhookMessage(payload = {}) {
    const message = payload.message || payload.messages?.[0] || payload.data?.message || payload.data?.messages?.[0] || payload.data || payload;
    const eventId = String(
      payload.event_id ||
      payload.eventId ||
      payload.id ||
      message.id ||
      message.message_id ||
      message.messageId ||
      "",
    ).trim();
    const phone = String(
      message.from ||
      message.sender ||
      message.mobile ||
      message.phone ||
      message.wa_id ||
      message.customer_phone ||
      payload.from ||
      payload.mobile ||
      "",
    ).trim();
    const textPayload = message.text;
    const text = String(
      typeof textPayload === "object" ? textPayload.body : textPayload ||
      message.body ||
      message.message ||
      payload.text ||
      "",
    ).trim();
    const type = String(message.type || payload.type || "text").toLowerCase();

    return { eventId, phone, text, type };
  }

  assertSupportedMessage({ phone, text, type }) {
    if (!phone) throw new AppError("Missing WhatsApp customer phone number", 202);
    if (!SUPPORTED_TEXT_TYPES.has(type)) throw new AppError("Unsupported WhatsApp message type", 202);
    if (!text) throw new AppError("Empty WhatsApp text message", 202);
  }

  async processWebhook(req) {
    this.verifyWebhook(req);
    const incoming = this.extractWebhookMessage(req.body || {});
    if (!incoming.eventId) {
      const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
      incoming.eventId = crypto.createHash("sha256").update(rawBody).digest("hex");
    }

    logger.info({
      provider: "apitxt",
      eventId: incoming.eventId || null,
      phone: maskPhone(incoming.phone),
      type: incoming.type,
    }, "WhatsApp FAQ webhook received");

    this.assertSupportedMessage(incoming);

    const duplicate = await this.repository.findMessageByProviderEvent("apitxt", incoming.eventId);
    if (duplicate) {
      logger.info({ provider: "apitxt", eventId: incoming.eventId }, "Duplicate WhatsApp webhook ignored");
      return { status: "duplicate", sent: false };
    }

    const conversation = await this.repository.upsertConversation({
      customerPhoneHash: hashPhone(incoming.phone),
      customerPhoneMasked: maskPhone(incoming.phone),
      provider: "apitxt",
    });

    const inbound = await this.repository.createMessage({
      conversationId: conversation.id,
      provider: "apitxt",
      providerEventId: incoming.eventId || null,
      direction: "inbound",
      messageType: incoming.type,
      text: incoming.text,
      status: "received",
    });

    const history = await this.repository.getRecentMessages(conversation.id, { limit: 6 });
    const faqs = await this.repository.searchFaqs(incoming.text, { limit: 5 });
    logger.info({
      provider: "apitxt",
      eventId: incoming.eventId || null,
      matchedFaqCount: faqs.length,
      bestFaqId: faqs[0]?.id || null,
    }, "WhatsApp FAQ search completed");

    const answer = await this.aiService.generateAnswer({
      customerMessage: incoming.text,
      faqs,
      history,
    });

    let sendResult = null;
    try {
      sendResult = await this.providerService.sendWhatsappMessage({
        to: incoming.phone,
        message: answer.answer,
      });
      logger.info({ provider: "apitxt", eventId: incoming.eventId || null }, "WhatsApp FAQ answer sent");
    } catch (error) {
      logger.error({ err: error, provider: "apitxt", eventId: incoming.eventId || null }, "WhatsApp FAQ answer send failed");
    }

    await this.repository.createMessage({
      conversationId: conversation.id,
      provider: "apitxt",
      direction: "outbound",
      messageType: "text",
      text: answer.answer,
      faqEntryIds: faqs.map((faq) => faq.id),
      status: sendResult ? "sent" : "send_failed",
      metadata: {
        inboundMessageId: inbound.id,
        ai: {
          answered: answer.answered,
          confidence: answer.confidence,
          source: answer.source,
        },
        providerRequestId: sendResult?.requestId || null,
      },
    });

    return {
      status: "processed",
      sent: Boolean(sendResult),
      matchedFaqCount: faqs.length,
    };
  }
}

module.exports = { WhatsappWebhookService, maskPhone };
