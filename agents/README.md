# Deliveroo BDI Agent

This folder contains a first complete autonomous Deliveroo agent. The code is split into modules so the BDI parts required by the project/labs are visible.

## Structure

```text
agent/
  index.js                  bootstrap and server event wiring
  beliefs.js                belief revision
  options.js                option generation and filtering
  intention.js              intention deliberation over the plan library
  intentionRevision.js      replace-style intention revision
  metrics.js                simple runtime counters for presentation
  pathfinding.js            BFS movement planning
  utils.js                  small shared helpers
  plans/
    Plan.js                 base plan with stoppable sub-intentions
    GoPickUp.js             go_to + pickup
    GoDeliver.js            go_to + putdown
    GoExplore.js            patrol spawner tiles when no parcel is visible
    MoveByShortestPath.js   map-aware movement plan
    GreedyFallbackMove.js   fallback movement when shortest-path plan fails
```

## How to Run

From `ASA-project1`:

```bash
npm run agent -- -host=http://localhost:8080 -name=your-name
```

or, if you already have a token:

```bash
npm run agent -- -host=http://localhost:8080 -token=your-token
```

The code also accepts environment variables:

```bash
DELIVEROO_HOST=http://localhost:8080 DELIVEROO_TOKEN=your-token node agent/index.js
```

## What It Implements

The agent follows the BDI structure from the labs:

- Beliefs: current agent position, map tiles, delivery tiles, and perceived parcels.
- Desires/options: pick an available parcel or deliver carried parcels.
- Intention revision: revise the current intention when a better option appears.
- Plan library: `GoPickUp`, `GoDeliver`, `GoExplore`, `MoveByShortestPath`, and `GreedyFallbackMove`.
- Applicability check: each plan has `static isApplicableTo(...)`.
- Failed-plan fallback: `Intention.achieve()` tries the next applicable plan if one fails.
- Subplans: pickup and delivery use the `go_to` sub-intention before acting.
- Stoppable plans: intention replacement calls `stop()` on the current intention and plan.
- Planning: BFS shortest-path search over the known walkable map, avoiding nearby agents and temporarily blocked edges.
- Memory: parcels are remembered for a short time after leaving sight and their expected reward decays.
- Exploration: if no parcel is visible, the agent patrols reachable spawner tiles.
- Team/opponent awareness: nearby agents are stored and penalized in parcel choice.
- Metrics: score, intentions, pickups, deliveries, plan failures, and blocked moves are logged every 10 seconds.

## Decision Rule

For each visible parcel the agent estimates:

```text
utility = parcel reward - path to parcel - path from parcel to delivery
```

The current version uses a stronger estimate:

```text
utility =
  expected reward after memory decay
  - path to parcel
  - path from parcel to delivery
  - nearby-agent risk
  - carried-parcel delay penalty
```

If already carrying parcels, delivery is considered, but the agent can still pick up another nearby high-value parcel before delivery.

## Next Improvements

Good project extensions are:

- Coordinate with a teammate using `emitSay`, `emitAsk`, or `emitShout`.
- Add PDDL planning as an alternative `go_to` plan.
- Tune the utility weights after observing performance on the real maps.
- Add a benchmark runner that compares this version with a greedy baseline.
