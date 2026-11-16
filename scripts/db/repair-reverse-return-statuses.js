// Preview by default; --apply persists existing SQL/Mongo return-logistics drift.
const {
  connectMongo,
  mongoose,
} = require("../../src/infrastructure/mongo/mongo-client");
const {
  knex,
  postgresPool,
} = require("../../src/infrastructure/postgres/postgres-client");
const {
  ReturnModel,
} = require("../../src/modules/returns/models/return.model");
const {
  LOGISTICS_STATES,
  projectReverseReturn,
} = require("../../src/shared/domain/reverse-return-tracking");
async function main() {
  await connectMongo();
  const apply = process.argv.includes("--apply");
  const summary = {
    apply,
    inspected: 0,
    mismatched: 0,
    updated: 0,
    conflicted: 0,
  };
  const cursor = ReturnModel.find({
    status: { $in: LOGISTICS_STATES },
    "reverseShipment.shipmentId": { $exists: true, $ne: "" },
  })
    .lean()
    .cursor();
  for await (const request of cursor) {
    summary.inspected++;
    const shipment = await knex("shipments")
      .where("id", request.reverseShipment.shipmentId)
      .first();
    const projected = projectReverseReturn(request, shipment);
    if (
      request.status === projected.status &&
      request.reverseShipment.status === projected.reverseShipment.status
    )
      continue;
    summary.mismatched++;
    console.log(
      JSON.stringify({
        returnId: String(request._id),
        from: request.status,
        to: projected.status,
        shipmentStatus: shipment?.status,
      }),
    );
    if (!apply) continue;
    const result = await ReturnModel.updateOne(
      {
        _id: request._id,
        status: request.status,
        updatedAt: request.updatedAt,
        "reverseShipment.shipmentId": request.reverseShipment.shipmentId,
      },
      {
        $set: {
          status: projected.status,
          reverseShipment: projected.reverseShipment,
          items: projected.items,
          ...(projected.receivedAt ? { receivedAt: projected.receivedAt } : {}),
        },
        $push: {
          timeline: {
            status: projected.status,
            actorRole: "system",
            note: "Reconciled existing reverse shipment tracking",
            metadata: {
              shipmentId: shipment.id,
              shipmentStatus: shipment.status,
            },
            at: new Date(),
          },
        },
      },
    );
    if (result.modifiedCount) summary.updated++;
    else summary.conflicted++;
  }
  console.log(JSON.stringify(summary));
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([
      mongoose.disconnect(),
      knex.destroy(),
      postgresPool.end(),
    ]);
  });
