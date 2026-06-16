export function createMetrics() {
  return {
    intentionsStarted: 0,
    intentionsSucceeded: 0,
    intentionsFailed: 0,
    planFailures: 0,
    blockedMoves: 0,
    pickups: 0,
    deliveries: 0
  };
}

export function logMetrics(metrics, beliefs) {
  const lastSensingAge = beliefs.lastParcelsSensingAt
    ? `${Math.round((Date.now() - beliefs.lastParcelsSensingAt) / 1000)}s`
    : "never";

  console.log(
    "metrics",
    `score=${beliefs.me.score}`,
    `me=(${beliefs.me.x},${beliefs.me.y})`,
    `parcels=${beliefs.availableParcels().length}`,
    `carried=${beliefs.carriedParcels().length}`,
    `lastSeenParcels=${beliefs.lastPerceivedParcelsCount}`,
    `lastParcelEvent=${lastSensingAge}`,
    `agents=${beliefs.visibleAgents().length}`,
    `deliveries=${beliefs.deliveryTiles.length}`,
    `intentions=${metrics.intentionsSucceeded}/${metrics.intentionsStarted}`,
    `failedIntentions=${metrics.intentionsFailed}`,
    `pickups=${metrics.pickups}`,
    `putdowns=${metrics.deliveries}`,
    `planFailures=${metrics.planFailures}`,
    `blockedMoves=${metrics.blockedMoves}`
  );
}
