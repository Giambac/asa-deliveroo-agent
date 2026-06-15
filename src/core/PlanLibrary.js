import { Intention } from './Intention.js';
import { sleep } from '../utils/sleep.js';
import { normalizeIdList } from '../utils/serialization.js';

/**
 * Plan library: maps intentions (options) to executable plans.
 *
 * Each plan class declares its applicability statically and implements
 * `execute(option)`. Plans are deterministic: they translate an option
 * into awaited, serialized game actions. Failures throw, the Intention
 * falls back to the next applicable plan, and ultimately the intention
 * revision loop re-deliberates — this is how failures are "reported to
 * the intention layer".
 */
export class PlanLibrary {
  #planClasses = [];

  register(PlanClass) {
    this.#planClasses.push(PlanClass);
  }

  /** Applicable plan classes for an option, in registration order. */
  plansFor(option, context) {
    return this.#planClasses.filter((P) => P.isApplicableTo(option, context));
  }
}

/** Shared base: stop propagation and sub-intention support. */
class PlanBase {
  #stopped = false;
  #subIntentions = [];

  constructor(context, parent) {
    this.context = context;
    this.parent = parent;
  }

  get stopped() {
    return this.#stopped;
  }

  stop() {
    this.#stopped = true;
    for (const sub of this.#subIntentions) sub.stop();
  }

  log(...args) {
    this.parent?.log?.(...args);
  }

  /** Throw if this plan (or its intention) was stopped. */
  assertRunning() {
    if (this.#stopped || this.parent?.stopped) throw { reason: 'stopped' };
  }

  /** Achieve a nested option (e.g. go_pick_up -> go_to) as a sub-intention. */
  async subIntention(option) {
    const sub = new Intention(option, this.context, this);
    this.#subIntentions.push(sub);
    return sub.achieve();
  }
}

// ---------------------------------------------------------------------------
// Movement plans (the deterministic core)
// ---------------------------------------------------------------------------

/**
 * Follow a BFS path step by step. Handles failed moves: a dynamic
 * blocker (another agent) gets a few retries and a path recompute;
 * persistent failure soft-blocks the tile and fails the plan, reporting
 * the failure up to the intention layer.
 */
export class FollowPathGoTo extends PlanBase {
  static isApplicableTo(option) {
    return option.type === 'go_to';
  }

  async execute(option) {
    const { beliefs, executor, pathPlanner, metrics, config } = this.context;
    const retries = config?.agent?.moveRetries ?? 2;
    const retryDelay = config?.agent?.moveRetryDelayMs ?? 200;
    const softBlockMs = config?.agent?.softBlockMs ?? 3000;

    const atTarget = () =>
      Math.round(beliefs.me.x) === option.x && Math.round(beliefs.me.y) === option.y;

    let consecutiveFailures = 0;

    while (!atTarget()) {
      this.assertRunning();

      const path = pathPlanner.shortestPath(
        { x: Math.round(beliefs.me.x), y: Math.round(beliefs.me.y) },
        { x: option.x, y: option.y },
      );
      if (!path) throw { reason: 'unreachable' };
      if (path.directions.length === 0) break;

      for (let i = 0; i < path.directions.length; i++) {
        this.assertRunning();
        const nextTile = path.tiles[i];
        if (nextTile && beliefs.graph && !beliefs.graph.isWalkable(nextTile.x, nextTile.y)) {
          metrics?.increment('failedMoves');
          throw { reason: 'path-invalidated' };
        }
        const result = await executor.move(path.directions[i]);

        if (result === false) {
          consecutiveFailures += 1;
          metrics?.increment('failedMoves');
          if (consecutiveFailures > retries) {
            // Probably a stationary agent: route around it for a while.
            const blockedTile = path.tiles[i];
            if (blockedTile) beliefs.graph?.softBlock(blockedTile.x, blockedTile.y, softBlockMs);
            throw { reason: 'path-blocked' };
          }
          await sleep(retryDelay);
          break; // recompute the path (the blocker may have moved)
        }

        consecutiveFailures = 0;
        // The move ack is the authoritative position update.
        beliefs.me.x = result.x;
        beliefs.me.y = result.y;
      }
    }
    return true;
  }
}

/**
 * Serve `go_to` with a PDDL plan from the online solver (meaningful PDDL
 * integration: same intention, planner-built means). Registered before
 * the BFS plan when PDDL is enabled; any failure (solver down, problem
 * too large, move blocked) falls back to FollowPathGoTo automatically.
 */
export class PddlGoTo extends PlanBase {
  static isApplicableTo(option, context) {
    return option.type === 'go_to' && !!context?.pddlPlanner?.isEnabled();
  }

  async execute(option) {
    const { beliefs, executor, pddlPlanner, metrics } = this.context;
    const directions = await pddlPlanner.planPath(
      { x: Math.round(beliefs.me.x), y: Math.round(beliefs.me.y) },
      { x: option.x, y: option.y },
    );
    for (const direction of directions) {
      this.assertRunning();
      const result = await executor.move(direction);
      if (result === false) {
        metrics?.increment('failedMoves');
        // No local repair here: fail so the BFS plan (which handles
        // dynamic obstacles) takes over.
        throw { reason: 'pddl-step-blocked' };
      }
      beliefs.me.x = result.x;
      beliefs.me.y = result.y;
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// Task plans
// ---------------------------------------------------------------------------

export class GoPickUp extends PlanBase {
  static isApplicableTo(option) {
    return option.type === 'go_pick_up';
  }

  async execute(option) {
    const { beliefs, executor, metrics, logger } = this.context;

    await this.subIntention({ type: 'go_to', key: `go_to:${option.x},${option.y}`, x: option.x, y: option.y });
    this.assertRunning();

    const picked = await executor.pickup();
    if (picked.length === 0) {
      // Race lost: the parcel expired or someone got there first.
      metrics?.increment('pickupsLost');
      beliefs.parcels.delete(option.parcelId);
      throw { reason: 'pickup-empty' };
    }
    // Ack shape varies across server versions; when no ids are usable,
    // fall back to "everything on my tile is now carried" (the actual
    // pickup semantics).
    const pickedIds = normalizeIdList(picked);
    if (pickedIds.length > 0) {
      for (const id of pickedIds) beliefs.markCarried(id);
    } else {
      beliefs.markTilePickedUp();
    }
    metrics?.increment('parcelsPickedUp', picked.length);
    logger?.log('pickup', { count: picked.length, ids: pickedIds });
    return true;
  }
}

export class DeliverCarried extends PlanBase {
  static isApplicableTo(option) {
    return option.type === 'deliver_carried';
  }

  async execute() {
    const { beliefs, executor, pathPlanner, metrics, logger } = this.context;

    const target = pathPlanner.nearestDelivery({
      x: Math.round(beliefs.me.x),
      y: Math.round(beliefs.me.y),
    });
    if (!target) throw { reason: 'no-delivery-reachable' };

    await this.subIntention({
      type: 'go_to',
      key: `go_to:${target.tile.x},${target.tile.y}`,
      x: target.tile.x,
      y: target.tile.y,
    });
    this.assertRunning();

    const carried = beliefs.carried();
    const { deliverExactly } = beliefs.mission;
    if (deliverExactly != null && carried.length < deliverExactly) {
      throw { reason: 'deliver-exactly-not-ready' };
    }

    const requestedIds = this.#selectParcelsForPutdown(beliefs);
    if (requestedIds === null) {
      throw { reason: 'deliver-threshold-not-ready' };
    }
    const dropped = await executor.putdown(requestedIds);
    if (dropped.length === 0) {
      // The server says we held nothing: the carry belief was wrong
      // (phantom parcels). Reconcile so we do not retry forever.
      beliefs.clearCarried();
      throw { reason: 'putdown-empty' };
    }

    // Prefer ack ids; fall back to what we asked to drop (or everything,
    // when the request was "drop all") — ack shapes vary across servers.
    const droppedIds = normalizeIdList(dropped);
    if (droppedIds.length > 0) beliefs.markDelivered(droppedIds);
    else if (requestedIds.length > 0) beliefs.markDelivered(requestedIds);
    else beliefs.clearCarried();
    metrics?.increment('parcelsDelivered', dropped.length);
    logger?.log('delivery', { count: dropped.length, ids: droppedIds });
    return true;
  }

  /**
   * Mission-aware putdown selection. Default: empty list = drop all.
   *  - deliver_exactly_n: drop exactly N (highest value first);
   *  - deliver_less_value_than: greedy lowest-value subset under the cap
   *    (null = no compliant subset yet, so do not put down).
   * TODO(strategy): tune subset choice (e.g. keep high-value parcels
   * carried for a later compliant delivery).
   */
  #selectParcelsForPutdown(beliefs) {
    const carried = beliefs.carried();
    const { deliverExactly, deliverMaxValue } = beliefs.mission;

    if (deliverExactly != null && carried.length > deliverExactly) {
      return carried
        .slice()
        .sort((a, b) => beliefs.projectedReward(b) - beliefs.projectedReward(a))
        .slice(0, deliverExactly)
        .map((p) => p.id);
    }

    if (deliverMaxValue != null) {
      const sorted = carried
        .slice()
        .sort((a, b) => beliefs.projectedReward(a) - beliefs.projectedReward(b));
      const selected = [];
      let total = 0;
      for (const parcel of sorted) {
        const value = Math.max(beliefs.projectedReward(parcel), 0);
        if (value > deliverMaxValue || total + value > deliverMaxValue) break;
        selected.push(parcel.id);
        total += value;
      }
      if (selected.length > 0) return selected;
      return null;
    }

    return []; // empty list = put down everything
  }
}

export class GoToMissionTarget extends PlanBase {
  static isApplicableTo(option) {
    return option.type === 'go_to_mission_target';
  }

  async execute(option) {
    const { beliefs, executor, pathPlanner, logger } = this.context;
    const mission = option.mission;
    if (!beliefs.mission.active) throw { reason: 'mission-gone' };

    // Choose the nearest of the mission's target coordinates.
    const me = { x: Math.round(beliefs.me.x), y: Math.round(beliefs.me.y) };
    let best = null;
    let bestLength = Infinity;
    for (const target of mission.targets) {
      const path = pathPlanner.shortestPath(me, target);
      if (path && path.directions.length < bestLength) {
        best = target;
        bestLength = path.directions.length;
      }
    }
    if (!best) throw { reason: 'mission-target-unreachable' };

    await this.subIntention({ type: 'go_to', key: `go_to:${best.x},${best.y}`, x: best.x, y: best.y });
    this.assertRunning();

    if (mission.kind === 'deliver_at') {
      // Give the mission observer a stable frame with agent + parcel on the
      // target tile before the parcel disappears through putdown.
      await sleep(500);
      this.assertRunning();
      const dropped = await executor.putdown();
      if (dropped.length === 0) {
        beliefs.clearCarried(); // carry belief contradicted — reconcile
        throw { reason: 'deliver-at-empty' };
      }
      const droppedIds = normalizeIdList(dropped);
      beliefs.markDropped(
        droppedIds.length > 0 ? droppedIds : beliefs.carried().map((p) => p.id),
      );
    }

    if (mission.kind === 'go_to' && mission.holdAtTarget) {
      // Team variant ("wait for each other"): hold position briefly so
      // the mission agent can observe both agents in place.
      // TODO(strategy): replace the fixed hold with an explicit
      // position/ack exchange with the teammate (26c2_10).
      await sleep(5000);
    }

    logger?.log('mission_target_reached', { kind: mission.kind, target: best });
    beliefs.completeMission();
    return true;
  }
}

export class Explore extends PlanBase {
  static isApplicableTo(option) {
    return option.type === 'explore';
  }

  /**
   * Visit the spawner tile seen least recently (never-seen tiles first).
   * Spawners are where parcels appear, so they maximize the information
   * gained per tile traveled.
   */
  async execute() {
    const { beliefs } = this.context;
    const candidates = (beliefs.graph?.spawnerTiles ?? [])
      .map((tile) => ({
        tile,
        lastSeen: beliefs.tileLastSeen.get(`${tile.x},${tile.y}`) ?? 0,
      }))
      .sort((a, b) => a.lastSeen - b.lastSeen)
      .slice(0, 3); // try the 3 stalest, in case some are unreachable

    for (const { tile } of candidates) {
      this.assertRunning();
      try {
        await this.subIntention({ type: 'go_to', key: `go_to:${tile.x},${tile.y}`, x: tile.x, y: tile.y });
        return true;
      } catch {
        // unreachable or blocked — try the next candidate
      }
    }
    throw { reason: 'no-explore-target' };
  }
}

export class Wait extends PlanBase {
  static isApplicableTo(option) {
    return option.type === 'wait';
  }

  async execute() {
    await sleep(this.context.config?.agent?.waitMs ?? 300);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Default library assembly
// ---------------------------------------------------------------------------

/**
 * Build the default plan library. Order matters: for `go_to`, the PDDL
 * plan (when enabled) is tried before the BFS plan, which acts as the
 * deterministic fallback.
 */
export function buildDefaultPlanLibrary() {
  const library = new PlanLibrary();
  library.register(GoPickUp);
  library.register(DeliverCarried);
  library.register(GoToMissionTarget);
  library.register(Explore);
  library.register(Wait);
  library.register(PddlGoTo); // applicability self-checks pddl enablement
  library.register(FollowPathGoTo);
  return library;
}
