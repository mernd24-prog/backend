# RBAC Flow Guide

Complete reference for the Role-Based Access Control system used across the admin panel and seller portal.

---

## 1. Permission Slug Format

Every permission is a two-part string:

```
module:action
```

Examples:

```
products:view
products:create
products:update
orders:status_change
rbac:assign
seller_kyc:approve
admin_users:delete
```

`module:view` is the **base permission**. It controls sidebar visibility, page access, and all GET endpoints. Any other action automatically implies `view` — the backend adds it implicitly.

---

## 2. Available Actions

Defined in `src/shared/auth/rbac-permissions.js → PERMISSION_ACTIONS`:

| Action        | What it gates                                   |
|---------------|-------------------------------------------------|
| `view`        | Sidebar item, page open, all GET reads          |
| `create`      | POST endpoints, Add button                      |
| `update`      | PATCH/PUT endpoints, Edit button                |
| `delete`      | DELETE endpoints, Delete button                 |
| `approve`     | Approve endpoints / buttons                     |
| `reject`      | Reject endpoints / buttons                      |
| `assign`      | Role/module/permission assignment endpoints     |
| `export`      | Export endpoint, Export button                  |
| `import`      | Import endpoint, Import button                  |
| `status_change` | Status-toggle endpoints, Active/Inactive controls |
| `restore`     | Restore/undelete endpoints                      |
| `bulk_action` | Bulk-operation endpoints                        |

Sidebar-only action subset (`SIDEBAR_PERMISSION_ACTIONS`):  
`view, create, update, delete, status_change, approve, reject, assign, export, import`  
(`restore` and `bulk_action` are not used in sidebar permission assignments.)

### Action aliases (backend normalizes these before comparing)

| Alias     | Canonical        |
|-----------|------------------|
| `add`     | `create`         |
| `edit`    | `update`         |
| `status`  | `status_change`  |
| `approval`| `approve`        |
| `action`  | `status_change`  |
| `review`  | `approve`        |
| `manage`  | `status_change`  |

---

## 3. Data Stores

### MongoDB (`UserModel`)

Stores identity, role, and hierarchy scope:

```
role               — string role slug ("admin", "sub-admin", "seller", …)
allowedModules     — array of module slugs this user can access
ownerAdminId       — root admin _id for platform-side hierarchy scoping
ownerSellerId      — root seller _id for seller-side hierarchy scoping
permissionVersion  — incremented when permissions change; invalidates cache
sessionVersion     — incremented when session should be forced out
tokenVersion       — incremented when all tokens should be invalidated
```

### PostgreSQL (via Sequelize)

Stores the RBAC catalog and all assignments:

| Table               | Purpose                                              |
|---------------------|------------------------------------------------------|
| `modules`           | Permission modules (products, orders, rbac, …)       |
| `permissions`       | Individual `module:action` permission records        |
| `roles`             | Role definitions (admin, sub-admin, seller, …)       |
| `role_permissions`  | Which permissions a role has                         |
| `user_permissions`  | Per-user allow and deny overrides                    |
| `user_roles`        | Which roles a user has been assigned                 |
| `super_admins`      | Super-admin registry                                 |

`user_permissions.metadata.effect` is `"allow"` or `"deny"`.

---

## 4. Authentication Middleware (`authenticate`)

File: `src/shared/middleware/authenticate.js`

On every protected request:

1. Extracts `Bearer <token>` from `Authorization` header.
2. Verifies the JWT with `env.jwtAccessSecret`.
3. Calls `hydrateAuthPermissions(payload)` which:
   - Loads the MongoDB user (`UserModel.findById`).
   - Validates `accountStatus`, `role`, role active state, session/token version.
   - Calls `RbacService.getUserEffectivePermissions(userId)` to get all effective permission slugs.
   - Builds `allowedModules` = union of Mongo `allowedModules` + modules inferred from permission slugs.
   - Returns the enriched `req.auth` object.
4. Sets `req.auth` with:

```js
{
  sub: userId,
  role,
  roles: [role],
  isSuperAdmin,
  allowedModules,        // merged from Mongo + permissions
  permissions,           // ["products:view", "orders:create", …]
  ownerAdminId,          // from Mongo user record
  ownerSellerId,         // from Mongo user record
  tokenVersion,
  sessionVersion,
  permissionVersion,
}
```

### Permission cache

Set `PERMISSION_CACHE_TTL_MS` env var to enable in-process caching of effective permissions.  
Cache key: `userId:sessionVersion:permissionVersion` — invalidated automatically when either version increments.

---

## 5. Effective Permission Calculation

File: `src/modules/rbac/services/rbac.service.js → getUserEffectivePermissions`

```
effectivePermissions =
  scope( rolePermissions + directAllowPermissions )
  + implicitViewPermissions
  - deniedPermissions
```

Step by step:

1. **Super-admin** → returns all active permissions from the entire catalog. No further checks.
2. **Role permissions** — from `user_roles → role_permissions` for all roles assigned to the user.
3. **Direct allow permissions** — from `user_permissions` where `metadata.effect = "allow"`.
4. **Module scope filter** — for `admin`, `sub-admin`, `seller-admin`, `seller-sub-admin`: permissions are filtered to only those whose module is in `user.allowedModules`.
5. **Denied permissions** — removed from the set. Comes from `user_permissions` where `metadata.effect = "deny"`. **Deny wins over role and direct allow.**
6. **Implicit view** — after removing denied, for every non-view permission remaining, `module:view` is added if not already present and not explicitly denied.
7. Deduplicated by slug.

### Denied permissions rule

- Denying `products:update` does not deny `products:view`. Deny `products:view` separately if the page itself should be hidden.
- A deny in `user_permissions` removes the slug even if it comes from the user's role.

---

## 6. Authorization Middleware

File: `src/shared/middleware/access.js`

Three middleware factories are used across routes:

### `allowRoles(...roles)`

Used on route groups. Does in order:

1. Checks `isSuperAdmin` → pass.
2. Calls `enforceModuleScope` — verifies the inferred request module is in `req.auth.allowedModules`.
3. Checks if user's role is in the allowed list.
4. Calls `enforceRequestPermission` — verifies the user has `module:inferredAction` in `req.auth.permissions`.

### `allowPermissions(...slugs)`

Used on individual routes requiring a specific permission. Does:

1. Checks `isSuperAdmin` → pass.
2. **Owner seller bypass** — if user is `seller` role AND all required slugs start with `sellers:`, pass.
3. Calls `enforceModuleScope`.
4. Checks every required slug against `req.auth.permissions` (aliases expanded).

### `allowActions(...actions)`

Lower-level check against specific action strings. Used for non-module routes.

### HTTP method → action inference

File: `src/shared/middleware/access.js → inferRequestAction`

| Method  | Default action |
|---------|---------------|
| GET     | `view`        |
| POST    | `create`      |
| PUT     | `update`      |
| PATCH   | `update`      |
| DELETE  | `delete`      |

Path pattern overrides (checked first):

| Path pattern                             | Action          |
|------------------------------------------|-----------------|
| `/approve` or `/approval`                | `approve`       |
| `/reject`                                | `reject`        |
| `/access/sub-admins/:id/modules` (non-GET) | `assign`      |
| `/roles/:id/permissions` (non-GET)       | `assign`        |
| `/users/:id/permissions` (non-GET)       | `assign`        |
| `/users/:id/roles` (non-GET)             | `assign`        |
| `/assign` (non-GET)                      | `assign`        |
| `/status`, `/moderate`, `/review` (non-GET) | `status_change` |
| `/bulk` (non-GET)                        | `bulk_action`   |
| `/import`                                | `import`        |
| `/export`                                | `export`        |

---

## 7. Module Scope Enforcement

`enforceModuleScope` (called inside `allowRoles` and `allowPermissions`) uses `getRequestModule(req)` to detect the module from the URL, then checks it against:

```
allowedModules = union(user.allowedModules, modules derived from req.auth.permissions)
```

If the request module is not in scope → **403 Forbidden: module access denied**.

Route → module mapping is centralized in:
`src/shared/auth/module-access.js → getRequestModule`

---

## 8. Full Module Catalog

Defined in `src/shared/auth/module-catalog.js`. Seeded to PostgreSQL `modules` table via `scripts/db/seed-rbac.js`.

### Platform modules (`forPlatform = true`) — assignable to admin / sub-admin

| Tab                  | Slug               | Name                            |
|----------------------|--------------------|----------------------------------|
| Dashboard            | `admin`            | Admin Dashboard                  |
| Catalog Management   | `products`         | Product Management               |
| Catalog Management   | `platform`         | Platform Catalog                 |
| Catalog Management   | `categories`       | Category Management              |
| Catalog Management   | `sub_categories`   | Sub Category Management          |
| Catalog Management   | `sub_sub_categories` | Sub Sub Category Management    |
| Catalog Management   | `brands`           | Brand Management                 |
| Catalog Management   | `option_masters`   | Option Master Management         |
| Catalog Management   | `option_values`    | Option Value Management          |
| Inventory Management | `inventory`        | Inventory Management             |
| Orders Management    | `orders`           | Order Management                 |
| Orders Management    | `returns`          | Return Management                |
| Orders Management    | `payments`         | Payment Management               |
| Orders Management    | `wallets`          | Wallet Management                |
| Orders Management    | `carts`            | Cart Management                  |
| Orders Management    | `subscriptions`    | Subscription Management          |
| Users & Access       | `admin_users`      | Admin/Sub Admin Management       |
| Users & Access       | `rbac`             | RBAC Management                  |
| Users & Access       | `users`            | User Management                  |
| Users & Access       | `sellers`          | Seller Management                |
| Users & Access       | `seller_kyc`       | Seller KYC Management            |
| Users & Access       | `seller_bank`      | Seller Bank Management           |
| Marketing            | `coupons`          | Coupon Management                |
| Marketing            | `pricing`          | Pricing & Promotions             |
| Marketing            | `dynamic-pricing`  | Dynamic Pricing                  |
| Marketing            | `referral`         | Referral Commerce                |
| Marketing            | `loyalty`          | Loyalty Management               |
| Marketing            | `recommendations`  | Recommendation Management        |
| Marketing            | `banners`          | Banner Management                |
| Marketing            | `notifications`    | Notification Management          |
| Tax & Compliance     | `tax`              | Tax Management                   |
| Tax & Compliance     | `delivery`         | Delivery Management              |
| Tax & Compliance     | `warranty`         | Warranty Management              |
| Reports & Analytics  | `analytics`        | Analytics                        |
| Reports & Analytics  | `reports`          | Report Management                |
| Location Management  | `countries`        | Country Management               |
| Location Management  | `states`           | State Management                 |
| Location Management  | `cities`           | City Management                  |
| Location Management  | `zip_codes`        | Zip Code Management              |
| Settings             | `cms_pages`        | CMS/Page Management              |
| Settings             | `cms`              | CMS Management                   |
| Settings             | `reviews`          | Review & Rating Management       |
| Settings             | `fraud`            | Fraud Management                 |

### Seller modules (`forSeller = true`) — assignable to seller / seller-admin / seller-sub-admin

`products`, `inventory`, `orders`, `returns`, `sellers`, `sellers/commissions`, `coupons`, `pricing`, `notifications`, `analytics`, `reports`, `delivery`

---

## 9. RBAC API Routes

All routes require `authenticate` + `allowRoles(admin, sub-admin)`.

Base path: `/api/rbac`

### Modules

| Method | Path                          | Permission required  | Description                        |
|--------|-------------------------------|---------------------|------------------------------------|
| GET    | `/modules`                    | `rbac:view`         | List all modules                   |
| GET    | `/modules/:moduleId`          | `rbac:view`         | Get single module                  |
| POST   | `/modules`                    | `rbac:create`       | Create module                      |
| PATCH  | `/modules/:moduleId`          | `rbac:update`       | Update module                      |
| DELETE | `/modules/:moduleId`          | `rbac:delete`       | Delete module                      |
| PATCH  | `/modules/:moduleId/status`   | `rbac:status_change`| Activate / deactivate module       |
| POST   | `/modules/reorder`            | `rbac:update`       | Reorder modules                    |
| GET    | `/modules/sidebar`            | _(none, open)_      | Sidebar tree filtered by user perms |
| GET    | `/permission-management/modules` | `rbac:view`      | Permission matrix (role or user)   |

#### Permission management matrix query params

| Param         | Effect                                          |
|---------------|-------------------------------------------------|
| `roleId`      | Matrix pre-loaded with role permissions         |
| `roleSlug`    | Matrix pre-loaded by role slug                  |
| `userId`      | Matrix pre-loaded with user effective + denied permissions |
| `scope=sidebar` | Filters to sidebar-visible modules only       |
| `active`      | Filter by module active state                   |

### Permissions

| Method | Path                       | Permission required | Description              |
|--------|----------------------------|---------------------|--------------------------|
| GET    | `/permissions`             | `rbac:view`         | List permissions         |
| GET    | `/permissions/:id`         | `rbac:view`         | Get single permission    |
| POST   | `/permissions`             | `rbac:create`       | Create permission        |
| PATCH  | `/permissions/:id`         | `rbac:update`       | Update permission        |
| DELETE | `/permissions/:id`         | `rbac:delete`       | Delete permission        |

### Roles

| Method | Path                            | Permission required | Description                      |
|--------|---------------------------------|---------------------|----------------------------------|
| GET    | `/roles`                        | `rbac:view`         | List roles                       |
| GET    | `/roles/:roleId`                | `rbac:view`         | Get single role                  |
| POST   | `/roles`                        | `rbac:create`       | Create role                      |
| PATCH  | `/roles/:roleId`                | `rbac:update`       | Update role (invalidates sessions)|
| DELETE | `/roles/:roleId`                | `rbac:delete`       | Delete role (invalidates sessions)|
| GET    | `/roles/:roleId/permissions`    | `rbac:view`         | Get role's permissions           |
| POST   | `/roles/:roleId/permissions`    | `rbac:assign`       | Add single permission to role    |
| DELETE | `/roles/:roleId/permissions`    | `rbac:delete`       | Remove permission from role      |
| POST   | `/roles/:roleId/permissions/bulk` | `rbac:assign`     | Add multiple permissions to role |
| PUT    | `/roles/:roleId/permissions`    | `rbac:assign`       | **Replace** all role permissions |

### User Permissions

| Method | Path                                  | Permission required | Description                        |
|--------|---------------------------------------|---------------------|------------------------------------|
| GET    | `/users/:userId/permissions`          | `rbac:view`         | Get user's direct permissions      |
| GET    | `/users/:userId/permissions/effective`| `rbac:view`         | Full effective permission breakdown|
| GET    | `/users/:userId/permissions/check`    | `rbac:view`         | Check if user has a specific slug  |
| POST   | `/users/:userId/permissions`          | `rbac:assign`       | Add single permission to user      |
| DELETE | `/users/:userId/permissions`          | `rbac:delete`       | Remove single permission from user |
| POST   | `/users/:userId/permissions/bulk`     | `rbac:assign`       | Add multiple permissions to user   |
| PUT    | `/users/:userId/permissions`          | `rbac:assign`       | **Sync** allow + deny permissions  |

`PUT /users/:userId/permissions` payload:

```json
{
  "permissionIds": ["uuid-1", "uuid-2"],
  "deniedPermissionIds": ["uuid-3"]
}
```

This replaces all direct allow and deny records for the user in one call.

### User Roles

| Method | Path                             | Permission required | Description                     |
|--------|----------------------------------|---------------------|---------------------------------|
| GET    | `/users/:userId/roles`           | `rbac:view`         | Get user's roles                |
| GET    | `/users/:userId/roles/check`     | `rbac:view`         | Check if user has a role        |
| POST   | `/users/:userId/roles`           | `rbac:assign`       | Assign role to user             |
| DELETE | `/users/:userId/roles`           | `rbac:delete`       | Remove role from user           |
| POST   | `/users/:userId/roles/bulk`      | `rbac:assign`       | Bulk assign roles               |

---

## 10. Admin Access API Routes

Base path: `/api/admin`

Auth: `authenticate` + `allowRoles(admin, sub-admin)` on all routes below.

### Module access matrix (used by UI permission editor)

| Method | Path                | Permission | Description                                |
|--------|---------------------|------------|--------------------------------------------|
| GET    | `/access/modules`   | _(inferred)_ | Returns assignable modules + permission matrix for a role or user |

Query params: `userId`, `roleId`, `roleSlug`, `includePermissions`, `active`

### Activity logs

| Method | Path                    | Permission  | Description            |
|--------|-------------------------|-------------|------------------------|
| GET    | `/access/activity-logs` | `rbac:view` | Paginated audit log    |

### Admin users (classic access paths)

| Method | Path                              | Role required                  | Description                           |
|--------|-----------------------------------|--------------------------------|---------------------------------------|
| POST   | `/access/admins`                  | `super-admin` only             | Create admin                          |
| GET    | `/access/admins`                  | `super-admin` or `admin`       | List admins                           |
| POST   | `/access/sub-admins`              | `super-admin` or `admin`       | Create sub-admin                      |
| GET    | `/access/sub-admins`              | `super-admin` or `admin`       | List sub-admins                       |
| PATCH  | `/access/sub-admins/:userId/modules` | `super-admin` or `admin`    | Update sub-admin modules + permissions|

### Admin users (alternate paths used by frontend admin-users pages)

| Method | Path                         | Role required                | Description               |
|--------|------------------------------|------------------------------|---------------------------|
| GET    | `/admin-users/admins`        | `super-admin` or `admin`     | List admins               |
| GET    | `/admin-users/sub-admins`    | `super-admin` or `admin`     | List sub-admins           |
| POST   | `/admin-users/admin`         | `super-admin` only           | Create admin              |
| POST   | `/admin-users/sub-admin`     | `super-admin` or `admin`     | Create sub-admin          |
| PUT    | `/admin-users/:userId`       | `super-admin` or `admin`     | Update admin user profile |
| PUT    | `/admin-users/:userId/permissions` | `super-admin` or `admin` | Update modules/permissions|
| PUT    | `/admin-users/:userId/status`| `super-admin` or `admin`     | Change account status     |

### Seller users (platform side)

| Method | Path                               | Role required             | Description                  |
|--------|------------------------------------|---------------------------|------------------------------|
| GET    | `/seller-users/sellers`            | `super-admin` or `admin`  | List sellers                 |
| GET    | `/seller-users/seller-admins`      | `super-admin` or `admin`  | List seller-admins           |
| GET    | `/seller-users/seller-sub-admins`  | `super-admin` or `admin`  | List seller-sub-admins       |
| POST   | `/seller-users/seller-admin`       | `super-admin` or `admin`  | Create seller-admin          |
| POST   | `/seller-users/seller-sub-admin`   | `super-admin` or `admin`  | Create seller-sub-admin      |

---

## 11. Module + Permission Assignment Flow

### The main method: `syncUserModulePermissions`

Used by `createAdmin`, `createPlatformSubAdmin`, `createSellerStaff`, and `updatePlatformSubAdminModules` in `AdminService`.

```js
await rbacService.syncUserModulePermissions(userId, modulePermissions, grantedBy);
```

`modulePermissions` shape:

```json
[
  { "module": "products", "actions": ["view", "create", "update"] },
  { "module": "orders",   "actions": ["view", "status_change"]     },
  { "module": "rbac",     "actions": ["view", "assign"]            }
]
```

- `view` is automatically prepended to every module's action list if not present.
- This syncs `user_permissions` for the user — replaces previous module-scoped permissions.
- Invalidates user auth session after sync (forces fresh permission load on next request).

### PATCH `/access/sub-admins/:userId/modules` payload

```json
{
  "allowedModules": ["products", "orders", "rbac"],
  "modulePermissions": [
    { "module": "products", "actions": ["view", "create", "update"] },
    { "module": "orders",   "actions": ["view", "status_change"]     },
    { "module": "rbac",     "actions": ["view", "assign"]            }
  ]
}
```

### Delegation constraints (non-super-admin actors)

Enforced in `AdminService.constrainModuleAssignmentByActor`:

1. Target user must be inside actor's hierarchy (`ownerAdminId` or `ownerSellerId` must match).
2. Actor can only assign modules they themselves have in `allowedModules`.
3. Actor can only assign actions they themselves have as permissions.
4. If these constraints are violated → **403**.

---

## 12. Sidebar Module API

```
GET /api/rbac/modules/sidebar
```

- Returns the full sidebar tree filtered to only modules the requesting user has `module:view` for.
- Super-admin sees everything.
- Tree is nested by `parentModuleId`.
- Sorted by `order` then name.

Sidebar modules are seeded separately with `metadata.source = "sidebar-seed"`.

### Sidebar permission expansion

When a sidebar permission is assigned (e.g., a sidebar item for the products page), the backend expands it to the real backend module permission:

```
sidebar item → metadata.requiredModule = "products"
assigned action = "view"
expanded to → products:view
```

This is done in `RbacService.expandSidebarPermissionIds()`. The expansion also adds implicit `view` for any non-view actions.

---

## 13. Effective Permissions Debug API

```
GET /api/rbac/users/:userId/permissions/effective
```

Response shape:

```json
{
  "role": "sub-admin",
  "userType": "sub-admin",
  "assignedModules": ["products", "orders"],
  "assignedPermissions": ["products:view", "products:create", "orders:view"],
  "rolePermissions": ["products:view"],
  "extraUserPermissions": ["products:create"],
  "deniedPermissions": [],
  "permissionBreakdown": {
    "rolePermissions": [...],
    "extraUserPermissions": [...],
    "deniedPermissions": [],
    "effectivePermissions": [...]
  },
  "permissionsByAction": {
    "products": { "view": true, "create": true },
    "orders": { "view": true }
  },
  "sidebarModules": [...],
  "effectivePermissions": ["products:view", "products:create", "orders:view"]
}
```

Use this endpoint to answer:
- Why can this user see (or not see) a module?
- Which source gave a permission (role vs direct)?
- Which deny removed a permission?
- Why is a sidebar item missing?

---

## 14. Session Invalidation

Defined in `src/shared/auth/session-state.js`.

Triggered automatically by:

| Event                             | Method called                           |
|-----------------------------------|-----------------------------------------|
| Permission assigned/removed/synced | `invalidateUserAuthSession(userId)`    |
| Role assigned/removed             | `invalidateUserAuthSession(userId, ROLE_CHANGED)` |
| Role permissions changed          | `invalidateUsersForRole(roleId)`        |
| Role deleted/updated (slug/active)| `invalidateUsersForRole(roleId)`        |

Invalidation increments `sessionVersion` and `permissionVersion` on the Mongo user, which causes the JWT validation to fail on the next request and forces re-login.

---

## 15. User Type Behavior Summary

| Role               | Module access       | Can assign to                          | Notes                                       |
|--------------------|---------------------|----------------------------------------|---------------------------------------------|
| `super-admin`      | All permissions     | Anyone                                 | Bypasses all checks; not in module-scope logic |
| `admin`            | Assigned modules    | sub-admin, seller, seller-admin, seller-sub-admin under them | Can delegate only modules/actions they have |
| `sub-admin`        | Assigned modules    | (none by default)                      | Can assign if `rbac:assign` or `admin_users:assign` granted |
| `seller`           | Seller modules      | seller-admin, seller-sub-admin under them | Owner-seller bypass on `sellers:*` checks  |
| `seller-admin`     | Assigned seller modules | seller-sub-admin under their seller | Needs explicit assign permission           |
| `seller-sub-admin` | Assigned seller modules | (none)                               |                                             |

---

## 16. Common Debug Checklist

1. Check `user.role` in MongoDB.
2. Check `user.allowedModules` in MongoDB.
3. Call `GET /api/rbac/users/:userId/permissions/effective` — confirm the needed slug is present.
4. Confirm the API route maps to the expected module in `src/shared/auth/module-access.js → getRequestModule`.
5. Confirm the inferred action matches — check `inferRequestAction` in `src/shared/middleware/access.js`.
6. If a sidebar item is missing — confirm `module:view` is in effective permissions.
7. If permissions were just changed — the session is auto-invalidated; user must get a new token.
8. If a deny is unexpectedly present — check `user_permissions` where `metadata.effect = "deny"`.
9. If actor gets 403 on assignment — check `constrainModuleAssignmentByActor` — actor may lack the module or action themselves.

---

## 17. File Map

| Purpose                                  | File                                                          |
|------------------------------------------|---------------------------------------------------------------|
| RBAC API routes                          | `src/modules/rbac/routes/rbac.routes.js`                      |
| RBAC service (all business logic)        | `src/modules/rbac/services/rbac.service.js`                   |
| RBAC repository (all SQL queries)        | `src/modules/rbac/repositories/rbac.repository.js`            |
| Permission constants and helpers         | `src/shared/auth/rbac-permissions.js`                         |
| JWT authentication + permission hydration| `src/shared/middleware/authenticate.js`                       |
| Role/permission/module enforcement       | `src/shared/middleware/access.js`                             |
| Route → module slug mapping              | `src/shared/auth/module-access.js`                            |
| Module catalog (seeded to PostgreSQL)    | `src/shared/auth/module-catalog.js`                           |
| Sidebar catalog                          | `src/shared/auth/admin-sidebar-catalog.js`                    |
| Role slug constants                      | `src/shared/constants/roles.js`                               |
| Legacy role action policies              | `src/shared/constants/access-policies.js`                     |
| Admin access + assignment service        | `src/modules/admin/services/admin.service.js`                 |
| Admin access routes                      | `src/modules/admin/routes/admin.routes.js`                    |
| RBAC seeding script                      | `scripts/db/seed-rbac.js`                                     |
