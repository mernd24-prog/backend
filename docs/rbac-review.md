# RBAC review and reconciliation

## Module listing

`module-catalog.js` and the existing Express routes define backend capabilities. `admin-sidebar-catalog.js` defines navigation; it is not a second permission namespace.

`rbac-module-policy.js` provides canonical module identities and role scopes. Existing alias rows and their IDs remain stored. Assignment matrices merge equivalent rows into the canonical capability, preserving assigned state. Module Management has separate **Permission modules** and **Navigation entries** views. API-only referral reports, hierarchy, ledger and bonus reports remain assignable.

Categories and their levels use the existing category-hierarchy capability; analytics uses the existing reports capability. Seller Staff Management retains seller-facing naming/availability through its seller scope while using the existing sellers backend capability. No extra application modules or duplicate management pages were created.

## Module permissions

Run from `Admin`:

```sh
npm run check:rbac
npm run sync:rbac
```

The audit parses the mounted Express routers and existing UI permission references without starting the application or connecting to its databases. It inspects 899 route declarations and generates 211 explicit route permission mappings across 55 canonical capabilities. `check:rbac` fails if committed maps are stale. `sync:rbac` regenerates them after intentional route or UI permission changes.

`request-route-policy.js` makes an endpoint's existing explicit permission guard authoritative for both parent-router checks and action inference. This prevents an endpoint guarded by `inventory:create`, for example, from also requiring a guessed `inventory:adjust`. Lookup matches Express's default case-insensitive routing and ignores query text. Generic routes retain the existing method/path fallback.

`route-permission-actions.json` includes actions used by routes and local UI controls, such as client-side export. Permission matrices remove duplicate/unsupported actions. `restore`, `bulk_action`, and `adjust` remain available when supported. Permission slugs must match the module and action. New modules create their actual permission rows transactionally; removing actions archives rows instead of destroying assignment history.

## Roles and effective access

Effective permissions combine active role defaults and individual grants, then apply individual denials. Disabled roles/modules and explicit view denials cannot authorize requests. Alias grants cannot reactivate a disabled canonical module.

Delegated roles inherit defaults within their saved module scope. An explicit empty scope grants no inherited access. Legacy role-only accounts without a stored scope keep their valid inheritance. Direct grants remain independently effective within the account type's permitted scope.

Super-admin bypass and seller-owner access to seller capabilities remain existing system policies. Other admins/staff receive no automatic full-access UI flags. System role identities are protected; only super-admin can change their defaults. Custom roles cannot grant rights beyond the assigning actor's access or be attached across incompatible account types.

## Assignment and removal

Replacing a user's selection denies unchecked inherited rights, so selecting **View** does not leave inherited writes active. Removing View removes all actions for that capability. Empty replacements remove all access. Copy and template replacement use the same effective-permission rules, including replacing with an empty selection.

Unknown, inactive, unsupported, conflicting and out-of-scope assignments fail before changes. Delegated assignment validates ownership hierarchy and the actor's canonical permissions. Module/role/permission changes invalidate affected sessions, including users whose grants use alias rows. Invalidation failures are surfaced instead of reported as successful refreshes.

Cancellation controls use `cancellations` permissions. Seller-finance exports use `sellers/commissions:export`, and finance mutations use its update permission. Referral marketing settings use `referral-rules:view/update`; other commerce settings retain their existing admin scope.

## Existing data and deployment

After deploying the backend and Admin frontend, run from `backend` against the intended application environment:

```sh
npm run db:seed:rbac
```

The seed now preserves existing role activity, custom roles, customized role permission sets and edited template fields. Defaults apply only to newly created roles. Equivalent legacy/sidebar grants are copied to canonical permissions before old invalid rows are deactivated; explicit user denials win. Template permission references are canonicalized/deduplicated while preserving valid references and customized names/descriptions/scopes. Historical assignment records remain available.

The seed refreshes permission versions. Sign out and sign in again to refresh stored frontend permissions. User assignment changes invalidate sessions through the existing session-version mechanism.

No live application database or accounts were seeded during this review. All database integration tests used a separate temporary PostgreSQL cluster/schema.

## Validation

- 25 API module-access regression tests.
- 21 catalog/role/assignment workflow tests, including positive and negative checks for all 211 explicit route mappings and case variants.
- 11 real PostgreSQL integration tests: module rows/counts, active role/module filtering, catalog reconciliation, alias/deny preservation, custom role lifecycle, template migration, and HTTP assignment/read/write/revoke flows.
- 4 React role-editor tests: action listing, implicit View, removal, saving and read-only system defaults.
- Admin production build passes with existing application warnings. Changed frontend files lint without errors.
- The full Admin test suite has 9 passing tests and the same 2 pre-existing failures in `CodCollectionsFlow.test.jsx`: its dispatch mock returns `undefined` where the component expects a promise. The 4 new RBAC UI tests pass.

The PostgreSQL harness uses only `/tmp/ecommerce-rbac-test-pg` on Unix-socket port 55439 and a disposable `rbac_test_*` schema; it never reads application database credentials. Its HTTP tests supply test identities while using real validation, controllers, services, middleware and PostgreSQL persistence. Live browser login/MongoDB integration and deployment smoke tests remain environment-dependent.

```sh
# backend
npm run test:rbac
npm run test:rbac:postgres

# Admin
npm run check:rbac
CI=true npm test -- --watch=false --runInBand --runTestsByPath src/pages/UserManagement/RolesPermissions/RolesPermissions.test.jsx
npm run build
```

To reproduce the isolated database suite in this workspace, initialize `/tmp/ecommerce-rbac-test-pg` once with PostgreSQL 16 `initdb --auth=trust --no-locale --encoding=UTF8`, then start it without TCP listeners:

```sh
/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/ecommerce-rbac-test-pg -l /tmp/ecommerce-rbac-test-pg/server.log -o "-c listen_addresses='' -k /tmp/ecommerce-rbac-test-pg -p 55439" start
# From backend:
npm run test:rbac:postgres
/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/ecommerce-rbac-test-pg stop -m fast
```

The temporary server used during this review has been stopped.
