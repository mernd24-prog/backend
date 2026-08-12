const { ApitxtError } = require("./apitxt.errors");

const SENSITIVE_QUERY_KEYS = new Set([
  "authkey",
  "otp",
  "mobile",
  "aadhaar_number",
  "pan",
  "pan_number",
]);

const maskMobile = (value = "") => {
  const normalized = String(value || "").replace(/\D/g, "");
  if (normalized.length <= 4) return "****";
  return `${normalized.slice(0, 2)}****${normalized.slice(-4)}`;
};

const maskValue = (key, value) => {
  const normalizedKey = String(key || "").toLowerCase();
  if (value === undefined || value === null || value === "") return value;
  if (normalizedKey === "mobile") return maskMobile(value);
  if (normalizedKey === "otp") return "******";
  if (normalizedKey === "authkey") return "***redacted***";
  if (normalizedKey.includes("aadhaar")) return "************";
  if (normalizedKey.includes("pan")) return "*****redacted*****";
  if (["name", "fullname", "full_name"].includes(normalizedKey)) return "*****redacted*****";
  if (["dob", "dateofbirth", "date_of_birth"].includes(normalizedKey)) return "****-**-**";
  if (normalizedKey.includes("address")) return "*****redacted*****";
  if (normalizedKey === "care_of") return "*****redacted*****";
  if (normalizedKey === "photo") return "*****redacted*****";
  return value;
};

const sanitizePayload = (payload = {}) => {
  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizePayload(item));
  }

  if (!payload || typeof payload !== "object") {
    return payload;
  }

  return Object.entries(payload).reduce((safePayload, [key, value]) => {
    const maskedValue = maskValue(key, value);
    if (maskedValue !== value) {
      safePayload[key] = maskedValue;
      return safePayload;
    }

    if (Array.isArray(value) || (value && typeof value === "object")) {
      safePayload[key] = sanitizePayload(value);
      return safePayload;
    }

    safePayload[key] = value;
    return safePayload;
  }, {});
};

const sanitizeUrl = (rawUrl = "") => {
  try {
    const url = new URL(rawUrl);
    url.searchParams.forEach((value, key) => {
      if (SENSITIVE_QUERY_KEYS.has(String(key).toLowerCase())) {
        url.searchParams.set(key, maskValue(key, value));
      }
    });
    return url.toString();
  } catch (error) {
    return String(rawUrl || "")
      .replace(/(authkey=)[^&\s]+/gi, "$1***redacted***")
      .replace(/(otp=)[^&\s]+/gi, "$1******")
      .replace(/(mobile=)(\d{2})\d+(\d{4})/gi, "$1$2****$3");
  }
};

class ApitxtClient {
  constructor({
    baseUrl,
    authKey,
    timeoutMs = 5000,
    retries = 2,
    logger = console,
    fetchImpl = global.fetch,
  } = {}) {
    this.baseUrl = String(baseUrl || "").replace(/\/+$/, "");
    this.authKey = authKey;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.logger = logger;
    this.fetch = fetchImpl;
  }


  resolveUrl(path) {
    const text = String(path || "").trim();

    if (/^https?:\/\//i.test(text)) {
      return text;
    }

    if (!text.startsWith("/")) {
      return `${this.baseUrl}/${text}`;
    }

    return `${this.baseUrl}${text}`;
  }


  async post(path, body = {}) {

    let lastError = null;

    for (
      let attempt = 0;
      attempt <= this.retries;
      attempt++
    ) {

      try {

        return await this.request(
          "POST",
          path,
          body,
          attempt
        );

      } catch(error){

        lastError = error;

        if(
          !error.retryable ||
          attempt >= this.retries
        ){
          throw error;
        }


        await this.sleep(
          150 * Math.pow(2, attempt)
        );
      }
    }


    throw lastError;
  }

  async get(path, params = {}) {
    const search = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        search.set(key, String(value));
      }
    });
    const suffix = search.toString();
    const separator = String(path || "").includes("?") ? "&" : "?";
    return this.request(
      "GET",
      suffix ? `${path}${separator}${suffix}` : path,
      {},
      0,
    );
  }



  async request(method, path, body, attempt){

    if(!this.fetch){

      throw new ApitxtError(
        "APITXT fetch transport is unavailable.",
        {
          statusCode:503,
          retryable:false
        }
      );

    }


    const url = this.resolveUrl(path);
    const safeUrl = sanitizeUrl(url);
    const safePath = sanitizeUrl(path);


    const controller = new AbortController();


    const timeout = setTimeout(
      ()=>controller.abort(),
      this.timeoutMs
    );


    try{


      const headers = {

        "Content-Type":
          "application/json",

        "Accept":
          "application/json",


        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",


        "Origin":
          "https://apitxt.com",


        "Referer":
          "https://apitxt.com/",


        "Sec-Fetch-Site":
          "same-origin",


        "Sec-Fetch-Mode":
          "cors",


        "Sec-Fetch-Dest":
          "empty",


        "Accept-Language":
          "en-US,en;q=0.9"

      };



      // Add authkey in request body
      const requestBody = {
        ...body
      };


      if(this.authKey){

        requestBody.authkey =
          this.authKey;

      }



      console.log(
        "\n========== APITXT REQUEST =========="
      );

      console.log(
        "URL:",
        safeUrl
      );

      console.log(
        "METHOD:",
        method
      );


      console.log(
        "HEADERS:"
      );

      console.dir(
        headers,
        {
          depth:null
        }
      );


      console.log(
        "BODY:"
      );

      console.dir(
        sanitizePayload(requestBody),
        {
          depth:null
        }
      );



      const requestOptions = {
        method,
        headers,
        signal:
          controller.signal,
      };

      if (method !== "GET") {
        requestOptions.body =
          JSON.stringify(requestBody);
      }

      const response = await this.fetch(

        url,

        requestOptions

      );



      const text =
        await response.text();



      let data={};


      try{

        data =
          JSON.parse(text);

      }
      catch(e){

        data={
          raw:text
        };

      }



      console.log(
        "\n========== APITXT RESPONSE =========="
      );


      console.log(
        "STATUS:",
        response.status
      );


      console.dir(
        sanitizePayload(data),
        {
          depth:null
        }
      );



      if(!response.ok){


        throw new ApitxtError(

          data.message ||
          data.error ||
          data.reason ||
          "APITXT request failed.",

          {

            statusCode:
              response.status,


            providerCode:
              data.code ||
              data.errorCode ||
              null,


            retryable:
              response.status >= 500 ||
              response.status === 429,


            details:data

          }

        );

      }



      return data;



    }
    catch(error){


      if(error.name === "AbortError"){


        throw new ApitxtError(
          "APITXT request timeout.",
          {
            statusCode:504,
            retryable:true
          }
        );

      }



      if(error instanceof ApitxtError){


        this.logger.error?.(
          {
            err:error,
            attempt,
            path: safePath,
            providerResponse:
              error.details
          },

          "APITXT request failed"
        );


        throw error;

      }




      this.logger.error?.(
        {
          err:error,
          attempt,
          path: safePath
        },

        "APITXT transport error"
      );



      throw new ApitxtError(

        "APITXT service unavailable.",

        {
          statusCode:502,
          retryable:true
        }

      );


    }
    finally{

      clearTimeout(timeout);

    }

  }



  sleep(ms){

    return new Promise(
      resolve=>setTimeout(resolve,ms)
    );

  }

}


module.exports = {
  ApitxtClient
};
