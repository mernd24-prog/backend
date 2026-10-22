const panPattern = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const gstPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{3}$/;
const aadhaarPattern = /^(?!([0-9])\1{11}$)[0-9]{12}$/;

module.exports = { panPattern, gstPattern, aadhaarPattern };
