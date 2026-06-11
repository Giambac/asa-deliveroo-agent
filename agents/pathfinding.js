import { key } from "./utils.js";

const DIRECTIONS = [
  { name: "right", dx: 1, dy: 0 },
  { name: "left", dx: -1, dy: 0 },
  { name: "up", dx: 0, dy: 1 },
  { name: "down", dx: 0, dy: -1 }
];

const ARROW_DIRECTIONS = new Map([
  ["→", "right"],
  ["←", "left"],
  ["↑", "up"],
  ["↓", "down"]
]);

const OPPOSITE_DIRECTIONS = new Map([
  ["right", "left"],
  ["left", "right"],
  ["up", "down"],
  ["down", "up"]
]);

export function legalMovesFrom(beliefs, from, options = {}) {
  const fromTile = beliefs.tileAt(from.x, from.y);
  if (!fromTile) return [];

  const forcedDirection = ARROW_DIRECTIONS.get(fromTile.type);
  const occupied = options.avoidAgents ? beliefs.occupiedTileKeys() : new Set();

  return DIRECTIONS.filter((direction) => !forcedDirection || direction.name === forcedDirection)
    .map((direction) => ({
      ...direction,
      target: { x: from.x + direction.dx, y: from.y + direction.dy }
    }))
    .filter((move) => {
      const targetTile = beliefs.tileAt(move.target.x, move.target.y);
      if (!targetTile) return false;
      if (options.goalKey && key(move.target.x, move.target.y) !== options.goalKey && occupied.has(key(move.target.x, move.target.y))) {
        return false;
      }
      if (beliefs.isBlocked(from, move.target)) return false;

      const targetArrowDirection = ARROW_DIRECTIONS.get(targetTile.type);
      if (targetArrowDirection && OPPOSITE_DIRECTIONS.get(move.name) === targetArrowDirection) return false;

      return true;
    });
}

export function shortestPath(beliefs, start, goal, options = {}) {
  const startKey = key(start.x, start.y);
  const goalKey = key(goal.x, goal.y);
  const queue = [startKey];
  const previous = new Map([[startKey, null]]);

  while (queue.length > 0) {
    const currentKey = queue.shift();
    if (currentKey === goalKey) break;

    const [x, y] = currentKey.split(",").map(Number);
    const moves = legalMovesFrom(beliefs, { x, y }, { ...options, goalKey });

    for (const { target: neighbor } of moves) {
      const neighborKey = key(neighbor.x, neighbor.y);
      if (previous.has(neighborKey)) continue;

      previous.set(neighborKey, currentKey);
      queue.push(neighborKey);
    }
  }

  if (!previous.has(goalKey)) return null;

  const path = [];
  for (let cursor = goalKey; cursor; cursor = previous.get(cursor)) {
    const [x, y] = cursor.split(",").map(Number);
    path.unshift({ x, y });
  }

  return path;
}

export function directionBetween(from, to) {
  if (to.x > from.x) return "right";
  if (to.x < from.x) return "left";
  if (to.y > from.y) return "up";
  if (to.y < from.y) return "down";
  return null;
}

export function nearestDeliveryTile(beliefs, from) {
  return beliefs.deliveryTiles
    .map((tile) => ({ tile, path: shortestPath(beliefs, from, tile, { avoidAgents: true }) }))
    .filter((candidate) => candidate.path)
    .sort((a, b) => a.path.length - b.path.length)
    .at(0);
}
