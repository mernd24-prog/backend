const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const prorateMoney = (amount, selectedQuantity, totalQuantity) => {
  const total = Math.max(Number(totalQuantity || 0), 1);
  return roundMoney(Number(amount || 0) * (Number(selectedQuantity || 0) / total));
};

module.exports = { prorateMoney, roundMoney };
