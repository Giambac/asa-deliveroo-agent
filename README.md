# asa-deliveroo-agent

Autonomous agents for the [Deliveroo.js](https://github.com/unitn-ASA/Deliveroo.js)
game — exam project for the Autonomous Software Agents course (UniTn).

**Goal:** a clean, extensible infrastructure where game strategies can be
added, selected, tested and compared easily, built around the professor's
lab BDI architecture (beliefs → options/desires → intentions → plans →
intention revision), with an LLM layer for high-level mission
interpretation and a meaningful (optional-at-runtime) PDDL integration.

## How the structure maps to the exam requirements

| Exam requirement | Where |
|---|---|
| Agent A: BDI agent (Challenge 1) | `src/main-bdi.js` + `src/core/` |
| Sense / revise beliefs | `src/core/BeliefBase.js` (decay projection, negative evidence, timestamps) |
| Revise intentions | `src/core/IntentionRevision.js` (replace policy + hysteresis) |
| Game strategy, swappable | `src/strategies/` (4 strategies + registry) |
| Agent B: LLM agent (Challenge 2) | `src/main-llm.js` + `src/llm/` |
| Atomic requests / strategy adaptation | `src/llm/MissionInterpreter.js` (LLM or deterministic fallback) |
| A ↔ B coordination | `src/communication/` (structured `asa-team-v1` protocol) |
| Meaningful PDDL | `src/planning/PddlPlanner.js` + `pddlDomain.js` (PDDL plan serves the `go_to` intention, BFS fallback) |
| Deterministic movement | `src/planning/GridGraph.js` (digraph, arrow tiles) + `PathPlanner.js` (BFS) |
| Experiments / evidence | `src/metrics/`, `scripts/run-experiment.js`, `experiments/` |
| 10-page LaTeX report | `report/` (skeleton with per-section content plans) |

A study guide (in Italian) covering the whole architecture, the current
state and the evolution roadmap lives in `report/DocumentoStudio1.tex`
(+ compiled PDF) — start there to understand and extend the codebase.

## Architecture in one diagram

```
            socket events (map, config, you, sensing, msg)
                              │
                       ┌──────▼──────┐
                       │ BeliefBase  │  map graph, me, parcels, agents,
                       └──────┬──────┘  config, mission, teammate, claims
                              │
        OptionGenerator (what is possible)
                              │
        Strategy (what is preferable — swappable)        ← LLM adapts this
                              │                            via mission state
        IntentionRevision (commit / revise, hysteresis)
                              │
        PlanLibrary (how): GoPickUp, DeliverCarried, GoToMissionTarget,
                           Explore, Wait, PddlGoTo → FollowPathGoTo (BFS)
                              │
        ActionExecutor (serialized move/pickup/putdown, red-light gate)
```

The LLM (Agent B) never moves the agent. It interprets mission messages
into structured missions, applies them to beliefs (goals, forbidden
tiles, delivery policies, movement gate) and forwards them to Agent A.

## Setup

Requires Node ≥ 22 and a running Deliveroo.js server (local or course).

```bash
cd asa-deliveroo-agent
npm install
cp .env.example .env      # then edit
```

On Windows PowerShell, use `npm.cmd` and `Copy-Item`:

```powershell
cd asa-deliveroo-agent
npm.cmd install
Copy-Item .env.example .env   # then edit
```

Environment variables (see `.env.example` for the full commented list):

- `HOST` — server URL; `NAME` — agent name on first connection;
- `TOKEN` — JWT identity. Leave empty the first time: the server issues a
  token, which the agent prints and logs — save it in `.env` so restarts
  re-attach to the same in-game agent;
- `STRATEGY` — strategy id (see below); `RUN_LABEL` — scenario label for logs;
- `TEAMMATE_NAME` — the other agent's name (team handshake filter);
- `PDDL_ENABLED`, `PAAS_HOST`, `PAAS_PATH` — PDDL toggle and solver;
- `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `LLM_MODEL` — LLM provider
  (optional; without it Agent B uses deterministic mission parsing).

## Running

```bash
# Offline smoke test — no server, no network, no installed SDK needed
npm test

# Agent A (BDI)
node scripts/run-bdi.js --strategy reward-distance --label 26c1_3

# Agent B (LLM) — typically in a second terminal with a different NAME/TOKEN
node scripts/run-llm.js --name agentB --strategy mission-aware

# Timed experiment that writes a result summary and exits
node scripts/run-experiment.js --strategy greedy-nearest --duration 180 --label 26c1_1
```

The map is selected **server-side** when starting Deliveroo.js; the agent
just connects. In `Deliveroo.js/backend`:

```bash
GAME_NAME=26c1_3 npm start                       # macOS / Linux (bash)
```
```powershell
$env:GAME_NAME='26c1_3'; npm.cmd start           # Windows PowerShell
```

To benchmark a whole map — every strategy, several fresh-identity runs
each — and summarize the results into a comparison table (these run the
same on every OS):

```bash
node scripts/run-baseline.js --label 26c1_3 --duration 120 --runs 5
node scripts/aggregate-results.js --scenario 26c1   # markdown table (+ --csv path)
```

To run the whole multi-map campaign unattended (it starts/stops the
server itself for each map, one failing map does not abort the rest, and
it prints a succeeded/failed summary at the end), stop any manual server
first, then:

```bash
node scripts/run-campaign.js --campaign baseline-v1 --maps 26c1_2,26c1_3,26c1_4,26c1_5,26c1_6,26c1_7,26c1_8 --duration 120 --runs 5
```

For a two-agent team run: start both agents with each other's name in
`TEAMMATE_NAME` (or `--name`); they discover each other via a `hello`
shout and start exchanging position heartbeats, claims and mission updates.

## Selecting a strategy

`STRATEGY=<id>` in `.env` or `--strategy <id>` on any script:

| id | Idea |
|---|---|
| `greedy-nearest` | Chase the nearest parcel; deliver when nothing is reachable. Baseline. |
| `reward-distance` | Maximize projected *delivered* value: reward − decay × distance, per carried parcel. |
| `delivery-threshold` | Like reward-distance, but batch pickups until N parcels / value threshold, then deliver. |
| `mission-aware` | reward-distance + obeys mission state (bonus goals, delivery policies). Agent B default. |

Retrospective benchmark (no runtime default was changed after the fact):
in the Challenge 1 evaluation (8 maps × 4 strategies × 5 runs)
`greedy-nearest` emerges as the strongest baseline — it wins or ties on all
maps because it hoards and delivers in big batches (~7.6 parcels/delivery)
while the value-aware strategies small-batch (~2), maximizing throughput on
these parcel-rich maps. Run it with `--strategy greedy-nearest`. Details and
the falsified "batching-wins" hypothesis are in
`experiments/RESULTS-baseline-v1.md`.

## Adding a new strategy

1. Create `src/strategies/MyStrategy.js`:

```js
import { StrategyBase } from './StrategyBase.js';

export class MyStrategy extends StrategyBase {
  static id = 'my-strategy';
  utility(option, beliefs, helpers) {
    if (option.type === 'go_pick_up') {
      return /* your score */;
    }
    return super.utility(option, beliefs, helpers);
  }
}
```

2. Register it in `src/strategies/index.js` (import + add to the list).
3. Run with `--strategy my-strategy`. Nothing else changes — generation,
   intention revision, planning and execution are infrastructure.

Override `selectOption(options, beliefs, helpers)` instead of `utility`
for non-utility-based logic. `helpers` gives exact path distances
(`distanceTo`, `deliveryDistanceFrom`) and the decay-per-move cost.

## Logs and experiments

Every run writes a JSON-lines log to `experiments/logs/` (events: scores,
pickups, deliveries, intention changes, plan failures, planner calls, LLM
interpretations, protocol messages) and — when stopped via
`run-experiment.js` — a summary JSON to `experiments/results/`. See
`experiments/README.md` for the comparison methodology. Notebooks in
`notebooks/` are for offline analysis only.

## What is implemented now

- Full BDI skeleton: belief revision (decay projection, negative
  evidence), option generation, utility-based strategies, intention
  revision with hysteresis, plan library with fallback, serialized
  action execution with failed-move handling and soft-blocking.
- Belief reconciliation against server quirks: ack id normalization
  (`normalizeIdList`) plus fallbacks (`markTilePickedUp`,
  `clearCarried`) when acks carry no usable ids or contradict the carry
  belief — added after live testing exposed a phantom-carry loop.
- Close-safe shutdown logging: the run logger swallows the async
  write-after-end stream error and is idempotent, and a stopped intention
  reports cancellation (not a plan failure) — so tearing an agent down
  mid-plan (e.g. between baseline runs) never crashes the process.
- Offline smoke test (`npm test`, no server/network needed) covering
  the graph, pathfinding, belief revision, strategies, mission parsing,
  PDDL problem generation and ack normalization.
- **Validated live** (2026-06-11, local server, `empty_10` map, 60 s):
  `reward-distance` scored 800 with 30 parcels delivered (raw run
  outputs are git-ignored; see `experiments/README.md` for the numbers).
- Deterministic pathfinding on the directed map graph (arrow tiles
  supported from day one; delivery distances via reversed multi-source BFS).
- Four working example strategies and a strategy registry.
- Mission interpretation: LLM path (schema-validated JSON) and a
  deterministic fallback covering the Challenge 2 mission catalog,
  including instant red/green-light handling and arithmetic Q&A.
- Team protocol: discovery, position heartbeat, claims, mission updates,
  acks; validated tool registry for LLM tool-loop experiments.
- PDDL: domain + problem generation from beliefs, online solver wrapper,
  registered as an alternative `go_to` plan when `PDDL_ENABLED=true`.
- Metrics, structured run logs, experiment runner, report skeleton.
- Baseline harness: `scripts/run-baseline.js` (every strategy × N
  fresh-identity runs against the loaded map) and
  `scripts/aggregate-results.js` (group results by scenario × strategy,
  mean/std/min/max score and delivered, markdown table + optional CSV).
- Unattended multi-map campaign runner `scripts/run-campaign.js`: starts
  and stops the Deliveroo.js server per map, runs the baseline on each,
  is resilient per map (one failing map does not abort the rest) and
  prints a succeeded/failed summary, then aggregates.

## What remains for future phases

1. **Tuning & validation on Challenge 1** — run all 8 maps, tune
   `deliverBias`, thresholds, hysteresis; add opponent-aware utilities
   (drop contested parcels when an opponent is closer).
2. **Challenge 2 choreography** — full one-pickup-another-deliver
   handover (rendezvous negotiation via `ask`, putdown-before-pickup
   sequencing) and the team go-to-and-wait mission (26c2_10).
3. **PDDL depth** — extend the domain with pickup/putdown to plan whole
   collect-and-deliver sequences; measure BFS vs PDDL for the report.
4. **LLM tool loop** — optionally let the LLM drive the `tools.js`
   registry for open-ended requests (lab8 07-pattern).
5. **Experiments + report** — ≥5 runs per (map, strategy), notebook
   analysis, fill the report sections.

## Known assumptions

Source-grounded where possible (see `context/game_knowledge/`), to be
verified at runtime on the challenge server:

- **Capacity is not enforced** for player agents (only the intelligent
  NPC obeys it); `pickup` grabs all parcels on the tile. Challenge
  configs with `capacity: 1` are treated as advisory.
- **Own carried parcels** may or may not appear in `sensing.parcels`
  (open question 12) — pickup/putdown acks are therefore treated as the
  authoritative carry signal (`markCarried`/`markDelivered`).
- **Ack shapes vary across server versions** (verified live): pickup and
  putdown acks may contain `{id}` objects, plain strings, or other
  shapes. All ack ids go through `normalizeIdList`, with belief
  reconciliation fallbacks (`markTilePickedUp`, `clearCarried`) when no
  ids are usable or the server contradicts the carry belief.
- **Mission text formats** in the deterministic fallback parser follow
  the Challenge 2 config descriptions; coordinate *ranges* like
  "(13,15)–(16,15)" are parsed as the listed endpoints only (the LLM
  path handles ranges better).
- **Red/green light state messages** are assumed to contain "red light"
  or "green light" (matching the mission agent's shouts); they are parsed
  without the LLM because gating is latency-critical.
- **Hold duration** for go-to-and-wait missions is a fixed 5 s placeholder
  until the explicit teammate synchronization is implemented.
- The `tile` event (map edits mid-game) triggers a full graph rebuild —
  acceptable because it is rare and maps are small.

## Repository rules

- **Documentation follows code (mandatory):** every change to code
  behavior must update, in the same change, the affected parts of this
  README (implemented/remaining/assumptions), `scripts/smoke-test.js`,
  `experiments/README.md`, `notebooks/README.md`, and the content-plan
  comments in `report/sections/*.tex`. The full checklist lives in
  `CLAUDE.md`. A change is not complete until `npm test` passes and the
  checklist has been walked.
- `Deliveroo.js/` and `DeliverooAgent.js/` (course repos) are read-only
  references and are not part of this package.
- Comments and documentation in English; ES modules everywhere;
  strategy logic stays out of infrastructure files.
