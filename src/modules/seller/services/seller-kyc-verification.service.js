const { env } = require("../../../config/env");
const { apitxtService } = require("../../../integrations/apitxt");
const { AppError } = require("../../../shared/errors/app-error");
const { logger } = require("../../../shared/logger/logger");
const { ApitxtError } = require("../../../integrations/apitxt/apitxt.errors");
const { sendMail } = require("../../../infrastructure/mail/mailer");

const escapeHtml = (value = "") => String(value).replace(/[&<>\"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
}[character]));

async function emailApitxtFailure(error, { operation, sellerName } = {}) {
  const recipient = env.apitxt.alertEmail;
  if (!recipient || !(error instanceof ApitxtError)) return;

  const details = [
    ["Operation", operation || "KYC verification"],
    ["Occurred at", new Date().toISOString()],
    ["HTTP status", error.statusCode || "unknown"],
    ["Provider code", error.providerCode || "not provided"],
    ["Seller", sellerName || "Seller name unavailable"],
    ["Provider message", error.message || "No message provided"],
  ];
  const text = ["APITXT verification request failed", ...details.map(([label, value]) => `${label}: ${value}`)].join("\n");
  const rows = details.map(([label, value]) => `<tr><td style=\"padding:10px 12px;color:#64748b;border-bottom:1px solid #e2e8f0;\">${escapeHtml(label)}</td><td style=\"padding:10px 12px;color:#0f172a;font-weight:600;border-bottom:1px solid #e2e8f0;\">${escapeHtml(value)}</td></tr>`).join("");
  const safeOperation = escapeHtml(operation || "KYC verification");
  const html = `
    <div style="margin:0;background:#f1f5f9;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
        <div style="background:#123b35;padding:22px 28px;color:#ffffff;">
          <div style="font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:#b8d8cf;">Sam Global · Operations</div>
          <h1 style="margin:10px 0 0;font-size:22px;line-height:1.3;">APITXT verification alert</h1>
        </div>
        <div style="padding:26px 28px;">
          <div style="display:inline-block;background:#fff1f0;color:#b42318;padding:6px 10px;border-radius:20px;font-size:12px;font-weight:700;">ACTION REQUIRED</div>
          <h2 style="margin:16px 0 8px;font-size:18px;">${safeOperation} failed</h2>
          <p style="margin:0 0 18px;color:#475569;line-height:1.6;">An APITXT verification request could not be completed. Check the provider dashboard for the request status and account access.</p>
          <table style="width:100%;border-collapse:collapse;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">${rows}</table>
          <p style="margin:20px 0 0;color:#64748b;font-size:12px;line-height:1.5;">This automated alert excludes Aadhaar, PAN, and GST numbers.</p>
        </div>
        <div style="padding:14px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;">Sam Global · Automated provider monitoring</div>
      </div>
    </div>`;

  try {
    await sendMail({
      to: recipient,
      subject: `Action required | APITXT ${operation || "KYC verification"} failed`,
      text,
      html,
      type: "general",
    });
  } catch (mailError) {
    logger.error?.({
      operation: operation || "KYC verification",
      errorName: mailError.name,
      errorMessage: mailError.message,
    }, "Failed to send APITXT failure alert email");
  }
}


class SellerKycVerificationService {

  constructor({
    identityVerificationProvider = apitxtService,
    enabled = env.apitxt.enabled,
    verifyAadhaar = env.apitxt.verifyAadhaar,
    verifyPan = env.apitxt.verifyPan,
    verifyGst = env.apitxt.verifyGst,
    staticOtp = env.auth.staticOtp || "123456",
    logger: serviceLogger = logger,
  } = {}) {

    this.identityVerificationProvider =
      identityVerificationProvider;

    this.enabled = enabled;

    this.verifyAadhaar =
      verifyAadhaar;

    this.verifyPan =
      verifyPan;

    this.verifyGst =
      verifyGst;

    this.staticOtp =
      String(staticOtp || "123456").trim();

    this.logger =
      serviceLogger;
  }

  makeMockAadhaarReferenceId() {
    return `mock-aadhaar-${Date.now()}`;
  }

  getUserFacingVerificationMessage(result, fallbackMessage) {
    const providerMessage = String(result?.message || "").trim();
    const normalizedMessage = providerMessage.toLowerCase();

    if (
      normalizedMessage === "verification_failed" ||
      normalizedMessage === "verification failed" ||
      normalizedMessage === "invalid_otp" ||
      normalizedMessage === "otp_invalid"
    ) {
      return fallbackMessage;
    }

    return providerMessage || fallbackMessage;
  }



  async verifyForOnboarding(payload, context = {}) {

    if (!this.enabled) {

      return {
        skipped: true,
        reason: "apitxt_disabled",
      };

    }


    console.log("\n==================================================");
    console.log("SELLER KYC VERIFICATION START");
    console.log("==================================================");

    console.log("Payload:");

    console.dir(
      payload,
      {
        depth:null
      }
    );



    try {


      let panResult = null;
      let gstResult = null;



      /*
       * PAN Verification
       * Existing flow unchanged
       */


      if(this.verifyPan){


        console.log(
          "\nVerifying PAN..."
        );


        panResult =
          await this.identityVerificationProvider.verifyPan({

            panNumber:
              payload.panNumber,


            name:
              payload.legalName,


            dob:
              payload.dateOfBirth,

          });



        console.log(
          "PAN Response:"
        );


        console.dir(
          panResult,
          {
            depth:null
          }
        );



        this.assertVerified(
          panResult,
          "panNumber",
          "PAN verification failed."
        );


      }

      if(this.verifyGst && payload.gstNumber){

        console.log(
          "\nVerifying GST..."
        );
        console.log("[SellerKYC][GST] starting", {
        sellerName: context.sellerName,
          verifyGst: this.verifyGst,
          hasGstNumber: Boolean(payload.gstNumber),
        });
        this.logger.info?.(
          {
            provider: "apitxt",
            sellerId: context.sellerId || null,
            verifyGst: this.verifyGst,
            hasGstNumber: Boolean(payload.gstNumber),
          },
          "Seller onboarding GST verification starting",
        );

        gstResult =
          await this.identityVerificationProvider.verifyGst(
            payload.gstNumber
          );

        console.log(
          "GST Response:"
        );

        console.dir(
          gstResult,
          {
            depth:null
          }
        );

        this.assertVerified(
          gstResult,
          "gstNumber",
          "GST verification failed."
        );

        this.logger.info?.(
          {
            provider: "apitxt",
            sellerId: context.sellerId || null,
            gstVerified: gstResult?.verified === true,
            message: gstResult?.message || null,
          },
          "Seller onboarding GST verification completed",
        );
        console.log("[SellerKYC][GST] completed", {
          sellerId: context.sellerId || null,
          gstVerified: gstResult?.verified === true,
          message: gstResult?.message || null,
        });

      }
      else {
        console.log("[SellerKYC][GST] skipped", {
          sellerId: context.sellerId || null,
          verifyGst: this.verifyGst,
          hasGstNumber: Boolean(payload.gstNumber),
        });
      }



      console.log(
        "\nSeller KYC Verification Successful."
      );


      console.log(
        "==================================================\n"
      );



      return {

        skipped:false,

        provider:"apitxt",

        aadhaarVerified:
          false,


        panVerified:
          Boolean(this.verifyPan),

        panResult,

        gstVerified:
          Boolean(this.verifyGst && payload.gstNumber),

        gstResult,

      };



    } catch(error){

      await emailApitxtFailure(error, {
        operation: "Seller PAN/GST onboarding verification",
        sellerName: context.sellerName,
      });


      console.log(
        "\n=================================================="
      );

      console.log(
        "SELLER KYC VERIFICATION FAILED"
      );

      console.log(
        "=================================================="
      );



      console.error(
        "Error Class:",
        error.constructor?.name
      );


      console.error(
        "Status Code:",
        error.statusCode
      );


      console.error(
        "Error Code:",
        error.code
      );


      console.error(
        "Provider Code:",
        error.providerCode
      );


      console.error(
        "Message:",
        error.message
      );



      if(error.response){

        console.error(
          "Provider Response:"
        );


        console.dir(
          error.response,
          {
            depth:null
          }
        );

      }



      console.error(
        "Stack:"
      );


      console.error(
        error.stack
      );



      console.log(
        "==================================================\n"
      );




      if(error instanceof AppError){

        throw error;

      }



      if(error instanceof ApitxtError){


        this.logger.error?.(

          {

            err:error,

            sellerId:
              context.sellerId || null,


            providerCode:
              error.providerCode || null,

          },

          "APITXT seller KYC verification failed"

        );



        throw new AppError(

          error.message,

          error.statusCode || 503,

          null,


          error.code ||

          (
            error.statusCode === 422

            ? "VALIDATION_ERROR"

            : "DEPENDENCY_INACTIVE"

          )

        );

      }



      throw error;

    }

  }




  async verifyAadhaarOtp({
    reference_id,
    otp
  }, context = {}) {

    if (!this.enabled || !this.verifyAadhaar) {
      const verified = String(otp || "").trim() === this.staticOtp;
      return {
        skipped: true,
        testMode: true,
        verificationMode: "TEST_MODE",
        provider: "static",
        field: "aadhaarNumber",
        verified,
        providerReferenceId: reference_id || null,
        message: verified
          ? "Aadhaar OTP verified with static test OTP."
          : "Invalid Aadhaar OTP. Use the configured static OTP for testing.",
        raw: {
          mode: "static_otp",
          reason: !this.enabled
            ? "apitxt_disabled"
            : "aadhaar_verification_disabled",
          reference_id,
        },
      };
    }

    let response;
    try {
      response = await this.identityVerificationProvider.verifyAadhaarOtp({

        reference_id,

        otp

      });
    } catch (error) {
      await emailApitxtFailure(error, { operation: "Aadhaar OTP verification", sellerName: context.sellerName });
      throw error;
    }


    return response;

  }

  async verifyPanDetails({
    panNumber,
    legalName,
    name,
    dateOfBirth,
    dob,
  } = {}, context = {}) {
    if (!this.enabled || !this.verifyPan) {
      return {
        skipped: true,
        testMode: true,
        verificationMode: "TEST_MODE",
        provider: "static",
        field: "panNumber",
        verified: true,
        message: "PAN verification skipped in testing.",
        raw: {
          mode: "static_pan",
          reason: !this.enabled
            ? "apitxt_disabled"
            : "pan_verification_disabled",
        },
      };
    }

    let result;
    try {
      result = await this.identityVerificationProvider.verifyPan({
        panNumber,
        name: name || legalName,
        dob: dob || dateOfBirth,
      });
    } catch (error) {
      await emailApitxtFailure(error, { operation: "PAN verification", sellerName: context.sellerName });
      throw error;
    }

    this.assertVerified(
      result,
      "panNumber",
      "PAN verification failed.",
    );

    return result;
  }

  async verifyGstDetails({
    gstNumber,
    gstin,
  } = {}, context = {}) {
    if (!this.enabled || !this.verifyGst) {
      console.log("[SellerKYC][GST] skipped", {
        enabled: this.enabled,
        verifyGst: this.verifyGst,
        hasGstNumber: Boolean(gstNumber || gstin),
      });
      return {
        skipped: true,
        testMode: true,
        verificationMode: "TEST_MODE",
        provider: "static",
        field: "gstNumber",
        verified: true,
        message: "GST verification skipped in testing.",
        raw: {
          mode: "static_gst",
          reason: !this.enabled
            ? "apitxt_disabled"
            : "gst_verification_disabled",
        },
      };
    }

    console.log("[SellerKYC][GST] starting", {
      enabled: this.enabled,
      verifyGst: this.verifyGst,
      hasGstNumber: Boolean(gstNumber || gstin),
    });

    let result;
    try {
      result = await this.identityVerificationProvider.verifyGst(
        gstNumber || gstin,
      );
    } catch (error) {
      await emailApitxtFailure(error, { operation: "GST verification", sellerName: context.sellerName });
      throw error;
    }

    this.assertVerified(
      result,
      "gstNumber",
      "GST verification failed.",
    );

    console.log("[SellerKYC][GST] completed", {
      gstVerified: result?.verified === true,
      message: result?.message || null,
    });

    return result;
  }

  async sendAadhaarOtp(aadhaarNumber, context = {}) {
    if (!this.enabled || !this.verifyAadhaar) {
      const referenceId = this.makeMockAadhaarReferenceId();
      return {
        skipped: true,
        testMode: true,
        verificationMode: "TEST_MODE",
        provider: "static",
        reason: !this.enabled
          ? "apitxt_disabled"
          : "aadhaar_verification_disabled",
        reference_id: referenceId,
        response: {
          provider: "static",
          reference_id: referenceId,
          message: "Static Aadhaar OTP generated for testing.",
        },
        message: `Use OTP ${this.staticOtp} for Aadhaar verification in testing.`,
      };
    }

    let response = null;
    try {
      response = await this.identityVerificationProvider.sendAadhaarOtp(aadhaarNumber);
    } catch (error) {
      await emailApitxtFailure(error, { operation: "Aadhaar OTP send", sellerName: context.sellerName });
      if (error instanceof ApitxtError) {
        const message =
          String(error.providerCode || "") === "310"
            ? "Aadhaar OTP could not be sent for this number. Please check Aadhaar/mobile linkage or try again later."
            : error.message || "Aadhaar OTP could not be sent. Please check the Aadhaar number and try again.";

        this.logger.warn?.(
          {
            err: error,
            providerCode: error.providerCode || null,
          },
          "APITXT Aadhaar OTP send failed",
        );

        throw AppError.validation(message, [
          {
            field: "aadhaarNumber",
            message,
          },
        ]);
      }

      throw error;
    }

    return {
      skipped: false,
      provider: "apitxt",
      reference_id:
        response.reference_id ||
        response.referenceId ||
        response.data?.reference_id ||
        response.data?.referenceId ||
        response.result?.reference_id ||
        response.result?.referenceId ||
        null,
      response,
      message: response.message || response.data?.message || "Aadhaar OTP sent successfully",
    };
  }




  assertVerified(
    result,
    field,
    fallbackMessage
  ){

    if(result?.verified){

      return;

    }



    const message = this.getUserFacingVerificationMessage(
      result,
      fallbackMessage,
    );



    throw AppError.validation(

      message,


      [

        {

          field,

          message,

        }

      ]

    );

  }

}



module.exports = {
  SellerKycVerificationService
};
