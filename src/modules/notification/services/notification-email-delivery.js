const { deliveryDecision } = require("./delivery-preferences");

async function deliverNotificationEmail(data, dependencies) {
  const { lookupPreference, lookupDispatch, updateDispatch, send, defer } = dependencies;
  const dispatch = data.dispatchId ? await lookupDispatch(data.dispatchId) : null;
  if (["provider_accepted", "sent", "delivery_unknown", "skipped"].includes(dispatch?.status)) return { skipped: true, reason: dispatch.status };
  const update = patch => data.dispatchId ? updateDispatch(data.dispatchId, patch) : Promise.resolve();
  if (dispatch?.status === "sending") {
    await update({ status: "delivery_unknown", failureReason: "Previous send interrupted; verify provider logs before resending" });
    return { skipped: true, reason: "delivery_unknown" };
  }
  const preference = data.userId ? await lookupPreference(data.userId) : null;
  const decision = deliveryDecision(preference, { channel: "email", eventName: data.eventName, payload: data.payload, scheduled: true });
  if (!decision.allowed) {
    await update({ status: "skipped", failureReason: decision.reason });
    return { skipped: true, reason: decision.reason };
  }
  if (decision.delay) {
    await defer(data, decision.delay);
    await update({ status: "deferred", scheduledFor: new Date(Date.now() + decision.delay) });
    return { deferred: true };
  }
  await update({ status: "sending", lastAttemptAt: new Date() });
  try {
    const result = await send(data);
    const accepted = result?.accepted?.length && !String(result?.messageId || "").startsWith("static-");
    await update({ status: accepted ? "provider_accepted" : "skipped", providerMessageId: accepted ? result.messageId : null,
      sentAt: accepted ? new Date() : null, failureReason: accepted ? null : "Email not accepted by live provider" });
    return { accepted: Boolean(accepted) };
  } catch (error) {
    const beforeSend = ["CONN", "AUTH"].includes(error.command);
    await update({ status: beforeSend ? "failed" : "delivery_unknown", failureReason: String(error.message || "Email delivery failed").slice(0, 500) });
    if (beforeSend) throw error;
    return { deliveryUnknown: true };
  }
}
module.exports = { deliverNotificationEmail };
