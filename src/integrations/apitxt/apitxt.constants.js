const APITXT_PROVIDER = "apitxt";


const APITXT_ENDPOINTS = {

  SEND_AADHAAR_OTP: "/aadhaarSendOTP",

  VERIFY_AADHAAR_OTP: "/aadhaarVerifyOTP",

  SEND_SMS_OTP: "/sendOTP",


  VERIFY_PAN: "/panVerify",

  VERIFY_GST: "/gst/:gstin",

  VERIFY_BANK: "/bankVerify",

  VERIFY_DRIVING_LICENSE:
    "/drivingLicenseVerify",

};


module.exports = {
  APITXT_PROVIDER,
  APITXT_ENDPOINTS,
};
