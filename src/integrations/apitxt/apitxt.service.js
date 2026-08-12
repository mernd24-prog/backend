const { APITXT_ENDPOINTS } = require("./apitxt.constants");
const { ApitxtError } = require("./apitxt.errors");
const { mapVerificationResponse } = require("./apitxt.mapper");
const { logger } = require("../../shared/logger/logger");

function formatPanDob(value) {
  if (!value) return "";

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return "";

    const day = String(value.getDate()).padStart(2, "0");
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const year = value.getFullYear();

    return `${day}/${month}/${year}`;
  }

  const text = String(value).trim();

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
    return text;
  }

  const date = new Date(text);

  if (!isNaN(date.getTime())) {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();

    return `${day}/${month}/${year}`;
  }

  return text;
}

const maskMobile = (mobile = "") => {
  const normalized = String(mobile || "").replace(/\D/g, "");
  if (normalized.length <= 4) return "****";
  return `${normalized.slice(0, 2)}****${normalized.slice(-4)}`;
};

const maskAadhaar = (aadhaarNumber = "") => {
  const normalized = String(aadhaarNumber || "").replace(/\D/g, "");
  if (normalized.length <= 4) return "************";
  return `${"*".repeat(Math.max(normalized.length - 4, 0))}${normalized.slice(-4)}`;
};

const maskPan = (panNumber = "") => {
  const normalized = String(panNumber || "").trim().toUpperCase();
  if (normalized.length <= 4) return "*****redacted*****";
  return `${normalized.slice(0, 2)}*****${normalized.slice(-2)}`;
};

const isProviderSuccess = (response = {}) => {
  const status = String(response?.status || response?.data?.status || "").toLowerCase();
  const code = String(response?.code || response?.data?.code || "").toLowerCase();

  return (
    response?.success === true ||
    response?.data?.success === true ||
    ["success", "sent", "otp_sent", "200"].includes(status) ||
    ["success", "sent", "otp_sent", "200"].includes(code)
  );
};

const hasReferenceId = (response = {}) =>
  Boolean(
    response?.reference_id ||
      response?.referenceId ||
      response?.data?.reference_id ||
      response?.data?.referenceId ||
      response?.result?.reference_id ||
      response?.result?.referenceId,
  );


class ApitxtService {

  constructor({
    client,
    authKey = "",
    panVerifyUrl = ""
  } = {}) {
    this.client = client;
    this.authKey = authKey;
    this.panVerifyUrl = panVerifyUrl;
  }


  // STEP 1: Send Aadhaar OTP
  async sendAadhaarOtp(aadhaarNumber) {
    if (!this.authKey) {
      throw new ApitxtError(
        "APITXT auth key is not configured.",
        {
          statusCode: 503,
          retryable: false
        }
      );
    }


    const requestBody = {
      authkey: this.authKey,
      aadhaar_number: aadhaarNumber
    };

    logger.debug(
      {
        provider: "apitxt",
        aadhaarNumber: maskAadhaar(aadhaarNumber),
      },
      "APITXT Aadhaar OTP request prepared",
    );


    const response = await this.client.post(
      APITXT_ENDPOINTS.SEND_AADHAAR_OTP,
      requestBody
    );

    if (!isProviderSuccess(response) && !hasReferenceId(response)) {
      logger.warn(
        {
          provider: "apitxt",
          aadhaarNumber: maskAadhaar(aadhaarNumber),
          status: response?.status || null,
          code: response?.code || null,
          message: response?.message || null,
        },
        "APITXT Aadhaar OTP provider returned failure",
      );

      throw new ApitxtError(
        response?.message || "Failed to send Aadhaar OTP. Please try again later.",
        {
          statusCode: 502,
          providerCode: response?.code || response?.status || null,
          details: response,
          retryable: false,
        },
      );
    }

    logger.debug(
      {
        provider: "apitxt",
        aadhaarNumber: maskAadhaar(aadhaarNumber),
        status: response?.status || null,
        hasReferenceId: hasReferenceId(response),
      },
      "APITXT Aadhaar OTP provider response accepted",
    );


    return response;
  }

  async sendSmsOtp({
    mobile,
    otp,
    channel,
    templateId,
    country,
    templateName,
    projectRefId,
    url,
  } = {}) {
    if (!this.authKey) {
      throw new ApitxtError(
        "APITXT auth key is not configured.",
        {
          statusCode: 503,
          retryable: false
        }
      );
    }

    logger.debug(
      {
        provider: "apitxt",
        mobile: maskMobile(mobile),
        hasChannel: Boolean(channel),
        hasTemplateId: Boolean(templateId),
        country,
        hasTemplateName: Boolean(templateName),
        hasProjectRefId: Boolean(projectRefId),
      },
      "APITXT SMS OTP request prepared",
    );

    const response = await this.client.get(
      url || APITXT_ENDPOINTS.SEND_SMS_OTP,
      {
        authkey: this.authKey,
        mobile,
        otp,
        channel,
        template_id: templateId,
        country,
        template_name: templateName,
        project_ref_id: projectRefId,
      },
    );

    if (
      String(response?.status || "").toLowerCase() !== "success" &&
      response?.success !== true
    ) {
      logger.warn(
        {
          provider: "apitxt",
          mobile: maskMobile(mobile),
          status: response?.status || null,
          code: response?.code || null,
          message: response?.message || null,
        },
        "APITXT SMS OTP provider returned failure",
      );

      throw new ApitxtError(
        response?.message || "APITXT SMS OTP request failed.",
        {
          statusCode: 502,
          providerCode: response?.code || response?.status || null,
          response,
          retryable: false,
        },
      );
    }

    logger.debug(
      {
        provider: "apitxt",
        mobile: maskMobile(response?.data?.mobile || mobile),
        status: response?.status || null,
        requestId:
          response?.data?.request_id ||
          response?.request_id ||
          response?.requestId ||
          null,
        cost: response?.data?.cost || null,
      },
      "APITXT SMS OTP provider response accepted",
    );

    return {
      success: true,
      requestId:
        response?.data?.request_id ||
        response?.request_id ||
        response?.requestId ||
        null,
      mobile: response?.data?.mobile || mobile,
      cost: response?.data?.cost || null,
      providerResponse: response,
    };
  }



  // STEP 2: Verify Aadhaar OTP
  async verifyAadhaarOtp({
    reference_id,
    otp
  }) {
    if (!this.authKey) {
      throw new ApitxtError(
        "APITXT auth key is not configured.",
        {
          statusCode: 503,
          retryable: false
        }
      );
    }


    const requestBody = {
      authkey: this.authKey,
      reference_id,
      otp
    };

    logger.debug(
      {
        provider: "apitxt",
        reference_id,
        hasOtp: Boolean(otp),
      },
      "APITXT Aadhaar OTP verification request prepared",
    );


    const response = await this.client.post(
      APITXT_ENDPOINTS.VERIFY_AADHAAR_OTP,
      requestBody
    );


    return mapVerificationResponse(
      "aadhaarNumber",
      response
    );
  }




  // PAN Verification
  async verifyPan({
    panNumber,
    name,
    dob
  } = {}) {

    if (!this.authKey) {
      throw new ApitxtError(
        "APITXT auth key is not configured.",
        {
          statusCode: 503,
          retryable: false
        }
      );
    }

    const formattedDob = formatPanDob(dob);
    if (!formattedDob) {
      throw new ApitxtError(
        "Date of birth is required for PAN verification.",
        {
          statusCode: 422,
          retryable: false,
          details: {
            field: "dateOfBirth",
            message: "Date of birth is required for PAN verification.",
          },
        },
      );
    }

    const requestBody = {
      authkey: this.authKey,
      pan: panNumber,
      name,
      dob: formattedDob
    };

    logger.debug(
      {
        provider: "apitxt",
        url: this.panVerifyUrl || APITXT_ENDPOINTS.VERIFY_PAN,
        panNumber: maskPan(panNumber),
        hasName: Boolean(name),
        hasDob: Boolean(requestBody.dob),
      },
      "APITXT PAN verification request prepared",
    );


    const response = await this.client.post(
      this.panVerifyUrl || APITXT_ENDPOINTS.VERIFY_PAN,
      requestBody
    );


    return mapVerificationResponse(
      "panNumber",
      response
    );
  }




  async verifyGst(gstin) {

    const response = await this.client.post(
      APITXT_ENDPOINTS.VERIFY_GST,
      {
        gstin
      }
    );


    return mapVerificationResponse(
      "gstNumber",
      response
    );
  }




  async verifyBank(bankDetails) {

    const response = await this.client.post(
      APITXT_ENDPOINTS.VERIFY_BANK,
      bankDetails
    );


    return mapVerificationResponse(
      "bankDetails",
      response
    );
  }




  async verifyDrivingLicense(drivingLicenseNumber) {

    const response = await this.client.post(
      APITXT_ENDPOINTS.VERIFY_DRIVING_LICENSE,
      {
        drivingLicenseNumber
      }
    );


    return mapVerificationResponse(
      "drivingLicenseNumber",
      response
    );
  }

}


module.exports = {
  ApitxtService
};
