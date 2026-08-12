const assert = require("node:assert/strict");
const test = require("node:test");

const { ApitxtService } = require("../src/integrations/apitxt/apitxt.service");
const { ApitxtError } = require("../src/integrations/apitxt/apitxt.errors");
const { mapVerificationResponse } = require("../src/integrations/apitxt/apitxt.mapper");
const { SellerService } = require("../src/modules/seller/services/seller.service");
const { sellerOrganizationService } = require("../src/modules/seller/services/seller-organization.service");
const { SellerKycVerificationService } = require("../src/modules/seller/services/seller-kyc-verification.service");
const { AppError } = require("../src/shared/errors/app-error");

test("seller KYC verification skips APITXT when disabled", async () => {
  console.log("\n========================================");
  console.log("TEST: APITXT Disabled");
  console.log("========================================");

  let called = false;

  const service = new SellerKycVerificationService({
    enabled: false,
    identityVerificationProvider: {
      verifyAadhaar: async () => {
        console.log("ERROR: Aadhaar API should NOT be called.");
        called = true;
      },
      verifyPan: async () => {
        console.log("ERROR: PAN API should NOT be called.");
        called = true;
      },
    },
  });

  const payload = {
    aadhaarNumber: "123412341234",
    panNumber: "ABCDE1234F",
  };

  console.log("Payload:", payload);

  const result = await service.verifyForOnboarding(payload);

  console.log("Result:", result);

  assert.equal(result.skipped, true);
  assert.equal(called, false);

  console.log("PASS");
});

test("seller KYC onboarding verifies PAN after Aadhaar OTP step is handled separately", async () => {

  console.log("\n========================================");
  console.log("TEST: Aadhaar OTP Separate From Onboarding");
  console.log("========================================");

  let aadhaarCalled = false;
  let panCalled = false;

  const service = new SellerKycVerificationService({
    enabled: true,
    verifyAadhaar: true,
    identityVerificationProvider: {

      verifyAadhaar: async (payload) => {
        aadhaarCalled = true;

        console.log("Aadhaar Request");
        console.log(payload);

        return {
          verified: false,
          message: "Aadhaar could not be verified.",
        };
      },

      verifyPan: async () => {
        panCalled = true;
        console.log("PAN SHOULD BE CALLED");
        return { verified: true };
      },
    },
  });

  const result = await service.verifyForOnboarding({
    aadhaarNumber: "123412341234",
    panNumber: "ABCDE1234F",
  });

  console.log("Aadhaar Called:", aadhaarCalled);
  console.log("PAN Called:", panCalled);

  assert.equal(aadhaarCalled, false);
  assert.equal(panCalled, true);
  assert.equal(result.panVerified, true);

  console.log("PASS");
});

test("seller KYC verification rejects when PAN fails after Aadhaar succeeds", async () => {

  console.log("\n========================================");
  console.log("TEST: PAN Failed");
  console.log("========================================");

  const service = new SellerKycVerificationService({
    enabled: true,
    verifyAadhaar: true,
    identityVerificationProvider: {

      verifyAadhaar: async (payload) => {

        console.log("Aadhaar Request");
        console.log(payload);

        return {
          verified: true,
        };
      },

      verifyPan: async (payload) => {

        console.log("PAN Request");
        console.log(payload);

        return {
          verified: false,
          message: "PAN could not be verified.",
        };
      },
    },
  });

  await assert.rejects(
    () =>
      service.verifyForOnboarding({
        aadhaarNumber: "123412341234",
        panNumber: "ABCDE1234F",
      }),
    /PAN could not be verified/
  );

  console.log("PASS");
});

test("seller KYC verification succeeds after Aadhaar and PAN pass", async () => {

  console.log("\n========================================");
  console.log("TEST: Aadhaar + PAN Success");
  console.log("========================================");

  const service = new SellerKycVerificationService({
    enabled: true,
    verifyAadhaar: true,
    identityVerificationProvider: {

      verifyAadhaar: async (payload) => {

        console.log("Aadhaar Request");
        console.log(payload);

        return {
          verified: true,
        };
      },

      verifyPan: async (payload) => {

        console.log("PAN Request");
        console.log(payload);

        return {
          verified: true,
        };
      },
    },
  });

  const result = await service.verifyForOnboarding({
    aadhaarNumber: "123412341234",
    panNumber: "ABCDE1234F",
  });

  console.log("Verification Result");
  console.log(result);

  assert.equal(result.provider, "apitxt");
  assert.equal(result.aadhaarVerified, false);
  assert.equal(result.panVerified, true);

  console.log("PASS");
});

test("seller KYC verification can run PAN only for local APITXT testing", async () => {

  console.log("\n========================================");
  console.log("TEST: PAN Only");
  console.log("========================================");

  let aadhaarCalled = false;
  let panPayload = null;

  const service = new SellerKycVerificationService({
    enabled: true,
    verifyAadhaar: false,
    verifyPan: true,

    identityVerificationProvider: {

      verifyAadhaar: async () => {

        aadhaarCalled = true;

        console.log("ERROR Aadhaar should not be called");

        return {
          verified: true,
        };
      },

      verifyPan: async (payload) => {

        console.log("PAN Payload");
        console.log(payload);

        panPayload = payload;

        return {
          verified: true,
        };
      },
    },
  });

  const result = await service.verifyForOnboarding({
    aadhaarNumber: "123412341234",
    panNumber: "ABCDE1234F",
    legalName: "JOHN DOE",
    dateOfBirth: "1990-01-01",
  });

  console.log(result);

  assert.equal(aadhaarCalled, false);

  assert.deepEqual(panPayload, {
    panNumber: "ABCDE1234F",
    name: "JOHN DOE",
    dob: "1990-01-01",
  });

  assert.equal(result.panVerified, true);

  console.log("PASS");
});

test("APITXT PAN verification sends authkey, pan, name and DD/MM/YYYY dob", async () => {

  console.log("\n========================================");
  console.log("TEST: APITXT Request");
  console.log("========================================");

  let request = null;

  const service = new ApitxtService({

    authKey: "test-key",

    panVerifyUrl: "https://apitxt.com/api/panVerify",

    client: {

      post: async (url, body) => {

        console.log("Outgoing URL");
        console.log(url);

        console.log("Outgoing Body");
        console.log(JSON.stringify(body, null, 2));

        request = { url, body };

        return {
          status: "success",
        };
      },
    },
  });

  const result = await service.verifyPan({

    panNumber: "ABCDE1234F",

    name: "JOHN DOE",

    dob: "1990-01-01",
  });

  console.log("Response");
  console.log(result);

  assert.equal(request.url, "https://apitxt.com/api/panVerify");

  assert.deepEqual(request.body, {
    authkey: "test-key",
    pan: "ABCDE1234F",
    name: "JOHN DOE",
    dob: "01/01/1990",
  });

  assert.equal(result.verified, true);

  console.log("PASS");
});

test("APITXT Aadhaar OTP failure response is rejected", async () => {
  const service = new ApitxtService({
    authKey: "test-key",
    client: {
      post: async () => ({
        status: 310,
        message: "Failed to send Aadhaar OTP. Please try again later.",
      }),
    },
  });

  await assert.rejects(
    () => service.sendAadhaarOtp("123412341234"),
    (error) => {
      assert.equal(error instanceof ApitxtError, true);
      assert.equal(error.statusCode, 502);
      assert.equal(error.providerCode, 310);
      assert.equal(error.retryable, false);
      assert.equal(error.message, "Failed to send Aadhaar OTP. Please try again later.");
      return true;
    },
  );
});

test("seller Aadhaar OTP send failure returns field validation message", async () => {
  const service = new SellerKycVerificationService({
    enabled: true,
    verifyAadhaar: true,
    identityVerificationProvider: {
      sendAadhaarOtp: async () => {
        throw new ApitxtError("Failed to send Aadhaar OTP. Please try again later.", {
          statusCode: 502,
          providerCode: 310,
          retryable: false,
        });
      },
    },
  });

  await assert.rejects(
    () => service.sendAadhaarOtp("123412341234"),
    (error) => {
      assert.equal(error.statusCode, 422);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(
        error.message,
        "Aadhaar OTP could not be sent for this number. Please check Aadhaar/mobile linkage or try again later.",
      );
      assert.deepEqual(error.details, {
        fields: [
          {
            field: "aadhaarNumber",
            message: "Aadhaar OTP could not be sent for this number. Please check Aadhaar/mobile linkage or try again later.",
          },
        ],
      });
      return true;
    },
  );
});

test("seller PAN verification stores result before KYC submit", async () => {
  const originalAssertNoIdentityConflicts = sellerOrganizationService.assertNoIdentityConflicts;
  sellerOrganizationService.assertNoIdentityConflicts = async () => {};
  let storedPayload = null;
  try {
    const sellerService = new SellerService({
      sellerRepository: {
        findKycBySellerId: async () => null,
        upsertPanVerification: async (sellerId, payload) => {
          storedPayload = { sellerId, payload };
          return {};
        },
      },
      kycVerificationService: {
        enabled: true,
        verifyPan: false,
        verifyPanDetails: async (payload) => ({
          provider: "apitxt",
          field: "panNumber",
          verified: true,
          message: "PAN verified successfully.",
          raw: { status: "success", payload },
        }),
      },
    });

    const result = await sellerService.verifyPan(
      {
        panNumber: "abcde1234f",
        legalName: "John Doe",
        dateOfBirth: "1990-01-01",
      },
      { userId: "seller-1" },
    );

    assert.equal(result.panVerified, true);
    assert.equal(storedPayload.sellerId, "seller-1");
    assert.equal(storedPayload.payload.panNumber, "ABCDE1234F");
    assert.equal(storedPayload.payload.panVerified, true);
  } finally {
    sellerOrganizationService.assertNoIdentityConflicts = originalAssertNoIdentityConflicts;
  }
});

test("seller PAN verification requires DOB before provider call", async () => {
  const originalAssertNoIdentityConflicts = sellerOrganizationService.assertNoIdentityConflicts;
  sellerOrganizationService.assertNoIdentityConflicts = async () => {};
  let providerCalled = false;

  try {
    const sellerService = new SellerService({
      sellerRepository: {
        findKycBySellerId: async () => null,
      },
      kycVerificationService: {
        enabled: true,
        verifyPan: true,
        verifyPanDetails: async () => {
          providerCalled = true;
          return { verified: true };
        },
      },
    });

    await assert.rejects(
      () =>
        sellerService.verifyPan(
          {
            panNumber: "ABCDE1234F",
            legalName: "John Doe",
            dateOfBirth: "",
          },
          { userId: "seller-1" },
        ),
      (error) => {
        const fieldError = error.details?.fields?.[0] || {};
        assert.equal(error.code, "VALIDATION_ERROR");
        assert.equal(fieldError.field, "dateOfBirth");
        return true;
      },
    );

    assert.equal(providerCalled, false);
  } finally {
    sellerOrganizationService.assertNoIdentityConflicts = originalAssertNoIdentityConflicts;
  }
});

test("seller KYC submit reuses matching verified PAN", async () => {
  const originalAssertNoIdentityConflicts = sellerOrganizationService.assertNoIdentityConflicts;
  sellerOrganizationService.assertNoIdentityConflicts = async () => {};
  let providerCalled = false;
  let savedKyc = null;
  const existingPanResponse = {
    provider: "apitxt",
    latestVerified: true,
    latestResponse: {
      provider: "apitxt",
      field: "panNumber",
      verified: true,
      message: "PAN verified successfully.",
    },
  };

  try {
    const sellerService = new SellerService({
      sellerRepository: {
        findKycBySellerId: async () => ({
          seller_id: "seller-1",
          pan_number: "ABCDE1234F",
          pan_verified: true,
          pan_verified_at: new Date("2026-01-01T00:00:00.000Z"),
          pan_verification_response: JSON.stringify(existingPanResponse),
        }),
        upsertKyc: async (payload) => {
          savedKyc = payload;
          return {
            seller_id: payload.sellerId,
            pan_number: payload.panNumber,
            pan_verified: payload.panVerified,
            verification_status: payload.verificationStatus,
          };
        },
        findSellerById: async () => null,
      },
      storageService: {
        uploadKycDocuments: async () => ({}),
      },
      kycVerificationService: {
        enabled: true,
        verifyAadhaar: false,
        verifyPan: true,
        verifyForOnboarding: async () => {
          providerCalled = true;
          return { panVerified: false };
        },
      },
    });

    const result = await sellerService.submitKyc(
      {
        panNumber: "ABCDE1234F",
        legalName: "John Doe",
        documents: {},
        bankDetails: {},
      },
      { userId: "seller-1", role: "seller" },
    );

    assert.equal(providerCalled, false);
    assert.equal(savedKyc.panVerified, true);
    assert.equal(result.pan_verified, true);
  } finally {
    sellerOrganizationService.assertNoIdentityConflicts = originalAssertNoIdentityConflicts;
  }
});

test("seller KYC submit requires cached PAN verification before provider call", async () => {
  const originalAssertNoIdentityConflicts = sellerOrganizationService.assertNoIdentityConflicts;
  sellerOrganizationService.assertNoIdentityConflicts = async () => {};
  let providerCalled = false;

  try {
    const sellerService = new SellerService({
      sellerRepository: {
        findKycBySellerId: async () => null,
      },
      storageService: {
        uploadKycDocuments: async () => ({}),
      },
      kycVerificationService: {
        enabled: true,
        verifyAadhaar: false,
        verifyPan: true,
        verifyForOnboarding: async () => {
          providerCalled = true;
          return { panVerified: true };
        },
      },
    });

    await assert.rejects(
      () =>
        sellerService.submitKyc(
          {
            panNumber: "ABCDE1234F",
            legalName: "John Doe",
            documents: {},
            bankDetails: {},
          },
          { userId: "seller-1", role: "seller" },
        ),
      (error) => {
        assert.equal(error.code, "VALIDATION_ERROR");
        const fieldError = error.details?.fields?.[0] || error.details?.[0] || {};
        assert.equal(fieldError.field || fieldError.path?.at(-1), "panNumber");
        return true;
      },
    );

    assert.equal(providerCalled, false);
  } finally {
    sellerOrganizationService.assertNoIdentityConflicts = originalAssertNoIdentityConflicts;
  }
});

test("APITXT Aadhaar verification maps name and DOB for prefill", () => {
  const result = mapVerificationResponse("aadhaarNumber", {
    status: "success",
    data: {
      full_name: "John Doe",
      dob: "01/02/1990",
    },
  });

  assert.equal(result.verified, true);
  assert.deepEqual(result.prefill, {
    fullName: "John Doe",
    legalName: "John Doe",
    dateOfBirth: "1990-02-01",
  });
});

test("seller Aadhaar OTP verification returns prefill fields", async () => {
  const originalAssertNoIdentityConflicts = sellerOrganizationService.assertNoIdentityConflicts;
  const originalAssertNoVerifiedAadhaarConflict = sellerOrganizationService.assertNoVerifiedAadhaarConflict;
  sellerOrganizationService.assertNoIdentityConflicts = async () => {};
  sellerOrganizationService.assertNoVerifiedAadhaarConflict = async () => {};
  let savedAadhaar = null;
  try {
    const sellerService = new SellerService({
      sellerRepository: {
        findKycBySellerId: async () => null,
        upsertAadhaarVerification: async (sellerId, payload) => {
          savedAadhaar = { sellerId, payload };
          return {};
        },
        findSellerById: async () => null,
      },
      kycVerificationService: {
        enabled: true,
        verifyAadhaar: false,
        verifyAadhaarOtp: async () => ({
          provider: "apitxt",
          field: "aadhaarNumber",
          verified: true,
          prefill: {
            fullName: "John Doe",
            legalName: "John Doe",
            dateOfBirth: "1990-02-01",
          },
          message: "Aadhaar verified successfully.",
        }),
        assertVerified: () => {},
      },
    });

    const result = await sellerService.verifyAadhaarOtp(
      {
        reference_id: "ref-1",
        otp: "123456",
        aadhaarNumber: "123412341234",
      },
      { userId: "seller-1" },
    );

    assert.equal(result.aadhaarVerified, true);
    assert.deepEqual(result.prefill, {
      fullName: "John Doe",
      legalName: "John Doe",
      dateOfBirth: "1990-02-01",
    });
    assert.equal(savedAadhaar.payload.aadhaarVerified, true);
  } finally {
    sellerOrganizationService.assertNoIdentityConflicts = originalAssertNoIdentityConflicts;
    sellerOrganizationService.assertNoVerifiedAadhaarConflict = originalAssertNoVerifiedAadhaarConflict;
  }
});

test("seller Aadhaar OTP verification failure returns friendly OTP error", async () => {
  const service = new SellerKycVerificationService();

  assert.throws(
    () =>
      service.assertVerified(
        {
          verified: false,
          message: "verification_failed",
        },
        "otp",
        "Invalid Aadhaar OTP. Please check the OTP and try again.",
      ),
    (error) => {
      assert.equal(error.statusCode, 422);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.message, "Invalid Aadhaar OTP. Please check the OTP and try again.");
      assert.deepEqual(error.details, {
        fields: [
          {
            field: "otp",
            message: "Invalid Aadhaar OTP. Please check the OTP and try again.",
          },
        ],
      });
      return true;
    },
  );
});

test("seller Aadhaar OTP verification reuses verified cache without provider call", async () => {
  let providerCalled = false;
  const cachedResponse = {
    latestResponse: {
      provider: "apitxt",
      field: "aadhaarNumber",
      verified: true,
      prefill: {
        fullName: "John Doe",
        legalName: "John Doe",
        dateOfBirth: "1990-02-01",
      },
    },
  };

  const sellerService = new SellerService({
    sellerRepository: {
      findKycBySellerId: async () => ({
        aadhaar_number: "123412341234",
        aadhaar_verified: true,
        aadhaar_reference_id: "ref-1",
        aadhaar_verified_at: new Date("2026-01-01T00:00:00.000Z"),
        aadhaar_verification_response: JSON.stringify(cachedResponse),
      }),
    },
    kycVerificationService: {
      enabled: true,
      verifyAadhaar: true,
      verifyAadhaarOtp: async () => {
        providerCalled = true;
        return { verified: false };
      },
    },
  });

  const result = await sellerService.verifyAadhaarOtp(
    {
      reference_id: "ref-1",
      otp: "123456",
      aadhaarNumber: "123412341234",
    },
    { userId: "seller-1" },
  );

  assert.equal(providerCalled, false);
  assert.equal(result.cached, true);
  assert.equal(result.aadhaarVerified, true);
  assert.deepEqual(result.prefill, {
    fullName: "John Doe",
    legalName: "John Doe",
    dateOfBirth: "1990-02-01",
  });
});

test("seller Aadhaar precheck reuses verified cache even when reference changes", async () => {
  let duplicateCheckCalled = false;
  const originalAssertNoVerifiedAadhaarConflict = sellerOrganizationService.assertNoVerifiedAadhaarConflict;
  sellerOrganizationService.assertNoVerifiedAadhaarConflict = async () => {
    duplicateCheckCalled = true;
  };

  try {
    const sellerService = new SellerService({
      sellerRepository: {
        findKycBySellerId: async () => ({
          aadhaar_number: "123412341234",
          aadhaar_verified: true,
          aadhaar_reference_id: "old-ref",
          aadhaar_verified_at: new Date("2026-01-01T00:00:00.000Z"),
          aadhaar_verification_response: JSON.stringify({
            latestResponse: {
              verified: true,
              prefill: {
                fullName: "John Doe",
                legalName: "John Doe",
                dateOfBirth: "1990-02-01",
              },
            },
          }),
        }),
      },
    });

    const result = await sellerService.precheckAadhaar(
      {
        aadhaarNumber: "123412341234",
        reference_id: "new-ref",
      },
      { userId: "seller-1" },
    );

    assert.equal(duplicateCheckCalled, false);
    assert.equal(result.cached, true);
    assert.equal(result.aadhaarVerified, true);
  } finally {
    sellerOrganizationService.assertNoVerifiedAadhaarConflict = originalAssertNoVerifiedAadhaarConflict;
  }
});

test("seller Aadhaar OTP send blocks duplicate before provider call", async () => {
  const originalAssertNoVerifiedAadhaarConflict = sellerOrganizationService.assertNoVerifiedAadhaarConflict;
  let providerCalled = false;
  sellerOrganizationService.assertNoVerifiedAadhaarConflict = async () => {
    throw new AppError(
      "This Aadhaar number is already linked to another seller account.",
      409,
      [
        {
          field: "aadhaarNumber",
          path: ["body", "aadhaarNumber"],
          message: "This Aadhaar number is already linked to another seller account.",
        },
      ],
      "DUPLICATE_ENTRY",
    );
  };

  try {
    const sellerService = new SellerService({
      sellerRepository: {
        findKycBySellerId: async () => null,
      },
      kycVerificationService: {
        enabled: true,
        verifyAadhaar: true,
        sendAadhaarOtp: async () => {
          providerCalled = true;
          return { reference_id: "ref-1" };
        },
      },
    });

    await assert.rejects(
      () => sellerService.sendAadhaarOtp({ aadhaarNumber: "123412341234" }, { userId: "seller-1" }),
      (error) => {
        assert.equal(error.code, "DUPLICATE_ENTRY");
        return true;
      },
    );

    assert.equal(providerCalled, false);
  } finally {
    sellerOrganizationService.assertNoVerifiedAadhaarConflict = originalAssertNoVerifiedAadhaarConflict;
  }
});

test("seller Aadhaar OTP verify blocks duplicate before provider call", async () => {
  const originalAssertNoVerifiedAadhaarConflict = sellerOrganizationService.assertNoVerifiedAadhaarConflict;
  let providerCalled = false;
  let failureStored = false;
  sellerOrganizationService.assertNoVerifiedAadhaarConflict = async () => {
    throw new AppError(
      "This Aadhaar number is already linked to another seller account.",
      409,
      [
        {
          field: "aadhaarNumber",
          path: ["body", "aadhaarNumber"],
          message: "This Aadhaar number is already linked to another seller account.",
        },
      ],
      "DUPLICATE_ENTRY",
    );
  };

  try {
    const sellerService = new SellerService({
      sellerRepository: {
        findKycBySellerId: async () => null,
        upsertAadhaarVerification: async () => {
          failureStored = true;
        },
      },
      kycVerificationService: {
        enabled: true,
        verifyAadhaar: true,
        verifyAadhaarOtp: async () => {
          providerCalled = true;
          return { verified: true };
        },
      },
    });

    await assert.rejects(
      () =>
        sellerService.verifyAadhaarOtp(
          {
            reference_id: "ref-1",
            otp: "123456",
            aadhaarNumber: "123412341234",
          },
          { userId: "seller-1" },
        ),
      (error) => {
        assert.equal(error.code, "DUPLICATE_ENTRY");
        return true;
      },
    );

    assert.equal(providerCalled, false);
    assert.equal(failureStored, false);
  } finally {
    sellerOrganizationService.assertNoVerifiedAadhaarConflict = originalAssertNoVerifiedAadhaarConflict;
  }
});

test("seller PAN verification blocks duplicate before provider call", async () => {
  const originalAssertNoIdentityConflicts = sellerOrganizationService.assertNoIdentityConflicts;
  let providerCalled = false;
  sellerOrganizationService.assertNoIdentityConflicts = async () => {
    throw new AppError(
      "PAN ABCDE1234F is already linked to another seller account or organization.",
      409,
      [
        {
          field: "panNumber",
          path: ["body", "panNumber"],
          message: "PAN ABCDE1234F is already linked to another seller account or organization.",
        },
      ],
      "DUPLICATE_ENTRY",
    );
  };

  try {
    const sellerService = new SellerService({
      sellerRepository: {
        findKycBySellerId: async () => null,
      },
      kycVerificationService: {
        enabled: true,
        verifyPan: true,
        verifyPanDetails: async () => {
          providerCalled = true;
          return { verified: true };
        },
      },
    });

    await assert.rejects(
      () =>
        sellerService.verifyPan(
          {
            panNumber: "ABCDE1234F",
            legalName: "John Doe",
            dateOfBirth: "1990-02-01",
          },
          { userId: "seller-1" },
        ),
      (error) => {
        assert.equal(error.code, "DUPLICATE_ENTRY");
        return true;
      },
    );

    assert.equal(providerCalled, false);
  } finally {
    sellerOrganizationService.assertNoIdentityConflicts = originalAssertNoIdentityConflicts;
  }
});
