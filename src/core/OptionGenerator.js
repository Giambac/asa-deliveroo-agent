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
 *  - explore              search for parcels          {}
 *  - wait                 idle one beat               {}
 *
 * Generation is infrastructure (what is *possible*); ranking is strategy
 * (what is *preferable*). Keep filters here purely about validity.
 */
export class OptionGenerator {
  /**
   * @param {import('./BeliefBase.js').BeliefBase} beliefs
   * @returns {object[]} candidate options
   */
  generate(beliefs) {
    const options = [];

    for (const parcel of beliefs.parcels.values()) {
      if (parcel.carriedBy) continue;
      if (beliefs.projectedReward(parcel) <= 0) continue;
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

    // Always available fallbacks.
    options.push({ type: 'explore', key: 'explore' });
    options.push({ type: 'wait', key: 'wait' });

    return options;
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
      case 'go_to_mission_target':
        return beliefs.mission.active != null;
      default:
        return true; // explore / wait never become invalid
    }
  }
}
