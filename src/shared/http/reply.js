function okResponse(data, meta = {}) {
  return {
    success: true,
    data,
    meta,
  };
}

function failResponse(message, details = null, code = null) {
  const response = {
    success: false,
    error: {
      ...(code ? { code } : {}),
      message,
      details,
    },
  };
  if (code) {
    response.code = code;
    response.message = message;
  }
  return response;
}

module.exports = { okResponse, failResponse };
