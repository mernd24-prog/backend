const { APITXT_PROVIDER } = require("./apitxt.constants");

function isVerifiedResponse(response = {}) {
  const status = String(
    response.status ||
    response.verificationStatus ||
    response.result?.status ||
    response.data?.status ||
    "",
  ).toLowerCase();
  const message = String(
    response.message ||
    response.result?.message ||
    response.data?.message ||
    "",
  ).toLowerCase();

  return (
    response.verified === true ||
    response.success === true ||
    response.result?.verified === true ||
    response.data?.verified === true ||
    ["200", "verified", "valid", "success", "matched", "approved"].includes(status) ||
    ["success", "verified", "valid", "matched", "approved"].includes(message)
  );
}

function isGstVerifiedResponse(response = {}) {
  const explicitVerified =
    response.verified ??
    response.result?.verified ??
    response.data?.verified;

  if (explicitVerified !== undefined && explicitVerified !== null) {
    return explicitVerified === true || String(explicitVerified).toLowerCase() === "true";
  }

  const gstStatus = String(
    response.result?.status ||
    response.data?.status ||
    response.verificationStatus ||
    "",
  ).toLowerCase();

  return ["verified", "valid", "active", "matched", "approved"].includes(gstStatus);
}

function getProviderReferenceId(response = {}) {
  return (
    response.reference_id ||
    response.request_id ||
    response.requestId ||
    response.referenceId ||
    response.transactionId ||
    response.data?.reference_id ||
    response.data?.request_id ||
    response.data?.requestId ||
    response.data?.referenceId ||
    response.result?.reference_id ||
    response.result?.request_id ||
    response.result?.requestId ||
    null
  );
}

function getProviderMessage(response = {}, fallback) {
  return (
    response.message ||
    response.error ||
    response.reason ||
    response.data?.message ||
    response.result?.message ||
    fallback
  );
}

function firstNonEmpty(...values) {
  return values.find((value) => String(value || "").trim()) || null;
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    return [
      slashMatch[3],
      slashMatch[2].padStart(2, "0"),
      slashMatch[1].padStart(2, "0"),
    ].join("-");
  }

  const dashMatch = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dashMatch) {
    return [
      dashMatch[3],
      dashMatch[2].padStart(2, "0"),
      dashMatch[1].padStart(2, "0"),
    ].join("-");
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString().slice(0, 10);
}

function extractAadhaarProfile(response = {}) {
  const data = response.data || {};
  const result = response.result || {};
  const user = data.user || data.profile || result.user || result.profile || {};

  const fullName = firstNonEmpty(
    response.fullName,
    response.full_name,
    response.name,
    data.fullName,
    data.full_name,
    data.name,
    result.fullName,
    result.full_name,
    result.name,
    user.fullName,
    user.full_name,
    user.name,
  );

  const dateOfBirth = normalizeDate(
    firstNonEmpty(
      response.dateOfBirth,
      response.date_of_birth,
      response.dob,
      data.dateOfBirth,
      data.date_of_birth,
      data.dob,
      result.dateOfBirth,
      result.date_of_birth,
      result.dob,
      user.dateOfBirth,
      user.date_of_birth,
      user.dob,
    ),
  );

  if (!fullName && !dateOfBirth) return null;

  return {
    ...(fullName ? { fullName, legalName: fullName } : {}),
    ...(dateOfBirth ? { dateOfBirth } : {}),
  };
}

function sanitizeProviderResponse(response = {}) {
  return response;
}

function mapVerificationResponse(field, response = {}) {
  const verified =
    field === "gstNumber"
      ? isGstVerifiedResponse(response)
      : isVerifiedResponse(response);
  const aadhaarProfile = field === "aadhaarNumber" ? extractAadhaarProfile(response) : null;

  return {
    provider: APITXT_PROVIDER,
    field,
    verified,
    providerReferenceId: getProviderReferenceId(response),
    message: getProviderMessage(
      response,
      verified
        ? `${field} verified successfully.`
        : `${field} verification failed.`,
    ),
    ...(aadhaarProfile ? { aadhaarProfile, prefill: aadhaarProfile } : {}),
    raw: sanitizeProviderResponse(response),
  };
}

module.exports = {
  mapVerificationResponse,
  extractAadhaarProfile,
};
