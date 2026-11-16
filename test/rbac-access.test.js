const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  allowRoles,
  allowPermissions,
  allowActions,
} = require("../src/shared/middleware/access");
const {
  getRoutePermission,
} = require("../src/shared/auth/request-route-policy");
const {
  managementCatalog,
} = require("../src/shared/auth/module-management-catalog");
const { MODULE_CATALOG } = require("../src/shared/auth/module-catalog");
const { SIDEBAR_MODULES } = require("../src/shared/auth/admin-sidebar-catalog");
const { moduleCode } = require("../src/shared/auth/rbac-module-policy");
const routes = require("../src/shared/auth/route-permission-map.json");
const run = (guard, auth, url, method = "GET") => {
  let result = "not called";
  guard({ auth, originalUrl: url, method }, {}, (error) => {
    result = error || null;
  });
  return result;
};

for (const [method, path, module, action] of routes) {
  test(`${method} ${path}: explicit action allows, missing action denies`, () => {
    const url = `/api/v1${path.replace(/:[^/]+/g, "fixture-id")}`;
    const resolved = getRoutePermission({ method, originalUrl: url });
    assert.equal(resolved.module, module);
    assert.equal(resolved.action, action);
    const auth = {
      role: "sub-admin",
      permissions: [`${module}:view`, `${module}:${action}`],
    };
    assert.equal(
      run(allowRoles("admin", "sub-admin"), auth, url, method),
      null,
    );
    assert.equal(
      run(allowPermissions(`${module}:${action}`), auth, url, method),
      null,
    );
    assert.equal(run(allowActions("legacy:action"), auth, url, method), null);
    const denied = {
      role: "sub-admin",
      allowedModules: [module],
      permissions: action === "view" ? [] : [`${module}:view`],
    };
    assert.equal(
      run(allowRoles("admin", "sub-admin"), denied, url, method)?.statusCode,
      403,
    );
    assert.equal(
      run(allowPermissions(`${module}:${action}`), denied, url, method)
        ?.statusCode,
      403,
    );
    assert.equal(
      getRoutePermission({
        method,
        originalUrl: `${url.toUpperCase()}/?q=test`,
      }).action,
      action,
    );
  });
}

test("marketing picker access cannot authorize product details or other product reads", () => {
  const auth = { role: "sub-admin", permissions: ["referral:view"] };
  const guard = allowRoles("admin", "sub-admin");
  assert.equal(run(guard, auth, "/api/v1/admin/products?limit=20"), null);
  for (const path of [
    "/admin/products/fixture",
    "/admin/products/fixture/revisions",
    "/products/prefill",
    "/products/seller/me",
  ]) {
    assert.equal(run(guard, auth, `/api/v1${path}`)?.statusCode, 403, path);
  }
  assert.equal(
    run(guard, auth, "/api/v1/admin/products", "POST")?.statusCode,
    403,
  );
});

test("seller ownership policy remains seller-scoped; platform RBAC requires grants", () => {
  assert.equal(
    run(
      allowPermissions("products:update"),
      { role: "seller" },
      "/api/v1/products/fixture",
      "PATCH",
    ),
    null,
  );
  assert.equal(
    run(
      allowPermissions("rbac:assign"),
      { role: "seller", permissions: ["rbac:view", "rbac:assign"] },
      "/api/v1/rbac/users/fixture/permissions",
      "PUT",
    )?.statusCode,
    403,
  );
  assert.equal(
    run(
      allowPermissions("rbac:assign"),
      { role: "admin", permissions: [] },
      "/api/v1/rbac/users/fixture/permissions",
      "PUT",
    )?.statusCode,
    403,
  );
  assert.equal(
    run(
      allowPermissions("rbac:assign"),
      { role: "super-admin" },
      "/api/v1/rbac/users/fixture/permissions",
      "PUT",
    ),
    null,
  );
  assert.equal(
    run(allowPermissions("products:view"), undefined, "/api/v1/admin/products")
      ?.statusCode,
    401,
  );
});

test("empty database inventory exposes every capability without granting or creating permissions", () => {
  const rows = managementCatalog([]);
  assert.deepEqual(
    new Set(rows.map((row) => row.slug)),
    new Set(MODULE_CATALOG.map(moduleCode)),
  );
  assert.ok(
    rows.every(
      (row) =>
        row.id === null &&
        row.configured === false &&
        row.active === false &&
        row.permissions.length === 0,
    ),
  );
});

test("navigation inventory includes hidden entries, seller entries and parent labels", () => {
  const rows = managementCatalog([], "sidebar");
  assert.equal(rows.length, SIDEBAR_MODULES.length);
  assert.equal(
    rows.find((row) => row.slug === "sidebar-add-product").isVisibleInSidebar,
    false,
  );
  assert.ok(rows.some((row) => row.panel === "seller"));
  assert.ok(
    rows.find((row) => row.slug === "sidebar-product-catalog").parentModule
      ?.moduleName,
  );
});

test("configured rows and assignments are preserved; aliases do not create duplicate capability rows", () => {
  const stored = [
    {
      id: "original-id",
      slug: "products",
      name: "Products",
      active: false,
      status: "inactive",
      permissions: [
        {
          id: "original-permission",
          slug: "products:view",
          action: "view",
          active: true,
          assigned: true,
        },
      ],
    },
  ];
  const snapshot = JSON.stringify(stored);
  const rows = managementCatalog(stored);
  const product = rows.find((row) => row.slug === "products");
  assert.equal(product.id, "original-id");
  assert.equal(product.active, false);
  assert.equal(product.permissions[0].id, "original-permission");
  assert.equal(product.permissions[0].assigned, true);
  assert.equal(rows.filter((row) => row.slug === "products").length, 1);
  assert.equal(JSON.stringify(stored), snapshot);
});

test("own sidebar needs authentication/account role but never RBAC-management grants", () => {
  for (const role of ["admin", "sub-admin"]) {
    for (const permissions of [[], ["referral:view"]]) {
      const auth = { role, permissions };
      for (const method of ["GET", "HEAD"]) assert.equal(run(allowRoles("admin", "sub-admin"), auth, "/api/v1/rbac/modules/sidebar?limit=1000", method), null);
      for (const path of ["/rbac/modules", "/rbac/modules/fixture-id", "/rbac/permission-management/modules"]) assert.equal(run(allowRoles("admin", "sub-admin"), auth, `/api/v1${path}`)?.statusCode, 403);
    }
  }
  assert.equal(run(allowRoles("admin", "sub-admin"), null, "/api/v1/rbac/modules/sidebar")?.statusCode, 401);
  assert.equal(run(allowRoles("admin", "sub-admin"), { role: "seller", permissions: [] }, "/api/v1/rbac/modules/sidebar")?.statusCode, 403);
  assert.equal(run(allowRoles("admin", "sub-admin"), { role: "admin", permissions: ["referral:view"] }, "/api/v1/rbac/modules/sidebar", "PATCH")?.statusCode, 403);
});
