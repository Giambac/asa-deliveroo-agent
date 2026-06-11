import { RewardDistanceStrategy } from './RewardDistanceStrategy.js';

/**
 * Challenge 2 strategy: reward/distance farming that defers to mission
 * state in the BeliefBase (written by the LLM interpreter or received
 * from the teammate).
 *
 * Mission handling:
 *  - go_to / deliver_at goals: utility = mission bonus minus travel cost
 *    (inherited from StrategyBase, re-weighted here) — bonuses dominate
 *    parcel income, so missions win whenever they are feasible;
 *  - forbidden tiles / forbidden deliveries: already enforced by the
 *    graph (BeliefBase.setMission blocks them), nothing to do here;
 *  - deliver_exactly_n: deliver as soon as enough parcels are carried
 *    (selective putdown is done by the DeliverCarried plan);
 *  - deliver_less_value_than: prefer delivering small batches quickly;
 *  - red light: enforced by the ActionExecutor movement gate.
 *
 * TODO(strategy): one_pickup_another_deliver choreography — pick up,
 * negotiate a rendezvous with the teammate, drop, let them deliver.
 */
export class MissionAwareStrategy extends RewardDistanceStrategy {
  static id = 'mission-aware';

  constructor(options = {}) {
    super(options);
    // Multiplier on mission bonus when ranking mission goals against
    // regular farming (>1 = even more mission-eager).
    this.missionWeight = options.missionWeight ?? 1;
  }

  utility(option, beliefs, helpers) {
    switch (option.type) {
      case 'go_to_mission_target': {
        const base = super.utility(option, beliefs, helpers); // StrategyBase case
        if (!Number.isFinite(base)) return base;
        return base * this.missionWeight;
      }
      case 'deliver_carried': {
        const base = super.utility(option, beliefs, helpers);
        if (!Number.isFinite(base)) return base;
        const carried = beliefs.carried();
        const { deliverExactly, deliverMaxValue } = beliefs.mission;

        // Each compliant delivery earns a repeatable bonus: deliver as
        // soon as the policy can be satisfied.
        if (deliverExactly != null && carried.length >= deliverExactly) {
          return base + MissionAwareStrategy.COMPLIANT_DELIVERY_BOOST;
        }
        if (deliverMaxValue != null && carried.length > 0) {
          const cheapest = Math.min(
            ...carried.map((p) => Math.max(beliefs.projectedReward(p), 0)),
          );
          if (cheapest <= deliverMaxValue) {
            return base + MissionAwareStrategy.COMPLIANT_DELIVERY_BOOST;
          }
        }
        return base;
      }
      default:
        return super.utility(option, beliefs, helpers);
    }
  }

  static COMPLIANT_DELIVERY_BOOST = 200;
}
