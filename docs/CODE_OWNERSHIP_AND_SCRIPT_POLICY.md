# Shared Code And Script Ownership

Each cross-cutting concern has one source of truth. New helpers should extend the owner below instead of creating another parallel utility.

| Concern | Backend owner | Admin owner | Customer owner |
| --- | --- | --- | --- |
| RBAC and permissions | `src/shared/auth/module-catalog.js`, `module-access.js`, RBAC services | `Admin/src/_helpers/rbacRoutes.js`, `usePermission.js` | `customer/src/utils/roles.js` |
| Sidebar and menu | Backend sidebar catalog returned by the RBAC API | `Admin/src/components/Sidebar/Sidebar.js` renders API data | Not applicable |
| Routes | Module route files and `src/api/register-routes.js` | `Admin/src/components/Layout/Layout.js`, `rbacRoutes.js` | `customer/src/App.jsx`, `constants/routes.js` |
| API transport | Express controllers/services and response middleware | `axiosProvider.js`; `apiConfig.js` is the compatibility facade | `customer/src/api/client.js` and `api/endpoints.js` |
| Validation | Module `*.validation.js` files and shared helpers | `_helpers/validation.js` and feature forms | Feature validation modules |
| Status/dropdown data | Dynamic `/meta/dropdowns/:resource` references | `_helpers/dropdownApi.js` and `useDropdownOptions.js` | API data and domain constants |
| Error handling | `AppError` and error middleware | `_helpers/normalizeApiError.js` through Axios | `api/normalizeApiError.js` and `utils/apiErrors.js` |
| Auth and tokens | Auth module and authentication middleware | `_helpers/authSession.js`, `authStorage.js`, `axiosProvider.js` | Auth API/store and route guards |
| Seller organization context | Seller organization services and middleware | `sellerOrganizationContext.js`; Axios adds `X-Organization-Id` | Seller onboarding/account API flows |
| Formatting and CSS classes | Domain services/renderers | Retained formatting in `_helpers/globalFunctions.js` | `customer/src/lib/utils.js` and ecommerce money helpers |

## Script Policy

- `sequelize/migrations/` is the only application migration history. Applied migrations are immutable and remain available for fresh environments.
- `sql/init.sql` only bootstraps the Docker PostgreSQL container. Schema evolution belongs in Sequelize migrations.
- `scripts/seed/master-seed.js` is the only commerce seed orchestrator. It accepts modules or the `all`/`catalog` profiles. Only `all --reset` performs a database-wide reset; scoped seeds are additive/idempotent.
- `scripts/db/` contains named operational commands. Every retained command is exposed in `package.json`.
- One-time backfills remain idempotent, receive a `db:backfill:*` package command, and are removed only after all supported environments no longer need them.
- Static demo and QA wrappers are not retained. Use scoped master seeds and automated flow tests instead.

Before deleting shared code, verify package commands, static imports, dynamic registration, deployment files, and documentation references. Frontend builds and backend checks are required after cleanup.
