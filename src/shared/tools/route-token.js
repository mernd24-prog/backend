const PRODUCT_TOKEN_VERSION = "p1";
const PRODUCT_TOKEN_MASK = "sam-global-product-route-v1";

function maskByte(index, mask) {
  return mask.charCodeAt(index % mask.length);
}

function decodeMaskedBase64Url(token, mask) {
  const normalized = String(token || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = Buffer.from(padded, "base64").toString("binary");
  const bytes = Array.from(binary, (char, index) =>
    char.charCodeAt(0) ^ maskByte(index, mask) ^ ((index * 31) & 255),
  );
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

function decodeProductRouteToken(token) {
  try {
    const payload = decodeMaskedBase64Url(token, PRODUCT_TOKEN_MASK);
    if (!payload || payload.t !== PRODUCT_TOKEN_VERSION) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = {
  decodeProductRouteToken,
};
