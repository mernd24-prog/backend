// Deal earnings are a subset of seller commissions, never an extra payout.
function payoutEarningsBreakdown(commissions = [], dealItems = []) {
  const byItem = new Map(dealItems.map((item) => [String(item.id), item]));
  const deals = new Map();
  let regularPaise = 0;
  for (const commission of commissions) {
    const paise = Math.round(Number(commission.net_amount || 0) * 100);
    const item = byItem.get(String(commission.order_item_id || ""));
    const snapshot = typeof item?.deal_snapshot === "string"
      ? JSON.parse(item.deal_snapshot || "{}") : item?.deal_snapshot || {};
    const dealId = item?.deal_id || snapshot.dealId || snapshot.id;
    if (!dealId) { regularPaise += paise; continue; }
    const deal = deals.get(String(dealId)) || {
      dealId: String(dealId), title: snapshot.title || "Promotional deal", itemCount: 0, netPaise: 0,
    };
    deal.itemCount += 1;
    deal.netPaise += paise;
    deals.set(String(dealId), deal);
  }
  const entries = [...deals.values()].map(({ netPaise, ...deal }) => ({ ...deal, netAmount: netPaise / 100 }));
  const dealPaise = [...deals.values()].reduce((sum, deal) => sum + deal.netPaise, 0);
  return {
    regularNetAmount: regularPaise / 100,
    dealNetAmount: dealPaise / 100,
    totalNetAmount: (regularPaise + dealPaise) / 100,
    deals: entries,
  };
}
module.exports = { payoutEarningsBreakdown };
