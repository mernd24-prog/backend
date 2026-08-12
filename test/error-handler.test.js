const assert = require("node:assert/strict");
const test = require("node:test");

const { errorHandler } = require("../src/shared/middleware/error-handler");
const { AppError } = require("../src/shared/errors/app-error");

/**
 * Helper to execute Express error handler
 */
function runErrorHandler(error) {
  let statusCode = null;
  let body = null;

  console.log("\n====================================================");
  console.log("ERROR HANDLER TEST");
  console.log("====================================================");

  console.log("Incoming Error:");
  console.dir(error, { depth: null });

  const req = {
    originalUrl: "/api/v1/seller/onboarding",
    method: "POST",
    log: {
      error: (...args) => console.error("[REQ ERROR]", ...args),
      warn: (...args) => console.warn("[REQ WARN]", ...args),
      info: (...args) => console.log("[REQ INFO]", ...args),
    },
  };

  const res = {
    headersSent: false,

    status(code) {
      console.log("Setting Status:", code);
      statusCode = code;
      return this;
    },

    json(payload) {
      console.log("Sending Response:");
      console.dir(payload, { depth: null });

      body = payload;
      return this;
    },
  };

  errorHandler(error, req, res, () => {});

  console.log("====================================================\n");

  return { statusCode, body };
}

/* -------------------------------------------------------------------------- */
/*                                APITXT DOWN                                 */
/* -------------------------------------------------------------------------- */

test("error handler preserves AppError message for APITXT dependency errors", () => {
  const result = runErrorHandler(
    new AppError(
      "Identity verification service is currently unavailable. Please try again later.",
      503,
      null,
      "DEPENDENCY_INACTIVE"
    )
  );

  assert.equal(result.statusCode, 503);
  assert.equal(
    result.body.message,
    "Identity verification service is currently unavailable. Please try again later."
  );
  assert.equal(result.body.code, "DEPENDENCY_INACTIVE");
});

/* -------------------------------------------------------------------------- */
/*                              APITXT TIMEOUT                                */
/* -------------------------------------------------------------------------- */

test("error handler returns timeout error for APITXT", () => {
  const result = runErrorHandler(
    new AppError(
      "PAN verification service timed out.",
      504,
      null,
      "DEPENDENCY_TIMEOUT"
    )
  );

  assert.equal(result.statusCode, 504);
  assert.equal(
    result.body.message,
    "PAN verification service timed out."
  );
  assert.equal(result.body.code, "DEPENDENCY_TIMEOUT");
});

/* -------------------------------------------------------------------------- */
/*                              APITXT AUTH FAIL                              */
/* -------------------------------------------------------------------------- */

test("error handler returns authentication failure", () => {
  const result = runErrorHandler(
    new AppError(
      "Identity verification service authentication failed.",
      502,
      null,
      "DEPENDENCY_AUTH_FAILED"
    )
  );

  assert.equal(result.statusCode, 502);
  assert.equal(
    result.body.message,
    "Identity verification service authentication failed."
  );
  assert.equal(result.body.code, "DEPENDENCY_AUTH_FAILED");
});

/* -------------------------------------------------------------------------- */
/*                             PAN VERIFICATION                               */
/* -------------------------------------------------------------------------- */

test("error handler returns PAN verification failed", () => {
  const result = runErrorHandler(
    new AppError(
      "PAN could not be verified.",
      400,
      null,
      "PAN_VERIFICATION_FAILED"
    )
  );

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.message, "PAN could not be verified.");
  assert.equal(result.body.code, "PAN_VERIFICATION_FAILED");
});

/* -------------------------------------------------------------------------- */
/*                           INVALID PAN FORMAT                               */
/* -------------------------------------------------------------------------- */

test("error handler returns invalid PAN format", () => {
  const result = runErrorHandler(
    new AppError(
      "Invalid PAN number.",
      400,
      null,
      "INVALID_PAN"
    )
  );

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.message, "Invalid PAN number.");
  assert.equal(result.body.code, "INVALID_PAN");
});

/* -------------------------------------------------------------------------- */
/*                          MISSING PAN NUMBER                                */
/* -------------------------------------------------------------------------- */

test("error handler returns missing PAN number", () => {
  const result = runErrorHandler(
    new AppError(
      "PAN number is required.",
      400,
      null,
      "PAN_REQUIRED"
    )
  );

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.message, "PAN number is required.");
  assert.equal(result.body.code, "PAN_REQUIRED");
});

/* -------------------------------------------------------------------------- */
/*                      APITXT RETURNS UNKNOWN ERROR                          */
/* -------------------------------------------------------------------------- */

test("error handler handles unknown APITXT error", () => {
  const result = runErrorHandler(
    new AppError(
      "Identity verification failed.",
      502,
      null,
      "DEPENDENCY_ERROR"
    )
  );

  assert.equal(result.statusCode, 502);
  assert.equal(
    result.body.message,
    "Identity verification failed."
  );
  assert.equal(result.body.code, "DEPENDENCY_ERROR");
});

/* -------------------------------------------------------------------------- */
/*                             GENERIC SERVER ERROR                           */
/* -------------------------------------------------------------------------- */

test("error handler still hides unknown server errors", () => {
  const result = runErrorHandler(
    new Error("Database password leaked in message")
  );

  assert.equal(result.statusCode, 500);
  assert.equal(
    result.body.message,
    "An unexpected error occurred. Please try again later."
  );
});

/* -------------------------------------------------------------------------- */
/*                         UNKNOWN APP ERROR CODE                             */
/* -------------------------------------------------------------------------- */

test("error handler preserves custom AppError", () => {
  const result = runErrorHandler(
    new AppError(
      "Something unexpected happened.",
      422,
      null,
      "CUSTOM_ERROR"
    )
  );

  assert.equal(result.statusCode, 422);
  assert.equal(result.body.message, "Something unexpected happened.");
  assert.equal(result.body.code, "CUSTOM_ERROR");
});

console.log("\nAll Error Handler Tests Loaded.\n");