import { key } from "./utils.js";

const PARCEL_MEMORY_MS = 8000;
const AGENT_MEMORY_MS = 1500;
const BLOCKED_EDGE_MS = 2000;
const EXPLORED_TILE_MEMORY_MS = 30000;

export class Beliefs {
  me = { id: "", name: "", x: -1, y: -1, score: 0 };
  tiles = new Map();
  deliveryTiles = [];
  spawnTiles = [];
  parcels = new Map();
  agents = new Map();
  blockedEdges = new Map();
  exploredTiles = new Map();
  lastParcelsSensingAt = null;
  lastPerceivedParcelsCount = 0;

  updateMe(me) {
    this.me = {
      ...this.me,
      ...me,
      x: Number.isFinite(me.x) ? Math.round(me.x) : this.me.x,
      y: Number.isFinite(me.y) ? Math.round(me.y) : this.me.y
    };
  }

  updateMap(width, height, tiles) {
    this.tiles.clear();
    this.deliveryTiles = [];
    this.spawnTiles = [];
    const typeCounts = new Map();

    for (const tile of tiles) {
      const type = String(tile.type ?? (tile.delivery ? "2" : "3"));
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);

      const normalized = {
        x: Math.round(tile.x),
        y: Math.round(tile.y),
        type,
        delivery: Boolean(tile.delivery || type === "2"),
        spawner: type === "1",
        walkable: type !== "0"
      };

      this.tiles.set(key(normalized.x, normalized.y), normalized);
      if (normalized.delivery) this.deliveryTiles.push(normalized);
      if (normalized.spawner) this.spawnTiles.push(normalized);
    }

    const walkableTiles = [...this.tiles.values()].filter((tile) => tile.walkable).length;
    console.log(
      `map loaded: ${walkableTiles} walkable tiles, ${this.deliveryTiles.length} delivery tiles, ${this.spawnTiles.length} spawner tiles`
    );
    console.log(
      "tile types:",
      [...typeCounts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([type, count]) => `${type}:${count}`)
        .join(" ")
    );
  }

  updateParcels(perceivedParcels) {
    const seen = new Set();
    const now = Date.now();
    this.lastParcelsSensingAt = now;
    this.lastPerceivedParcelsCount = perceivedParcels.length;

    for (const parcel of perceivedParcels) {
      if (parcel.carriedBy && parcel.carriedBy !== this.me.id) continue;

      seen.add(parcel.id);
      this.parcels.set(parcel.id, {
        id: parcel.id,
        x: Math.round(parcel.x),
        y: Math.round(parcel.y),
        reward: parcel.reward,
        carriedBy: parcel.carriedBy,
        lastSeen: now
      });
    }

    for (const [id, parcel] of this.parcels) {
      const isMine = parcel.carriedBy === this.me.id;
      const expired = now - parcel.lastSeen > PARCEL_MEMORY_MS;
      if (!seen.has(id) && !isMine && expired) this.parcels.delete(id);
    }
  }

  updateAgents(perceivedAgents) {
    const now = Date.now();

    for (const agent of perceivedAgents) {
      if (agent.id === this.me.id) continue;
      this.agents.set(agent.id, {
        ...agent,
        x: Math.round(agent.x),
        y: Math.round(agent.y),
        lastSeen: now
      });
    }

    for (const [id, agent] of this.agents) {
      if (now - agent.lastSeen > AGENT_MEMORY_MS) this.agents.delete(id);
    }
  }

  markPickedUp(pickedParcels) {
    for (const parcel of pickedParcels || []) {
      const stored = this.parcels.get(parcel.id);
      this.parcels.set(parcel.id, {
        id: parcel.id,
        x: Math.round(parcel.x ?? stored?.x ?? this.me.x),
        y: Math.round(parcel.y ?? stored?.y ?? this.me.y),
        reward: parcel.reward ?? stored?.reward ?? 0,
        carriedBy: this.me.id,
        lastSeen: Date.now()
      });
    }
  }

  hasParcelAt(x, y) {
    return this.availableParcels().some((parcel) => parcel.x === Math.round(x) && parcel.y === Math.round(y));
  }

  markDelivered(deliveredParcels) {
    for (const parcel of deliveredParcels || []) this.parcels.delete(parcel.id);
  }

  markBlocked(from, to) {
    this.blockedEdges.set(`${key(from.x, from.y)}->${key(to.x, to.y)}`, Date.now() + BLOCKED_EDGE_MS);
  }

  markExplored(tile) {
    this.exploredTiles.set(key(tile.x, tile.y), Date.now() + EXPLORED_TILE_MEMORY_MS);
  }

  wasRecentlyExplored(tile) {
    const exploredUntil = this.exploredTiles.get(key(tile.x, tile.y));
    if (!exploredUntil) return false;
    if (Date.now() <= exploredUntil) return true;

    this.exploredTiles.delete(key(tile.x, tile.y));
    return false;
  }

  isBlocked(from, to) {
    const blockedUntil = this.blockedEdges.get(`${key(from.x, from.y)}->${key(to.x, to.y)}`);
    if (!blockedUntil) return false;
    if (Date.now() <= blockedUntil) return true;

    this.blockedEdges.delete(`${key(from.x, from.y)}->${key(to.x, to.y)}`);
    return false;
  }

  carriedParcels() {
    return [...this.parcels.values()].filter((parcel) => parcel.carriedBy === this.me.id);
  }

  availableParcels() {
    return [...this.parcels.values()].filter((parcel) => !parcel.carriedBy);
  }

  visibleAgents() {
    return [...this.agents.values()];
  }

  occupiedTileKeys() {
    return new Set(this.visibleAgents().map((agent) => key(agent.x, agent.y)));
  }

  expectedReward(parcel) {
    const ageSeconds = Math.max(0, (Date.now() - parcel.lastSeen) / 1000);
    return Math.max(0, parcel.reward - ageSeconds);
  }

  tileAt(x, y) {
    const tile = this.tiles.get(key(x, y));
    return tile?.walkable ? tile : undefined;
  }
}
