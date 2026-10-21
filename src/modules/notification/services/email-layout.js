// Email clients receive hosted PNG icons rather than inline SVG or emoji.
const escapeHtml = (value = "") => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const renderTrustStrip = () => {
  const baseUrl = String(process.env.CUSTOMER_APP_BASE_URL || process.env.FRONTEND_PUBLIC_URL || process.env.APP_PUBLIC_URL || "").replace(/\/+$/, "");
  const items = [
    ["lock", "Secure &amp; Trusted", "Updates from official systems."],
    ["shield", "Protection", "Review details in your account."],
    ["chat", "Need Help?", "Contact official support."],
  ];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border-top:1px solid #e5e7eb;table-layout:fixed;"><tr>${items.map(([icon, title, text], index) => `
    <td width="33%" valign="top" style="padding:14px 8px;${index ? "border-left:1px solid #e5e7eb;" : ""}">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        ${baseUrl ? `<td valign="top" style="padding-right:8px;"><img src="${escapeHtml(baseUrl)}/email-assets/icons/${icon}.png" width="36" height="36" alt="" style="display:block;width:36px;height:36px;border:0;"></td>` : ""}
        <td valign="top"><div style="font-size:12px;font-weight:bold;line-height:1.4;color:#0a1450;">${title}</div><div style="margin-top:2px;font-size:10px;line-height:1.4;color:#6b7280;">${text}</div></td>
      </tr></table>
    </td>`).join("")}</tr></table>`;
};

module.exports = { renderTrustStrip };
