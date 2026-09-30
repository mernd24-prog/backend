# SMS DLT Template Texts

Use this document when creating templates in the STPL/DLT portal.

## Important instructions

- Replace `SAM GLOBAL` only if the brand name approved under your DLT entity is different.
- Submit the text exactly as shown. After approval, the application message must have identical wording, punctuation, spacing, and variable order.
- `{#var#}` represents a DLT variable position. Confirm the exact placeholder syntax required by the STPL portal.
- Use the approved `SERVICE` Header/Sender ID for these templates.
- Do not classify OTPs or ordinary ecommerce messages as `TRANSACTIONAL` unless STPL confirms that the category is legally applicable and approves it.
- Put the approved Template ID returned by the portal into the corresponding environment variable.
- Do not put the PE ID, Header ID, template name, or template text into a `DLT_TEMPLATE_*` environment variable.

## OTP templates

### 1. Login OTP

Template key: `LOGIN_OTP`

Environment variable: `DLT_TEMPLATE_LOGIN_OTP`

Header type: `SERVICE`

Category: `SERVICE_IMPLICIT`

```text
{#var#} is your OTP to log in to SAM GLOBAL. Valid for {#var#} minutes. Do not share it with anyone.
```

Variable order:

1. OTP
2. Validity in minutes

### 2. Registration OTP

Template key: `REGISTER_OTP`

Environment variable: `DLT_TEMPLATE_REGISTER_OTP`

Header type: `SERVICE`

Category: `SERVICE_IMPLICIT`

```text
{#var#} is your OTP to register with SAM GLOBAL. Valid for {#var#} minutes. Do not share it with anyone.
```

Variable order:

1. OTP
2. Validity in minutes

### 3. Forgot-password OTP

Template key: `FORGOT_PASSWORD_OTP`

Environment variable: `DLT_TEMPLATE_FORGOT_PASSWORD_OTP`

Header type: `SERVICE`

Category: `SERVICE_IMPLICIT`

```text
{#var#} is your OTP to reset your SAM GLOBAL password. Valid for {#var#} minutes. Do not share it with anyone.
```

Variable order:

1. OTP
2. Validity in minutes

### 4. Reset-password confirmation OTP

Template key: `RESET_PASSWORD_OTP`

Environment variable: `DLT_TEMPLATE_RESET_PASSWORD_OTP`

Header type: `SERVICE`

Category: `SERVICE_IMPLICIT`

```text
{#var#} is your OTP to confirm your SAM GLOBAL password reset. Valid for {#var#} minutes. Do not share it with anyone.
```

Variable order:

1. OTP
2. Validity in minutes

### 5. Verify-mobile OTP

Template key: `VERIFY_MOBILE_OTP`

Environment variable: `DLT_TEMPLATE_VERIFY_MOBILE_OTP`

Header type: `SERVICE`

Category: `SERVICE_IMPLICIT`

```text
{#var#} is your OTP to verify your mobile number with SAM GLOBAL. Valid for {#var#} minutes. Do not share it with anyone.
```

Variable order:

1. OTP
2. Validity in minutes

### 6. Change-mobile OTP

Template key: `CHANGE_MOBILE_OTP`

Environment variable: `DLT_TEMPLATE_CHANGE_MOBILE_OTP`

Header type: `SERVICE`

Category: `SERVICE_IMPLICIT`

```text
{#var#} is your OTP to change your mobile number on SAM GLOBAL. Valid for {#var#} minutes. Do not share it with anyone.
```

Variable order:

1. OTP
2. Validity in minutes

### 7. Account-recovery OTP

Template key: `ACCOUNT_RECOVERY_OTP`

Environment variable: `DLT_TEMPLATE_ACCOUNT_RECOVERY_OTP`

Header type: `SERVICE`

Category: `SERVICE_IMPLICIT`

```text
{#var#} is your OTP for SAM GLOBAL account recovery. Valid for {#var#} minutes. Do not share it with anyone.
```

Variable order:

1. OTP
2. Validity in minutes

## Order and payment templates

### 8. Order placed

Template key: `ORDER_PLACED`

Environment variable: `DLT_TEMPLATE_ORDER_PLACED`

Header type: `SERVICE`

Category: `SERVICE_IMPLICIT`

```text
Your SAM GLOBAL order {#var#} has been placed successfully for INR {#var#}.
```

Variable order:

1. Order number
2. Order amount

### 9. Payment successful

Template key: `PAYMENT_SUCCESS`

Environment variable: `DLT_TEMPLATE_PAYMENT_SUCCESS`

Header type: `SERVICE`

Category: `SERVICE_IMPLICIT`

```text
Payment of INR {#var#} for SAM GLOBAL order {#var#} was successful. Reference: {#var#}.
```

Variable order:

1. Payment amount
2. Order number
3. Payment reference

### 10. Payment failed

Template key: `PAYMENT_FAILED`

Environment variable: `DLT_TEMPLATE_PAYMENT_FAILED`

Header type: `SERVICE`

Category: `SERVICE_IMPLICIT`

```text
Payment for SAM GLOBAL order {#var#} failed. Please retry from your account.
```

Variable order:

1. Order number

### 11. Order cancelled

Template key: `ORDER_CANCELLED`

Environment variable: `DLT_TEMPLATE_ORDER_CANCELLED`

Header type: `SERVICE`

Category: `SERVICE_IMPLICIT`

```text
Your SAM GLOBAL order {#var#} has been cancelled.
```

Variable order:

1. Order number

## Refund templates

### 12. Refund initiated

Template key: `REFUND_INITIATED`

Environment variable: `DLT_TEMPLATE_REFUND_INITIATED`

Header type: `SERVICE`

Category: `SERVICE_IMPLICIT`

```text
A refund of INR {#var#} for SAM GLOBAL order {#var#} has been initiated.
```

Variable order:

1. Refund amount
2. Order number

### 13. Refund completed

Template key: `REFUND_COMPLETED`

Environment variable: `DLT_TEMPLATE_REFUND_COMPLETED`

Header type: `SERVICE`

Category: `SERVICE_IMPLICIT`

```text
Your refund of INR {#var#} for SAM GLOBAL order {#var#} has been processed. Reference: {#var#}.
```

Variable order:

1. Refund amount
2. Order number
3. Refund reference

## Shipping and delivery templates

### 14. Shipment dispatched

Template key: `SHIPMENT_DISPATCHED`

Environment variable: `DLT_TEMPLATE_SHIPMENT_DISPATCHED`

Header type: `SERVICE`

Category: `SERVICE_IMPLICIT`

```text
Your SAM GLOBAL order {#var#} has been dispatched. Tracking number: {#var#}.
```

Variable order:

1. Order number
2. Tracking or AWB number

### 15. Out for delivery

Template key: `OUT_FOR_DELIVERY`

Environment variable: `DLT_TEMPLATE_OUT_FOR_DELIVERY`

Header type: `SERVICE`

Category: `SERVICE_IMPLICIT`

```text
Your SAM GLOBAL order {#var#} is out for delivery.
```

Variable order:

1. Order number

### 16. Order delivered

Template key: `ORDER_DELIVERED`

Environment variable: `DLT_TEMPLATE_ORDER_DELIVERED`

Header type: `SERVICE`

Category: `SERVICE_IMPLICIT`

```text
Your SAM GLOBAL order {#var#} has been delivered successfully.
```

Variable order:

1. Order number

### 17. Delivery failed

Template key: `DELIVERY_FAILED`

Environment variable: `DLT_TEMPLATE_DELIVERY_FAILED`

Header type: `SERVICE`

Category: `SERVICE_IMPLICIT`

```text
Delivery of your SAM GLOBAL order {#var#} was unsuccessful. We will update you about the next attempt.
```

Variable order:

1. Order number

## Environment-variable checklist

```env
SMS_PROVIDER=apitxt
SMS_ENABLED=false
SMS_TRANSACTIONAL_ENABLED=false
SMS_ENFORCE_DLT=true

SMS_BRAND_NAME=SAM GLOBAL
SMS_OTP_API_URL=https://apitxt.com/api/sendOTP
SMS_API_URL=<STPL_APPROVED_SMS_API_URL>
SMS_API_METHOD=POST
SMS_API_KEY=<SMS_API_KEY_OR_TOKEN>
SMS_USERNAME=<SMS_USERNAME_IF_REQUIRED>
SMS_PASSWORD=<SMS_PASSWORD_IF_REQUIRED>
SMS_ROUTE=<PROVIDER_ROUTE_IF_REQUIRED>
SMS_COUNTRY=91

DLT_PE_ID=<DLT_PRINCIPAL_ENTITY_ID>
DLT_HEADER_SERVICE=<APPROVED_SERVICE_HEADER>
DLT_HEADER_TRANSACTIONAL=<ONLY_IF_APPROVED_AND_REQUIRED>

DLT_TEMPLATE_LOGIN_OTP=<APPROVED_TEMPLATE_ID>
DLT_TEMPLATE_REGISTER_OTP=<APPROVED_TEMPLATE_ID>
DLT_TEMPLATE_FORGOT_PASSWORD_OTP=<APPROVED_TEMPLATE_ID>
DLT_TEMPLATE_RESET_PASSWORD_OTP=<APPROVED_TEMPLATE_ID>
DLT_TEMPLATE_VERIFY_MOBILE_OTP=<APPROVED_TEMPLATE_ID>
DLT_TEMPLATE_CHANGE_MOBILE_OTP=<APPROVED_TEMPLATE_ID>
DLT_TEMPLATE_ACCOUNT_RECOVERY_OTP=<APPROVED_TEMPLATE_ID>
DLT_TEMPLATE_ORDER_PLACED=<APPROVED_TEMPLATE_ID>
DLT_TEMPLATE_PAYMENT_SUCCESS=<APPROVED_TEMPLATE_ID>
DLT_TEMPLATE_PAYMENT_FAILED=<APPROVED_TEMPLATE_ID>
DLT_TEMPLATE_ORDER_CANCELLED=<APPROVED_TEMPLATE_ID>
DLT_TEMPLATE_REFUND_INITIATED=<APPROVED_TEMPLATE_ID>
DLT_TEMPLATE_REFUND_COMPLETED=<APPROVED_TEMPLATE_ID>
DLT_TEMPLATE_SHIPMENT_DISPATCHED=<APPROVED_TEMPLATE_ID>
DLT_TEMPLATE_OUT_FOR_DELIVERY=<APPROVED_TEMPLATE_ID>
DLT_TEMPLATE_ORDER_DELIVERED=<APPROVED_TEMPLATE_ID>
DLT_TEMPLATE_DELIVERY_FAILED=<APPROVED_TEMPLATE_ID>
```
