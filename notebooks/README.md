# Notebooks

Optional analysis notebooks only — **never required for runtime behavior**
(blueprint constraint).

Intended use: load `experiments/results/*.json` and `experiments/logs/*.jsonl`,
produce the score-over-time plots and strategy comparison tables for the
report (section 07_experiments).

Example data already exists: the `live-smoke*` validation runs in
`experiments/results/` and `experiments/logs/` (see
`experiments/README.md` for what they show), so the first notebook can
be built and tested right away.

Suggested first notebook (`analysis.ipynb`):

1. Load every result JSON into a dataframe (strategy, scenario, finalScore, counters).
2. Group by (scenario, strategy), aggregate mean/std of final score over ≥5 runs.
3. Plot score timelines per strategy on the same scenario.
4. Export the comparison table for `report/sections/07_experiments.tex`.
