# Admin & Seller Hierarchy

## Role Tree

```
super-admin  (level 0)
└── admin    (level 1)  ← one per business domain; owns all below
    ├── sub-admin        (level 2)  ← platform-side staff of this admin
    └── seller           (level 2)  ← merchant onboarded under this admin
        ├── seller-admin     (level 3)  ← seller's manager/staff
        └── seller-sub-admin (level 4)  ← seller's junior staff
```

`buyer` (level 9) is a separate track and is never part of this hierarchy.

---

## Role Slugs

| Role slug           | `ROLES` constant         | Level |
|---------------------|--------------------------|-------|
| `super-admin`       | `ROLES.SUPER_ADMIN`      | 0     |
| `admin`             | `ROLES.ADMIN`            | 1     |
| `sub-admin`         | `ROLES.SUB_ADMIN`        | 2     |
| `seller`            | `ROLES.SELLER`           | 2     |
| `seller-admin`      | `ROLES.SELLER_ADMIN`     | 3     |
| `seller-sub-admin`  | `ROLES.SELLER_SUB_ADMIN` | 4     |

---

## Hierarchy Fields (UserModel)

| Field            | Type   | Set on                              | Value                                                     |
|------------------|--------|-------------------------------------|-----------------------------------------------------------|
| `createdBy`      | String | All managed users                   | `_id` of the user who created this account                |
| `createdByRole`  | String | All managed users                   | Role of the creator                                       |
| `hierarchyLevel` | Number | All managed users                   | Numeric level from the table above                        |
| `parentAdminId`  | String | sub-admin, seller-admin, seller-sub-admin | Direct parent admin's `_id` (null for admin/seller)  |
| `parentSellerId` | String | seller-admin, seller-sub-admin      | Direct parent seller's `_id`                              |
| `ownerAdminId`   | String | admin, sub-admin, seller, seller-admin, seller-sub-admin | Root admin `_id` for this hierarchy branch |
| `ownerSellerId`  | String | seller, seller-admin, seller-sub-admin | Root seller `_id` for this hierarchy branch            |

### ownerAdminId rules

- **admin** → own `_id` (self-referential, set immediately after creation)
- **sub-admin** → `_id` of the admin who created them
- **seller** → `_id` of the admin who registered the seller
- **seller-admin / seller-sub-admin** → same `ownerAdminId` as their seller

### ownerSellerId rules

- **seller** → own `_id` (self-referential, set immediately after creation)
- **seller-admin / seller-sub-admin** → `_id` of the seller they belong to

---

## Who Can Create Whom

| Actor role        | Roles they may create                                               |
|-------------------|---------------------------------------------------------------------|
| `super-admin`     | `admin`, `sub-admin`, `seller`, `seller-admin`, `seller-sub-admin` |
| `admin`           | `sub-admin`, `seller`, `seller-admin`, `seller-sub-admin`          |
| `seller`          | `seller-admin`, `seller-sub-admin`                                 |
| `seller-admin`    | `seller-sub-admin`                                                 |
| `sub-admin`       | (none — read/operate only)                                         |

Enforced by `assertCanCreateRole` / `getAllowedChildRoles` in `AdminService`.

---

## Hierarchy Scoping Rules

### Listing (withActorHierarchyFilter)

| Actor role    | Filter applied                                              |
|---------------|-------------------------------------------------------------|
| `super-admin` | No filter — sees all records                                |
| `admin`       | `ownerAdminId = actor.ownerAdminId ?? actor.userId`         |
| seller-side   | `ownerSellerId = actor.ownerSellerId ?? actor.userId`       |

### Visibility check (assertActorCanSeeUser)

An actor can see a user when:
- Actor is super-admin, **or**
- Actor is `admin` and `user.ownerAdminId === actor.ownerAdminId ?? actor.userId`, **or**
- Actor is seller-side and `user.ownerSellerId === actor.ownerSellerId ?? actor.userId`, **or**
- `user.createdBy === actor.userId`

---

## Module Access

### Platform modules (for admin / sub-admin)

All modules where `forPlatform !== false` in `MODULE_CATALOG`. Assignable slugs come from `DEFAULT_PLATFORM_MODULES`.

Key platform modules: `admin`, `products`, `platform`, `categories`, `sub_categories`, `sub_sub_categories`, `brands`, `option_masters`, `option_values`, `inventory`, `orders`, `returns`, `payments`, `wallets`, `carts`, `subscriptions`, `admin_users`, `rbac`, `users`, `sellers`, `seller_kyc`, `seller_bank`, `coupons`, `pricing`, `dynamic-pricing`, `referral`, `loyalty`, `recommendations`, `banners`, `notifications`, `tax`, `delivery`, `warranty`, `analytics`, `reports`, `countries`, `states`, `cities`, `zip_codes`, `cms_pages`, `cms`, `reviews`, `fraud`

### Seller modules (for seller / seller-admin / seller-sub-admin)

Modules where `forSeller === true`: `products`, `inventory`, `orders`, `returns`, `sellers`, `sellers/commissions`, `coupons`, `pricing`, `notifications`, `analytics`, `reports`, `delivery`

---

## Onboarding Flow for Sellers

```
initiated → profile_completed → kyc_submitted → kyc_verified
                                               → bank_submitted → bank_verified
                                                                 → ready_for_go_live → live
```

A seller can only go live when:
1. `sellerProfile.kycStatus === "verified"`
2. `sellerProfile.bankVerificationStatus === "verified"` (or bank details complete + submitted)
3. `sellerProfile.profileCompleted === true`

---

## Example: How a Full Hierarchy Looks in the DB

```
super-admin  _id=SA
  └── admin  _id=A1   ownerAdminId=A1  createdBy=SA
        ├── sub-admin  _id=SUB1  ownerAdminId=A1  parentAdminId=A1  createdBy=A1
        └── seller     _id=SEL1  ownerAdminId=A1  ownerSellerId=SEL1  createdBy=A1
              ├── seller-admin      _id=SADM1  ownerAdminId=A1  ownerSellerId=SEL1  parentSellerId=SEL1
              └── seller-sub-admin  _id=SSUB1  ownerAdminId=A1  ownerSellerId=SEL1  parentSellerId=SEL1
```

---

## Common Pitfalls

| Symptom | Root cause | Fix |
|---------|------------|-----|
| Admin sees no sub-admins/sellers | `ownerAdminId` is null on the admin's user record | Fixed in `createAdmin` — `ownerAdminId` is now set to the admin's own `_id` post-creation |
| Seller-admin can't be scoped to their seller | `ownerSellerId` is null on the seller's user record | Fixed in `createUser`/`createPlatformSubAdmin` — `ownerSellerId` is now set to the seller's own `_id` post-creation |
| 403 "user is outside your hierarchy" | `ownerAdminId` mismatch between actor and target user | Ensure the target was created through the correct admin |
