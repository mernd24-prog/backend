# OTP channel and DLT configuration

The backend has two separate OTP delivery channels:

1. **Email OTP** uses SMTP and does not use DLT.
2. **Mobile OTP** uses APITXT/SMS and requires an approved DLT entity ID, sender header, content-template ID, and exact approved message.

## Safe production channel setup

```dotenv
NODE_ENV=production
AUTH_OTP_MODE=live
AUTH_EXPOSE_STATIC_OTP=false
ENABLE_STATIC_OTP=false
EXPOSE_STATIC_OTP=false
SHOW_STATIC_OTP=false

# Generic and seller OTP flows default to email.
AUTH_PRIMARY_OTP_CHANNEL=email

# Only seller registration is overridden to SMS.
AUTH_SELLER_REGISTRATION_OTP_CHANNEL=sms
```

`AUTH_PRIMARY_OTP_CHANNEL=email` keeps generic seller login and password recovery on email. `AUTH_SELLER_REGISTRATION_OTP_CHANNEL=sms` changes only seller registration in that flow.

Buyer authentication behaves differently: its channel is selected from the submitted identity. An email identity sends email; a mobile identity sends SMS. If paid mobile login is not supported, the customer UI/API must not offer mobile OTP login.

## Email OTP keys

```dotenv
EMAIL_HOST=
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=
EMAIL_PASS=
EMAIL_FROM=
DEFAULT_FROM_EMAIL=
REPLY_TO_EMAIL=

SEND_EMAILS=true
SEND_AUTH_OTP_EMAILS=true
ENABLE_LIVE_EMAIL=true
ENABLE_EMAIL_MOCK=false
```

Email OTP is selected when:

- buyer auth receives an email identity;
- a generic auth flow resolves its channel to `email`; or
- SMS delivery in the generic flow fails and email fallback is available.

## Mobile SMS OTP and DLT keys

```dotenv
SMS_PROVIDER=apitxt
SMS_ENABLED=true
SMS_TRANSACTIONAL_ENABLED=false
SMS_ENFORCE_DLT=true

APITXT_AUTH_KEY=
APITXT_BASE_URL=https://apitxt.com
APITXT_SMS_OTP_URL=https://apitxt.com/api/sendOTP
APITXT_SMS_OTP_ENABLED=true

# Approved DLT registration/entity/PE ID
DLT_PE_ID=

# Approved six-character sender IDs/headers
DLT_HEADER_SERVICE=
DLT_HEADER_TRANSACTIONAL=
```

Use `DLT_HEADER_SERVICE` for OTP/service-implicit messages. Use `DLT_HEADER_TRANSACTIONAL` only for messages registered in the transactional category.

## DLT template mapping

Each approved content-template ID belongs in its matching key. Do not reuse one ID for differently worded use cases.

| Use case | Environment key | Internal template |
|---|---|---|
| Mobile login OTP | `DLT_TEMPLATE_LOGIN_OTP` | `LOGIN_OTP` |
| Mobile registration OTP | `DLT_TEMPLATE_REGISTER_OTP` | `REGISTER_OTP` |
| Forgot-password OTP | `DLT_TEMPLATE_FORGOT_PASSWORD_OTP` | `FORGOT_PASSWORD_OTP` |
| Password-reset confirmation | `DLT_TEMPLATE_RESET_PASSWORD_OTP` | `RESET_PASSWORD_OTP` |
| Verify mobile number | `DLT_TEMPLATE_VERIFY_MOBILE_OTP` | `VERIFY_MOBILE_OTP` |
| Change mobile number | `DLT_TEMPLATE_CHANGE_MOBILE_OTP` | `CHANGE_MOBILE_OTP` |
| Account recovery | `DLT_TEMPLATE_ACCOUNT_RECOVERY_OTP` | `ACCOUNT_RECOVERY_OTP` |

If only one template is approved, populate only its matching key. Keep all other template keys blank and use email for those flows until their templates are approved.

## Exact DLT message requirement

SMS message builders are in `src/infrastructure/msg/sms/sms.templates.js`. The text, punctuation, brand name, variable count, and variable order must match the approved DLT content. Current OTP variables are:

1. `otp`
2. `validityMinutes`

If the approved text differs, update its corresponding message builder before enabling the flow.

## How the backend differentiates OTPs

| Signal | Delivery |
|---|---|
| Buyer request has an email identity | Email OTP |
| Buyer request has a mobile identity | SMS OTP |
| Generic channel is `email` | Email OTP |
| Generic channel is `sms` and a mobile exists | SMS OTP |
| Seller registration override is `sms` | Seller registration uses SMS |
| `AUTH_OTP_MODE=static` | Development OTP; no real SMS delivery |
| `AUTH_OTP_MODE=disabled` | OTP requests are rejected |

For SMS, the request `purpose` selects the matching DLT template: `registration`, `login`, `forgot_password`, `reset_password`, `verify_mobile`, `change_mobile`, or `account_recovery`.

## Activation checklist

1. Put the approved registration/entity ID in `DLT_PE_ID`.
2. Put the approved OTP sender ID in `DLT_HEADER_SERVICE`.
3. Put each approved content-template ID in its matching `DLT_TEMPLATE_*` key.
4. Verify its text exactly matches `sms.templates.js`.
5. Add the APITXT credential and provider URL.
6. Test with one mobile number outside production.
7. Enable `AUTH_OTP_MODE=live`, `SMS_ENABLED=true`, `APITXT_SMS_OTP_ENABLED=true`, and `SMS_ENFORCE_DLT=true` only when the required values are complete.
8. Keep `DLT_TEMPLATE_LOGIN_OTP` blank and mobile-login UI disabled when paid SMS login is intentionally unsupported.

Never expose static OTP in production and never commit real credentials.
