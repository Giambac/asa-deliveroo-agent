import { keyOf } from '../utils/serialization.js';
import { DIRECTIONS } from '../planning/GridGraph.js';

/**
 * Generates candidate options (desires) from current beliefs.
 *
 * An option is a plain object:
 *   { type, key, ...args, utility }
 * `key` identifies the option for intention comparison (hysteresis),
 * `utility` is filled in later by the selected strategy.
 *
 * Option types:
 *  - go_pick_up           target a free parcel        {parcelId, x, y}
 *  - deliver_carried      bring carried parcels home  {}
 *  - go_to_mission_target serve the active mission    {mission}
 *  - push_crate           shove a blocking crate away {crateId, x, y, pushDir, approachTile, unblockValue}
 *  - explore              search for parcels          {}
 *  - wait                 idle one beat               {}
 *
 * Generation is infrastructure (what is *possible*); ranking is strategy
 * (what is *preferable*). Keep filters here purely about validity.
 */
export class OptionGenerator {
  /**
   * @param {object} [opts]
   * @param {object} [opts.crates] config.crates block; `enabled` gates the
   *   push_crate option (default on, so the existing arg-less callers keep
   *   crate awareness without any change).
   */
  constructor(opts = {}) {
    this.cratesEnabled = opts.crates?.enabled ?? true;
  }

  /**
   * @param {import('./BeliefBase.js').BeliefBase} beliefs
   * @returns {object[]} candidate options
   */
  generate(beliefs) {
    const options = [];

    // While handing over, the picker must not re-grab parcels it has
    // dropped at the rendezvous — those are reserved for the deliverer.
    const handover = beliefs.mission.handover;
    const rv = handover?.active && handover.role === 'picker' ? handover.rendezvous : null;

    for (const parcel of beliefs.parcels.values()) {
      if (parcel.carriedBy) continue;
      if (beliefs.projectedReward(parcel) <= 0) continue;
      if (rv && Math.round(parcel.x) === rv.x && Math.round(parcel.y) === rv.y) continue;
      // Skip parcels claimed by the teammate (team deconfliction).
      const claimant = beliefs.claims.get(parcel.id);
      if (claimant && claimant !== beliefs.me.id) continue;
      options.push({
        type: 'go_pick_up',
        key: `go_pick_up:${parcel.id}`,
        parcelId: parcel.id,
        x: Math.round(parcel.x),
        y: Math.round(parcel.y),
      });
    }

    if (beliefs.carried().length > 0) {
      options.push({ type: 'deliver_carried', key: 'deliver_carried' });
    }

    const mission = beliefs.mission.active;
    if (mission && (mission.targets?.length ?? 0) > 0) {
      options.push({
        type: 'go_to_mission_target',
        key: `go_to_mission_target:${mission.kind}`,
        mission,
      });
    }

    // Handover (26c2_8). `handover` is bound above.
    //  - picker: once carrying, bring the parcel to the rendezvous and drop it;
    //  - deliverer: once a drop is waiting (located by coordinates), go
    //    collect it (the normal deliver_carried then delivers it -> bonus).
    if (handover?.active && handover.role === 'picker' && handover.rendezvous && beliefs.carried().length > 0) {
      options.push({
        type: 'handover_deposit',
        key: 'handover_deposit',
        rendezvous: handover.rendezvous,
      });
    }
    if (
      handover?.active && handover.role === 'deliverer' && handover.parcel &&
      Number.isFinite(handover.parcel.x) && Number.isFinite(handover.parcel.y)
    ) {
      options.push({
        type: 'handover_collect',
        key: 'handover_collect',
        x: handover.parcel.x,
        y: handover.parcel.y,
      });
    }

    // Crate pushing: only when a valuable target is currently unreachable
    // *because of* a sensed crate that has a single legal push unblocking it.
    if (this.cratesEnabled && beliefs.graph && beliefs.crates.size > 0) {
      const pushOption = this.#generatePushCrate(beliefs);
      if (pushOption) options.push(pushOption);
    }

    // Always available fallbacks.
    options.push({ type: 'explore', key: 'explore' });
    options.push({ type: 'wait', key: 'wait' });

    return options;
  }

  /**
   * Conservative single-crate push generation. Emits at most one
   * `push_crate` option, and only when:
   *  - a desired target (a worthwhile free parcel, or — while carrying — a
   *    delivery tile) is currently unreachable;
   *  - some sensed crate has a *legal* push direction (the tile behind it is
   *    a type-5 pushable zone, in-bounds, crate-free; the approach tile is
   *    walkable, crate-free and reachable now);
   *  - simulating that single push makes a previously unreachable target
   *    reachable.
   * A target that needs ≥2 pushes never shows up reachable after one
   * simulated push, so no option is emitted — this prevents push loops.
   * @returns {object|null}
   */
  #generatePushCrate(beliefs) {
    const graph = beliefs.graph;
    const me = { x: Math.round(beliefs.me.x), y: Math.round(beliefs.me.y) };
    const reachable = this.#reachableFrom(graph, me);

    // Desired-but-unreachable target tiles (value attached for ranking).
    const carrying = beliefs.carried().length > 0;
    const targets = [];
    for (const parcel of beliefs.parcels.values()) {
      if (parcel.carriedBy) continue;
      const reward = beliefs.projectedReward(parcel);
      if (reward <= 0) continue;
      const px = Math.round(parcel.x);
      const py = Math.round(parcel.y);
      if (reachable.has(keyOf(px, py))) continue;
      targets.push({ x: px, y: py, value: reward });
    }
    if (carrying) {
      const carriedValue = beliefs
        .carried()
        .reduce((sum, p) => sum + Math.max(beliefs.projectedReward(p), 0), 0);
      for (const tile of graph.deliveryTiles) {
        if (reachable.has(keyOf(tile.x, tile.y))) continue;
        targets.push({ x: tile.x, y: tile.y, value: carriedValue });
      }
    }
    if (targets.length === 0) return null;

    for (const crate of beliefs.crates.values()) {
      const cx = Math.round(crate.x);
      const cy = Math.round(crate.y);
      for (const [dir, { dx, dy }] of Object.entries(DIRECTIONS)) {
        const beyond = { x: cx + dx, y: cy + dy };
        const approach = { x: cx - dx, y: cy - dy };
        // Legal push: destination is an empty pushable zone, approach is a
        // reachable crate-free walkable tile.
        if (!graph.isPushZone(beyond.x, beyond.y)) continue;
        if (graph.hasCrate(beyond.x, beyond.y)) continue;
        const approachTile = graph.tileAt(approach.x, approach.y);
        if (!approachTile || !approachTile.walkable) continue;
        if (graph.hasCrate(approach.x, approach.y)) continue;
        if (!reachable.has(keyOf(approach.x, approach.y))) continue;

        // Simulate the single push and see whether it unblocks a target.
        const unblocked = this.#simulatePush(beliefs, crate, { cx, cy }, beyond, targets);
        if (unblocked) {
          return {
            type: 'push_crate',
            key: `push_crate:${crate.id}`,
            crateId: crate.id,
            x: cx,
            y: cy,
            pushDir: dir,
            approachTile: { x: approach.x, y: approach.y },
            beyond,
            unblockValue: unblocked.value,
          };
        }
      }
    }
    return null;
  }

  /**
   * Move the crate in the graph (clear old tile, occupy `beyond`), recompute
   * reachability from the approach tile, and return the highest-value target
   * that became reachable — or null. The graph mutation is always reverted.
   */
  #simulatePush(beliefs, crate, { cx, cy }, beyond, targets) {
    const graph = beliefs.graph;
    graph.clearCrate(cx, cy);
    graph.setCrate(beyond.x, beyond.y, crate.id);
    try {
      // After the push the agent stands on the crate's old tile; reachability
      // from there is what matters for the unblocked target.
      const reachableAfter = this.#reachableFrom(graph, { x: cx, y: cy });
      let best = null;
      for (const target of targets) {
        if (!reachableAfter.has(keyOf(target.x, target.y))) continue;
        if (!best || target.value > best.value) best = target;
      }
      return best;
    } finally {
      graph.clearCrate(beyond.x, beyond.y);
      graph.setCrate(cx, cy, crate.id);
    }
  }

  /** BFS reachable-tile key set from a start tile over graph.neighbors. */
  #reachableFrom(graph, start) {
    const startKey = keyOf(start.x, start.y);
    const seen = new Set([startKey]);
    if (!graph.tileAt(start.x, start.y)) return seen;
    const queue = [start];
    let head = 0;
    while (head < queue.length) {
      const { x, y } = queue[head++];
      for (const edge of graph.neighbors(x, y, false)) {
        if (seen.has(edge.key)) continue;
        seen.add(edge.key);
        queue.push({ x: edge.x, y: edge.y });
      }
    }
    return seen;
  }

  /**
   * Validity check used by the intention revision loop to abandon
   * intentions that became impossible or worthless ("stop conditions":
   * achieved / impossible / no longer worthwhile).
   */
  static isStillValid(option, beliefs) {
    switch (option.type) {
      case 'go_pick_up': {
        const parcel = beliefs.parcels.get(option.parcelId);
        return !!parcel && !parcel.carriedBy && beliefs.projectedReward(parcel) > 0;
      }
      case 'deliver_carried':
        return beliefs.carried().length > 0;
      case 'handover_deposit':
      case 'handover_collect':
        // Valid for the lifetime of an active handover: the running plan is
        // atomic past its go_to, so carrying/drop state changing mid-plan
        // (e.g. carried -> 0 right after the deposit putdown) must not abort it.
        return !!beliefs.mission.handover?.active;
      case 'go_to_mission_target':
        return beliefs.mission.active != null;
      case 'push_crate': {
        // Stale once the crate is gone or no longer on the tile we planned
        // to push from (it was pushed / removed / re-sensed elsewhere).
        const crate = beliefs.crates.get(option.crateId);
        return !!crate && Math.round(crate.x) === option.x && Math.round(crate.y) === option.y;
      }
      default:
        return true; // explore / wait never become invalid
    }
  }
}
