/**
 * Dependency-free smoke test of the core logic (no SDK, no network, no
 * installed packages needed). Run with: node scripts/smoke-test.js
 *
 * It exercises: graph building (walls + arrow tiles), BFS pathfinding,
 * delivery-distance precomputation, belief revision (decay projection,
 * negative evidence), option generation, all four strategies, mission
 * fallback parsing, mission constraints on the graph, PDDL problem
 * generation, plan library ordering, and the protocol envelope.
 */
import { PathPlanner } from '../src/planning/PathPlanner.js';
import { BeliefBase } from '../src/core/BeliefBase.js';
import { OptionGenerator } from '../src/core/OptionGenerator.js';
import { createStrategy } from '../src/strategies/index.js';
import { MissionInterpreter } from '../src/llm/MissionInterpreter.js';
import { PddlPlanner } from '../src/planning/PddlPlanner.js';
import { buildDefaultPlanLibrary } from '../src/core/PlanLibrary.js';
import { makeMessage, isProtocolMessage } from '../src/communication/MessageTypes.js';
import { MetricsCollector } from '../src/metrics/MetricsCollector.js';
import { normalizeIdList } from '../src/utils/serialization.js';

let failures = 0;
const assert = (cond, msg) => {
  if (cond) console.log('ok  :', msg);
  else { console.error('FAIL:', msg); failures += 1; }
};

// --- Map: 4x3, wall at (1,1), arrow '→' at (2,0) ---------------------------
// y=2:  3 3 3 2      ('2' delivery at (3,2))
// y=1:  3 0 3 3      ('0' wall at (1,1))
// y=0:  1 3 > 3      ('1' spawner at (0,0), arrow right at (2,0))
const types = {
  '0,0': '1', '1,0': '3', '2,0': '→', '3,0': '3',
  '0,1': '3', '1,1': '0', '2,1': '3', '3,1': '3',
  '0,2': '3', '1,2': '3', '2,2': '3', '3,2': '2',
};
const tiles = Object.entries(types).map(([k, type]) => {
  const [x, y] = k.split(',').map(Number);
  return { x, y, type };
});

const beliefs = new BeliefBase();
beliefs.loadMap(4, 3, tiles);
beliefs.updateMe({ id: 'me1', name: 'tester', x: 0, y: 0, score: 0 });
beliefs.updateConfig({
  CLOCK: 50,
  GAME: { parcels: { decaying_event: '1s' }, player: { movement_duration: 100 } },
});

const graph = beliefs.graph;
assert(graph.tiles.size === 12, 'graph has 12 tiles');
assert(!graph.isWalkable(1, 1), 'wall not walkable');
const from30 = graph.neighbors(3, 0).map((e) => e.key);
assert(!from30.includes('2,0'), 'cannot enter arrow tile against arrow');
const from10 = graph.neighbors(1, 0).map((e) => e.key);
assert(from10.includes('2,0'), 'can enter arrow tile along arrow');

// --- PathPlanner ------------------------------------------------------------
const planner = new PathPlanner(beliefs);
const path = planner.shortestPath({ x: 0, y: 0 }, { x: 3, y: 2 });
assert(path && path.directions.length === 5, 'BFS shortest path has length 5');
const nd = planner.nearestDelivery({ x: 0, y: 0 });
assert(nd && nd.tile.x === 3 && nd.tile.y === 2, 'nearest delivery found');
assert(graph.deliveryDistance(0, 0) === 5, 'precomputed delivery distance (reversed BFS) = 5');

// --- Belief revision ----------------------------------------------------------
beliefs.updateSensing({
  positions: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
  parcels: [{ id: 'p1', x: 1, y: 0, reward: 30, carriedBy: null }],
  agents: [{ id: 'a2', name: 'opp', x: 3, y: 1, score: 10 }],
});
assert(beliefs.parcels.has('p1'), 'parcel sensed');
assert(beliefs.projectedReward(beliefs.parcels.get('p1')) === 30, 'projected reward fresh = 30');
// Decay projection follows server semantics: −1 per WHOLE decay tick
// (1.5 intervals elapsed -> one tick deducted, not a floored 1.5).
const agedParcel = { rewardAtLastSeen: 30, lastSeen: Date.now() - 1500 };
assert(beliefs.projectedReward(agedParcel) === 29, 'projection deducts whole decay ticks only');
const futureParcel = { rewardAtLastSeen: 30, lastSeen: Date.now() + 5000 };
assert(beliefs.projectedReward(futureParcel) === 30, 'projection tolerates clock skew (no negative elapsed)');
assert(Math.abs(beliefs.decayPerTile() - 0.1) < 1e-9, 'decayPerTile = 100ms/1000ms');
beliefs.updateSensing({ positions: [{ x: 1, y: 0 }], parcels: [], agents: [] });
assert(!beliefs.parcels.has('p1'), 'negative evidence deletes parcel belief');

// --- Options + strategies ------------------------------------------------------
beliefs.updateSensing({
  positions: [],
  parcels: [{ id: 'p2', x: 2, y: 2, reward: 40, carriedBy: null }],
  agents: [],
});
const gen = new OptionGenerator();
let options = gen.generate(beliefs);
assert(options.some((o) => o.type === 'go_pick_up'), 'go_pick_up option generated');
assert(
  options.some((o) => o.type === 'explore') && options.some((o) => o.type === 'wait'),
  'fallback options present',
);
for (const id of ['greedy-nearest', 'reward-distance', 'delivery-threshold', 'mission-aware']) {
  const s = createStrategy(id);
  const best = s.selectOption(gen.generate(beliefs), beliefs, planner.scoringHelpers());
  assert(best && best.type === 'go_pick_up', `${id} selects pickup`);
}
beliefs.markCarried('p2');
options = gen.generate(beliefs);
assert(options.some((o) => o.type === 'deliver_carried'), 'deliver option when carrying');
const greedy = createStrategy('greedy-nearest');
const best2 = greedy.selectOption(gen.generate(beliefs), beliefs, planner.scoringHelpers());
assert(best2.type === 'deliver_carried', 'greedy delivers when nothing left to pick');

// --- Mission fallback parsing ----------------------------------------------------
const F = MissionInterpreter.fallbackParse;
assert(F('Go to (19,19) or (20,19) for 1000 points!').kind === 'go_to', 'go_to parsed');
assert(F('Go to (19,19) for 1000 points').targets[0].x === 19, 'coordinates extracted');
assert(F('Go to (19,19) for 1000 points').bonus === 1000, 'bonus extracted');
assert(F('Drop a package in (1,1) for 1000 pts').kind === 'deliver_at', 'deliver_at parsed');
const qa = F('Calculate 5*(5+3)/2');
assert(qa.kind === 'question_answer' && qa.answer === '20', 'arithmetic question answered');
assert(
  F('Do not go through tiles (13,15) (14,15) or you will be penalized -500 points').forbidden === true,
  'negative mission detected',
);
assert(F('Deliver exactly one package at a time for a bonus').kind === 'deliver_exactly_n', 'deliver_exactly_n parsed');
assert(
  F('Deliver a total reward of less than 10 to get a bonus').kind === 'deliver_less_value_than',
  'value threshold mission parsed',
);
assert(MissionInterpreter.parseLightState('RED LIGHT').movementAllowed === false, 'red light gates movement');
assert(MissionInterpreter.parseLightState('GREEN LIGHT').movementAllowed === true, 'green light opens gate');

// --- Mission constraints on the graph ----------------------------------------------
beliefs.setMission({ kind: 'go_to', forbidden: true, targets: [{ x: 2, y: 1 }] });
assert(!graph.isWalkable(2, 1), 'mission-blocked tile not walkable');
const pathAfterBlock = planner.shortestPath({ x: 0, y: 0 }, { x: 3, y: 2 });
assert(pathAfterBlock && pathAfterBlock.directions.length === 5, 'path still exists avoiding blocked tile');

// --- PDDL problem generation ----------------------------------------------------------
const pddl = new PddlPlanner({
  beliefs,
  config: { pddl: { enabled: true, maxTiles: 100 } },
  metrics: new MetricsCollector(),
});
const problem = pddl.buildProblem({ x: 0, y: 0 }, { x: 3, y: 2 });
assert(problem.includes('(:goal (at t_3_2))'), 'PDDL goal emitted');
assert(problem.includes('(at t_0_0)'), 'PDDL initial position emitted');
assert(!problem.includes('t_2_1'), 'blocked tile excluded from PDDL problem');

// --- Plan library ordering + protocol envelope ------------------------------------------
const lib = buildDefaultPlanLibrary();
const goToPlans = lib.plansFor({ type: 'go_to' }, { pddlPlanner: pddl });
assert(
  goToPlans.length === 2 && goToPlans[0].name === 'PddlGoTo',
  'PDDL plan precedes BFS plan when enabled',
);
const goToPlansNoPddl = lib.plansFor({ type: 'go_to' }, { pddlPlanner: { isEnabled: () => false } });
assert(
  goToPlansNoPddl.length === 1 && goToPlansNoPddl[0].name === 'FollowPathGoTo',
  'BFS only when PDDL disabled',
);
const envelope = makeMessage('claim', { parcelId: 'p9' }, 'me1');
assert(isProtocolMessage(envelope) && !isProtocolMessage('free text'), 'protocol envelope detection');

// --- Ack normalization + belief reconciliation (live-observed server quirk) -----
assert(
  JSON.stringify(normalizeIdList([{ id: 'a' }, 'b', { parcelId: 'c' }, {}, null])) === '["a","b","c"]',
  'ack id normalization handles objects, strings and junk',
);
assert(normalizeIdList(undefined).length === 0, 'ack normalization tolerates non-arrays');
// Phantom-carry reconciliation: clearCarried removes only my parcels.
beliefs.parcels.set('mine', { id: 'mine', x: 0, y: 0, reward: 5, rewardAtLastSeen: 5, lastSeen: Date.now(), carriedBy: 'me1' });
beliefs.parcels.set('theirs', { id: 'theirs', x: 1, y: 2, reward: 5, rewardAtLastSeen: 5, lastSeen: Date.now(), carriedBy: 'a2' });
beliefs.clearCarried();
assert(!beliefs.parcels.has('mine') && beliefs.parcels.has('theirs'), 'clearCarried removes only own-carried beliefs');
// Tile-pickup fallback: free parcel on my tile becomes carried.
beliefs.parcels.set('onTile', { id: 'onTile', x: 0, y: 0, reward: 9, rewardAtLastSeen: 9, lastSeen: Date.now(), carriedBy: null });
beliefs.markTilePickedUp();
assert(beliefs.parcels.get('onTile').carriedBy === 'me1', 'markTilePickedUp marks free parcels on my tile');

if (failures > 0) {
  console.error(`\n${failures} smoke test(s) FAILED.`);
  process.exit(1);
}
console.log('\nAll smoke tests passed.');
