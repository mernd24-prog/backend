// Isolated flow audit: no database, network, payment or courier side effects.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../..");
const workspace = path.dirname(root);
const constants = require("../../src/shared/domain/commerce-constants");
const reverse = require("../../src/shared/domain/reverse-return-tracking");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
function objectLiteral(file, name) {
  const match = source(file).match(
    new RegExp(`const ${name} = (\\{[\\s\\S]*?\\n\\});`),
  );
  if (!match) throw new Error(`Cannot extract ${name} from ${file}`);
  return vm.runInNewContext(`(${match[1]})`);
}
const graph = objectLiteral(
  "src/modules/returns/services/return.service.js",
  "VALID_TRANSITIONS",
);
const flows = objectLiteral("src/shared/domain/status-transition.js", "FLOWS");
const forward = objectLiteral(
  "src/modules/delivery/services/delivery.service.js",
  "SHIPMENT_TRANSITIONS",
);
const model = source("src/modules/returns/models/return.model.js");
const states = [
  ...model
    .match(/status: \{\s*type: String,\s*enum: \[([\s\S]*?)\]/)[1]
    .matchAll(/"([^"]+)"/g),
].map((match) => match[1]);
const stub = new Proxy({}, { get: () => class Stub {} });
function load(file, overrides = {}) {
  const filename = path.join(root, file);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const mockedRequire = (name) =>
    Object.hasOwn(overrides, name)
      ? overrides[name]
      : name.includes("/shared/domain/") ||
          name.includes("/shared/errors/") ||
          name.endsWith("/delivery.model")
        ? localRequire(name)
        : stub;
  vm.runInNewContext(`(function(require,module,exports){${source(file)}\n})`, {
    Date,
  })(mockedRequire, module, module.exports);
  return module.exports;
}
const { ReturnServiceClass } = load(
  "src/modules/returns/services/return.service.js",
);
function document(status, extra = {}) {
  return {
    _id: "return-a",
    orderId: "order-a",
    status,
    items: [{ sellerId: "seller-a", organizationId: "org-a" }],
    replacement: {},
    timeline: [],
    ...extra,
    async save() {},
    toObject() {
      return { ...this };
    },
  };
}
function service(doc) {
  const svc = Object.create(ReturnServiceClass.prototype);
  svc.getReturnOrThrow = async () => doc;
  svc.deliveryRepository = {
    findShipmentById: async () => ({ id: "replacement-shipment", status: "initiated" }),
    createShipment: async () => ({
      id: "replacement-shipment",
      status: "initiated",
    }),
  };
  svc.appendTimeline = () => {};
  svc.publishReturnStatusUpdated = async () => {};
  return svc;
}
function uiActions() {
  const adminRequire = createRequire(
    path.join(workspace, "Admin/package.json"),
  );
  const babel = adminRequire("@babel/core");
  const jsx = adminRequire("@babel/plugin-transform-react-jsx");
  const text = fs.readFileSync(
    path.join(workspace, "Admin/src/pages/OrdersManagement/Returns/Returns.js"),
    "utf8",
  );
  const start = text.indexOf("rowActions={(row) => {");
  const end = text.indexOf("return actions;", start);
  if (start < 0 || end < 0) throw new Error("Cannot find Returns row actions");
  const body =
    text.slice(start + "rowActions={(row) => {".length, end) +
    "return actions;";
  const code = babel.transformSync(
    `function readActions(row,isSeller){${body}}; readActions;`,
    { configFile: false, babelrc: false, plugins: [jsx] },
  ).code;
  const context = {
    React: { createElement: () => null },
    openDetail: () => {},
    openAction: () => {},
    reverseTrackingOptions: () => [],
  };
  for (const [tag] of body.matchAll(/Md\w+/g)) context[tag] = () => null;
  const readActions = vm.runInNewContext(code, context);
  return (row, seller = false) =>
    readActions(row, seller).map((action) => action.label);
}
const checks = [];
async function check(category, name, expected, run) {
  let actual;
  try {
    actual = await run();
  } catch (error) {
    actual = `error: ${error.message}`;
  }
  checks.push({
    category,
    name,
    expected,
    actual,
    passed: JSON.stringify(actual) === JSON.stringify(expected),
  });
}
const accepts = async (run) => {
  try {
    await run();
    return true;
  } catch {
    return false;
  }
};
async function main() {
  const labels = uiActions();
  const admin = { userId: "admin-a", role: "admin" };
  const method = Object.create(ReturnServiceClass.prototype);
  await check(
    "inventory integrity",
    "every modeled return state has an explicit service graph or terminal classification",
    true,
    () =>
      states.every(
        (state) => Object.hasOwn(graph, state) || state === "closed",
      ),
  );
  await check(
    "inventory integrity",
    "every return transition target exists in the model",
    true,
    () =>
      Object.values(graph)
        .flat()
        .every((state) => states.includes(state)),
  );
  await check(
    "inventory integrity",
    "every order enum has a graph entry",
    true,
    () =>
      Object.values(constants.ORDER_STATUS).every((state) =>
        Object.hasOwn(flows.order, state),
      ),
  );
  const { DeliveryService } = load(
    "src/modules/delivery/services/delivery.service.js",
  );
  const delivery = Object.create(DeliveryService.prototype);
  for (const from of Object.keys(forward))
    for (const to of Object.keys(forward)) {
      await check(
        "forward shipment structural graph",
        `${from} -> ${to}`,
        from === to || forward[from].includes(to),
        () =>
          accepts(() =>
            delivery.assertTrackingTransition(from, to, {
              note: "Audit reason",
            }),
          ),
      );
    }
  for (const from of states)
    for (const to of states) {
      await check(
        "return structural graph (not endpoint validation)",
        `${from} -> ${to}`,
        from === to || (graph[from] || []).includes(to),
        () => accepts(() => method.validateTransition(from, to)),
      );
    }
  const oracle = {
    initiated: "reverse_pickup_scheduled",
    manifested: "reverse_pickup_scheduled",
    pickup_scheduled: "reverse_pickup_scheduled",
    failed: "pickup_failed",
    pickup_failed: "pickup_failed",
    picked_up: "in_reverse_transit",
    in_transit: "in_reverse_transit",
    out_for_delivery: "in_reverse_transit",
    delivered: "received",
    received: "received",
  };
  const logistics = [
    "approved",
    "reverse_pickup_scheduled",
    "pickup_failed",
    "manual_ship_back",
    "shipped_back",
    "in_reverse_transit",
  ];
  for (const state of states)
    for (const [tracking, target] of Object.entries(oracle)) {
      const request = {
        _id: "return-a",
        orderId: "order-a",
        status: state,
        reverseShipment: { shipmentId: "reverse-a" },
      };
      const shipment = {
        id: "reverse-a",
        return_id: "return-a",
        order_id: "order-a",
        direction: "reverse",
        status: tracking,
      };
      const expected =
        !logistics.includes(state) ||
        (target === "reverse_pickup_scheduled" &&
          ["shipped_back", "in_reverse_transit"].includes(state))
          ? state
          : target;
      await check(
        "return vs reverse shipment projection",
        `${state} + ${tracking}`,
        expected,
        () => reverse.projectReverseReturn(request, shipment).status,
      );
    }
  const ownerActors = [
    [{ role: "admin", userId: "admin-a" }, true, true],
    [
      { role: "seller", userId: "seller-a", organizationId: "org-a" },
      true,
      true,
    ],
    [
      { role: "seller", userId: "seller-a", organizationId: "org-b" },
      false,
      false,
    ],
    [{ role: "seller", userId: "seller-b" }, false, false],
    [{ role: "buyer", userId: "buyer-a" }, true, false],
    [{ role: "buyer", userId: "buyer-b" }, false, false],
  ];
  for (const [actor, view, manage] of ownerActors) {
    const doc = document("requested", { buyerId: "buyer-a" });
    await check(
      "return ownership",
      `${actor.role}/${actor.userId}/${actor.organizationId || "-"} view`,
      view,
      () => accepts(() => method.assertCanView(doc, actor)),
    );
    await check(
      "return ownership",
      `${actor.role}/${actor.userId}/${actor.organizationId || "-"} manage`,
      manage,
      () => accepts(() => method.assertCanManage(doc, actor)),
    );
  }
  for (const [name, items, actor, expected] of [
    [
      "seller cannot manage a multi-seller claim",
      [{ sellerId: "seller-a" }, { sellerId: "seller-b" }],
      { role: "seller", userId: "seller-a" },
      false,
    ],
    [
      "store-scoped seller cannot manage a multi-store claim",
      [
        { sellerId: "seller-a", organizationId: "org-a" },
        { sellerId: "seller-a", organizationId: "org-b" },
      ],
      { role: "seller", userId: "seller-a", organizationId: "org-a" },
      false,
    ],
    [
      "assigned seller admin uses owning seller identity",
      [{ sellerId: "seller-a", organizationId: "org-a" }],
      {
        role: "seller-admin",
        userId: "staff-a",
        ownerSellerId: "seller-a",
        organizationId: "org-a",
      },
      true,
    ],
    [
      "admin may manage a multi-seller claim",
      [{ sellerId: "seller-a" }, { sellerId: "seller-b" }],
      admin,
      true,
    ],
  ])
    await check("return ownership", name, expected, () =>
      accepts(() =>
        method.assertCanManage(document("requested", { items }), actor),
      ),
    );
  for (const [name, doc, label, operation] of [
    [
      "pending refund must not offer Close Return",
      document("refund_pending", { refund: { status: "provider_pending" } }),
      "Close Return",
      "close",
    ],
    [
      "unresolved failed QC must not offer Close Return",
      document("qc_failed", { qcReview: { status: "admin_review" } }),
      "Close Return",
      "close",
    ],
    [
      "provider manual review must offer sync instead of Retry Refund",
      document("refund_failed", {
        refund: { status: "manual_review", providerRefundId: "rf-a" },
      }),
      "Retry Refund",
      "retry",
    ],
  ]) {
    const svc = service(doc);
    let permitted = true;
    try {
      if (operation === "close")
        await svc.closeReturn("return-a", { reason: "audit" }, admin);
      else await svc.retryRefund("return-a", admin);
    } catch (error) {
      if (
        !/refund processing is pending|Resolve the failed quality check|Sync the existing provider refund/.test(
          error.message,
        )
      )
        throw error;
      permitted = false;
    }
    await check("UI action vs backend guard", name, permitted, () =>
      labels(doc).includes(label),
    );
  }
  await check(
    "replacement UI",
    "replacement_pending exposes the supported approval action",
    true,
    () =>
      labels(document("replacement_pending")).includes("Approve Replacement"),
  );
  const replacement = document("replacement_created", {
    replacementOrderId: "replacement-order",
  });
  const svc = service(replacement);
  await svc.createReplacement(
    "return-a",
    { action: "ship", courierName: "Courier", trackingNumber: "AWB-1" },
    admin,
  );
  await check(
    "replacement shipment parity",
    "creating an initiated replacement package must not claim courier handover",
    false,
    () => replacement.status === "replacement_shipped",
  );
  const beforeDelivery = document("replacement_shipped", {
    replacementShipmentId: "replacement-shipment",
  });
  await check(
    "replacement shipment parity",
    "manual replacement delivery must verify or synchronize delivered package evidence",
    false,
    () =>
      accepts(() =>
        service(beforeDelivery).createReplacement(
          "return-a",
          { action: "deliver" },
          admin,
        ),
      ),
  );

  const summary = {
    total: checks.length,
    passed: checks.filter((item) => item.passed).length,
    failed: checks.filter((item) => !item.passed).length,
  };
  const inventory = {
    orderStates: Object.values(constants.ORDER_STATUS),
    paymentStates: Object.values(constants.PAYMENT_STATUS),
    paymentProviders: Object.values(constants.PAYMENT_PROVIDER),
    returnStates: states,
    orderTransitions: flows.order,
    returnTransitions: graph,
    forwardShipmentTransitions: forward,
  };
  const output = {
    summary,
    inventory,
    failures: checks.filter((item) => !item.passed),
    checks,
  };
  const target = path.join(workspace, "docs/testing");
  fs.writeFileSync(
    path.join(target, "order-flow-usecase-results.json"),
    JSON.stringify(output, null, 2) + "\n",
  );
  const table = (values) =>
    [
      "| State | Structural next states |",
      "| --- | --- |",
      ...Object.entries(values).map(
        ([state, next]) => `| ${state} | ${next.join(", ") || "None"} |`,
      ),
    ].join("\n");
  const report = `# Executable order-flow audit\n\n${summary.total} assertions: **${summary.passed} passed, ${summary.failed} failed**. Failures below are outstanding findings, not fixed behavior. Isolated fixtures; no database, HTTP middleware, provider or browser end-to-end validation.\n\nForward tracking checks cover every pair of declared forward package states with an exception reason supplied. The structural graph matrix covers every pair of the ${states.length} model return states. Structural permission alone is not endpoint permission. Projection checks cover each return state crossed with each reverse tracking state. Role checks execute the actual return ownership guards. UI checks compile and execute the actual Returns row-actions block against actual service guards. Replacement checks execute the real replacement service with an in-memory shipment adapter.\n\n## Reproduced findings\n\n| Category | Case | Expected | Actual |\n| --- | --- | --- | --- |\n${output.failures.map((item) => `| ${item.category} | ${item.name} | ${item.expected} | ${item.actual} |`).join("\n")}\n\n## Order graph\n\n${table(flows.order)}\n\n## Return service graph\n\n${table(graph)}\n\n## Forward shipment graph\n\n${table(forward)}\n\n## State inventories\n\n- Order: ${inventory.orderStates.join(", ")}.\n- Payment: ${inventory.paymentStates.join(", ")}.\n- Provider enum: ${inventory.paymentProviders.join(", ")}. Enum membership does not mean checkout or automated refunds support that provider.\n- Return: ${states.join(", ")}.\n\nRun from workspace root: \`node backend/scripts/qa/audit-order-flow-usecases.js\`. Exit 1 means an outstanding invariant failed; exit 2 means the audit itself could not run. This regenerates this report and the JSON results.\n`;
  fs.writeFileSync(path.join(target, "ORDER_FLOW_EXECUTABLE_AUDIT.md"), report);
  console.log(
    JSON.stringify({ ...summary, failures: output.failures }, null, 2),
  );
  process.exitCode = summary.failed ? 1 : 0;
}
main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 2;
});
