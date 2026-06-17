# Live crate-pushing run — `crates_one_way`

First live validation of the crate-pushing capability (branch
`crate-pushing`) against the local Deliveroo.js server on the Sokoban-style
map that previously left the agent stuck at score 0.

## Setup

- Server: `GAME_NAME=crates_one_way PORT=8080 node index.js`
  (Deliveroo.js backend), map size 9×9, `movement_duration=50`,
  `decaying_event=1s`, `capacity=5`.
- Agent: `node scripts/run-experiment.js --name crateTest --label crates
  --duration 120 --host http://localhost:8080`
  (BDI, default `reward-distance` strategy, no LLM).
- Date: 2026-06-17. Single 120 s run.

## Result

| metric             | value |
|--------------------|-------|
| final score        | 43    |
| parcels delivered  | 2     |
| parcels picked up   | 2     |
| **crates pushed**  | **1** |
| failed pushes      | 0     |
| failed moves       | 1     |
| intention changes  | 453   |
| failed intentions  | 449   |

Result file: `experiments/results/crates-bdi-2026-06-17T10-59-01-597Z.json`.

Logged push event (genuine live evidence):

```json
{"event":"crate_pushed","crateId":"c1","from":{"x":8,"y":2},"to":{"x":7,"y":2},"dir":"left"}
```

## Reading

- **The blocker is gone.** Before crate support, this map left most tiles
  unreachable and the agent scored 0 (see `RESULTS-c2-v5.md`). With crate
  sensing + occupancy-aware BFS + the deterministic push, the agent moves,
  pushes a crate aside, and delivers — score 43 with 2 deliveries and one
  successful push, zero rejected pushes.
- **High intention churn.** 449 failed intentions against 453 changes: on
  this tight, mostly-walled map many candidate targets are still
  unreachable or transiently blocked, so the agent re-deliberates a lot.
  This does not stall it (it still delivers and pushes) but indicates room
  to improve target selection on Sokoban maps — chained / multi-crate
  planning and a less thrash-prone explore fallback are future work.
- Scope: a single push per plan execution; this run confirms the single
  push path end-to-end, not multi-crate optimisation.
