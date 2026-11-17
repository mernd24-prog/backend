const critical = /^(auth\.|security\.|refund\.|payment\.refunded|return\.refunded|seller\.payout_status_updated|credit_note\.)/;
function eventCategory(eventName = "", payload = {}) {
  if (["N078", "N079", "N080"].includes(payload.notificationCaseId)) return "promo";
  if (["N075", "N076", "N077", "N108", "N109"].includes(payload.notificationCaseId)) return "referral";
  if (payload.messageClass === "marketing" || /campaign|promo|abandoned|price_drop/.test(eventName)) return "promo";
  if (/payment|refund/.test(eventName)) return "payment";
  if (/shipment|delivery/.test(eventName)) return "shipping";
  if (/referral|reward/.test(eventName)) return "referral";
  if (/product\./.test(eventName)) return "newProduct";
  return "order";
}
function localMinute(date, timezone) {
  const values = new Intl.DateTimeFormat("en-GB", { timeZone: timezone || "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Number(values.find(part => part.type === "hour").value) * 60 + Number(values.find(part => part.type === "minute").value);
}
function deliveryDecision(preference, { channel = "email", eventName = "", payload = {}, now = new Date(), scheduled = false } = {}) {
  const category = eventCategory(eventName, payload);
  const mandatory = category !== "promo" && (critical.test(eventName) || ["N008", "N009", "N010", "N087", "N096", "N097", "N098", "N107", "N109"].includes(payload.notificationCaseId));
  if (mandatory) return { allowed: true, delay: 0, mandatory: true };
  if (category === "promo" && preference?.marketingConsent?.granted !== true) return { allowed: false, reason: "marketing_consent_required" };
  const field = channel === "in_app" ? "inApp" : channel;
  if (preference?.channels?.[field] === false || preference?.eventTypes?.[category] === false || preference?.frequency === "never") return { allowed: false, reason: "opted_out" };
  if (channel === "sms" && preference?.channels?.sms !== true) return { allowed: false, reason: "sms_opt_in_required" };
  if (channel === "in_app") return { allowed: true, delay: 0 };
  let delay = scheduled ? 0 : preference?.frequency === "weekly" ? 7 * 86400000 : preference?.frequency === "daily" ? 86400000 : 0;
  const toMinute = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || "") ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
  const start = toMinute(preference?.doNotDisturbStart);
  const end = toMinute(preference?.doNotDisturbEnd);
  if (start !== null && end !== null && start !== end) {
    for (let i = 0; i < 1440; i += 1) {
      const minute = localMinute(new Date(now.getTime() + delay), preference.timezone);
      const quiet = start < end ? minute >= start && minute < end : minute >= start || minute < end;
      if (!quiet) break;
      delay += 60000;
    }
  }
  return { allowed: true, delay };
}
module.exports = { deliveryDecision, eventCategory };
