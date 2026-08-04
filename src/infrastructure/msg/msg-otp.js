const axios = require("axios");

const {
  AppError,
} = require("../../shared/errors/app-error");

const sendSmsOtp = async ({
  mobile,
  otp,
  purpose = "buyer_auth",
}) => {
  const url =
    process.env.APITXT_OTP_URL;

  const authKey =
    process.env.APITXT_AUTH_KEY;

  if (!url || !authKey) {
    throw new AppError(
      "SMS OTP provider is not configured",
      503,
    );
  }

  const mobileNumber =
    String(mobile || "")
      .replace(/\D/g, "");

  const form =
    new URLSearchParams();

  form.set("authkey", authKey);
  form.set("mobile", mobileNumber);
  form.set("otp", String(otp));

  if (process.env.APITXT_SENDER_ID) {
    form.set(
      "sender",
      process.env.APITXT_SENDER_ID,
    );
  }

  if (process.env.APITXT_TEMPLATE_ID) {
    form.set(
      "template_id",
      process.env.APITXT_TEMPLATE_ID,
    );
  }

  const response = await axios.post(
    url,
    form.toString(),
    {
      timeout: 10000,

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
      },

      validateStatus: () => true,
    },
  );

  if (
    response.status < 200 ||
    response.status >= 300
  ) {
    throw new AppError(
      response.data?.message ||
      "SMS provider rejected the OTP request",
      502,
    );
  }

  const responseData =
    response.data || {};

  if (
    responseData.success === false ||
    responseData.status === false ||
    responseData.error
  ) {
    throw new AppError(
      responseData.message ||
      "SMS provider rejected the OTP request",
      502,
    );
  }

  return {
    success: true,

    requestId:
      responseData.requestId ||
      responseData.request_id ||
      responseData.id ||
      null,

    providerResponse: responseData,
    purpose,
  };
};

module.exports = {
  sendSmsOtp,
};