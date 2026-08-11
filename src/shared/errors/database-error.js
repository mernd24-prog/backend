const TRANSIENT_DATABASE_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT",
  "57P01", "57P02", "57P03", // PostgreSQL shutdown/startup states
  "53300", // too many connections
  "40001", // serialization failure
  "40P01", // deadlock detected
]);

const TRANSIENT_DATABASE_MESSAGES = [
  "connection terminated unexpectedly",
  "connection ended unexpectedly",
  "connection terminated",
  "connection timeout",
  "timeout acquiring a connection",
  "client has already been released",
  "the database system is starting up",
  "the database system is shutting down",
];

function databaseErrorCode(error) {
  return String(error?.code || error?.original?.code || error?.parent?.code || "");
}

function databaseErrorMessage(error) {
  return String(error?.message || error?.original?.message || error?.parent?.message || "").toLowerCase();
}

function isTransientDatabaseError(error) {
  const code = databaseErrorCode(error);
  if (TRANSIENT_DATABASE_CODES.has(code) || code.startsWith("08")) return true;
  const message = databaseErrorMessage(error);
  return TRANSIENT_DATABASE_MESSAGES.some((fragment) => message.includes(fragment));
}

function classifyPostgresError(error) {
  const code = databaseErrorCode(error);
  if (isTransientDatabaseError(error)) {
    return {
      statusCode: 503,
      code: "DATABASE_UNAVAILABLE",
      message: "The service is temporarily unavailable. Please retry this request.",
      retryAfterSeconds: 1,
    };
  }
  if (code === "23505") return { statusCode: 409, code: "DUPLICATE_ENTRY", message: "A matching record already exists." };
  if (code === "23503") return { statusCode: 409, code: "DEPENDENCY_CONFLICT", message: "This operation conflicts with a related record." };
  if (code === "23502") return { statusCode: 422, code: "REQUIRED_VALUE_MISSING", message: "A required value is missing." };
  if (code === "22P02") return { statusCode: 422, code: "INVALID_VALUE", message: "One of the supplied values is invalid." };
  if (code === "57014") return { statusCode: 503, code: "DATABASE_TIMEOUT", message: "The request timed out. Please retry it." };
  return null;
}

async function withTransientDatabaseRetry(operation, { attempts = 2, delayMs = 40 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseError(error) || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError;
}

module.exports = {
  classifyPostgresError,
  isTransientDatabaseError,
  withTransientDatabaseRetry,
};
