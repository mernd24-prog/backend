const { env } = require("../../../config/env");
const { apitxtService } = require("../../../integrations/apitxt");
const { AppError } = require("../../../shared/errors/app-error");
const { logger } = require("../../../shared/logger/logger");
const { ApitxtError } = require("../../../integrations/apitxt/apitxt.errors");


class SellerKycVerificationService {

  constructor({
    identityVerificationProvider = apitxtService,
    enabled = env.apitxt.enabled,
    verifyAadhaar = env.apitxt.verifyAadhaar,
    verifyPan = env.apitxt.verifyPan,
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

      };



    } catch(error){


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
  }) {

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

    const response =
      await this.identityVerificationProvider.verifyAadhaarOtp({

        reference_id,

        otp

      });


    return response;

  }

  async verifyPanDetails({
    panNumber,
    legalName,
    name,
    dateOfBirth,
    dob,
  } = {}) {
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

    const result = await this.identityVerificationProvider.verifyPan({
      panNumber,
      name: name || legalName,
      dob: dob || dateOfBirth,
    });

    this.assertVerified(
      result,
      "panNumber",
      "PAN verification failed.",
    );

    return result;
  }

  async sendAadhaarOtp(aadhaarNumber) {
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
