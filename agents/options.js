import { nearestDeliveryTile, shortestPath } from "./pathfinding.js";
import { distance } from "./utils.js";

const MAX_CARRIED_BEFORE_DELIVERY = 3;
const ENEMY_RISK_RADIUS = 4;
const ENEMY_RISK_WEIGHT = 3;
const EXPLORE_CANDIDATE_LIMIT = 8;

function enemyRisk(beliefs, target) {
  return beliefs.visibleAgents().reduce((risk, agent) => {
    const d = distance(agent, target);
    if (d > ENEMY_RISK_RADIUS) return risk;
    return risk + (ENEMY_RISK_RADIUS - d + 1) * ENEMY_RISK_WEIGHT;
  }, 0);
}

function pickupOptions(beliefs, carriedCount) {
  const me = beliefs.me;

  return beliefs.availableParcels()
    .map((parcel) => {
      const pathToParcel = shortestPath(beliefs, me, parcel, { avoidAgents: true });
      const delivery = nearestDeliveryTile(beliefs, parcel);
      if (!pathToParcel || !delivery) return null;

      const expectedReward = beliefs.expectedReward(parcel);
      const travelCost = pathToParcel.length + delivery.path.length;
      const risk = enemyRisk(beliefs, parcel);
      const carryingPenalty = carriedCount * Math.ceil(pathToParcel.length / 2);

      return {
        predicate: ["go_pick_up", parcel.x, parcel.y, parcel.id],
        utility: expectedReward - travelCost - risk - carryingPenalty,
        reward: expectedReward,
        distance: pathToParcel.length,
        reason: `pickup ${parcel.id}`
      };
    })
    .filter(Boolean);
}

function explorationOption(beliefs) {
  const targets = beliefs.spawnTiles.length
    ? beliefs.spawnTiles
    : [...beliefs.tiles.values()].filter((tile) => tile.walkable && !tile.delivery);

  if (!targets.length) return null;

  const rankedTargets = targets
    .map((tile, index) => ({ tile, index, path: shortestPath(beliefs, beliefs.me, tile, { avoidAgents: true }) }))
    .filter((candidate) => candidate.path && candidate.path.length > 1)
    .sort((a, b) => a.path.length - b.path.length)
    .slice(0, EXPLORE_CANDIDATE_LIMIT)
    .sort((a, b) => {
      const exploredA = beliefs.wasRecentlyExplored(a.tile) ? 1 : 0;
      const exploredB = beliefs.wasRecentlyExplored(b.tile) ? 1 : 0;
      return exploredA - exploredB || a.path.length - b.path.length;
    });

  const selected = rankedTargets.at(0);
  if (!selected) return null;

  return {
    predicate: ["go_explore", selected.tile.x, selected.tile.y],
    utility: -100 - selected.path.length,
    reward: 0,
    distance: selected.path.length,
    reason: `explore ${selected.tile.x},${selected.tile.y}`
  };
}

export function generateOptions(beliefs) {
  const me = beliefs.me;
  if (!me.id || !beliefs.tiles.size) return [];

  const carried = beliefs.carriedParcels();
  const options = [];

  if (carried.length > 0) {
    const target = nearestDeliveryTile(beliefs, me);
    const carriedReward = carried.reduce((sum, parcel) => sum + beliefs.expectedReward(parcel), 0);

    if (target) {
      options.push({
        predicate: ["go_deliver", target.tile.x, target.tile.y],
        utility: 1000 + carriedReward - target.path.length,
        reward: carriedReward,
        distance: target.path.length,
        reason: "deliver carried parcels"
      });
    }

    if (carried.length < MAX_CARRIED_BEFORE_DELIVERY) {
      options.push(...pickupOptions(beliefs, carried.length).filter((option) => option.utility > 0));
    }

    return options.sort((a, b) => b.utility - a.utility || b.reward - a.reward || a.distance - b.distance);
  }

  const pickup = pickupOptions(beliefs, 0)
    .sort((a, b) => b.utility - a.utility || b.reward - a.reward || a.distance - b.distance);

  if (pickup.length > 0) return pickup;

  const explore = explorationOption(beliefs);
  return explore ? [explore] : [];
}
