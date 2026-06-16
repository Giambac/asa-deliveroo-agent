# Experiments

Run outputs live here:

- `logs/` — one JSON-lines file per agent per run (`<label>-<role>-<timestamp>.jsonl`).
  Every line is `{t, event, ...payload}`. Events include: `strategy_selected`,
  `score`, `pickup`, `delivery` (both with `count` and normalized `ids` —
  `ids` may be empty on server versions whose acks carry no id field),
  `intention_started/done/failed/aborted`, `plan_failed`, `pddl_plan`,
  `pddl_delivery_plan`, `pddl_failure`, `mission_interpreted`,
  `mission_applied`, `msg_in`, `msg_out`.
- `results/` — one JSON summary per run (final score, counters, score timeline),
  written when the agent stops (`scripts/run-experiment.js` does this automatically).

Note: raw run outputs are **git-ignored** (only the `.gitkeep`
placeholders are committed) — logs and results live only on the machine
that produced them. Keep the numbers you need for the report in the
report sources or in these READMEs.

The `live-smoke*` files (present locally if you ran the validation; not
committed) are real validation runs (2026-06-11, local server,
`empty_10`, 60 s each). They double as a before/after example of the
belief-reconciliation fix: `live-smoke` (score 173, 336 futile putdown
retries caused by phantom carry beliefs) vs `live-smoke2` (score 800,
30 deliveries, zero futile retries) — useful material for the report's
belief-revision discussion.

## Running an experiment

```bash
node scripts/run-experiment.js --strategy reward-distance --duration 180 --label 26c1_3
node scripts/run-experiment.js --agent llm --strategy mission-aware --duration 300 --label 26c2_5
```

The `--label` should be the scenario name so results group naturally.

## Comparing strategies

Parcel spawns are random: run **at least 5 sessions per (scenario, strategy)
pair** and compare means (this mirrors the professor's
`benchmarkAgent/multiple_run.js` pattern). Useful comparison metrics, all
present in the result summaries:

- final score and score timeline;
- delivered / picked-up parcel counts;
- pickups lost (target disappeared before arrival);
- failed moves and failed actions (penalty proxies);
- intention changes (commitment stability vs. thrashing);
- planner calls and failures (PDDL on/off comparison);
- coordination message counts (team runs).

Analysis (tables, plots) belongs in `notebooks/` or offline scripts — never
in the agent runtime.
