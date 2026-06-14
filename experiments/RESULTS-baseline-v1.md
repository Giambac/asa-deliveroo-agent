# Challenge 1 baseline results — campaign `baseline-v1`

Committed record of the Phase 1 baseline (raw result JSONs and the CSV live
in the git-ignored `experiments/results/`; this file is the durable copy of
the numbers for the report).

- **Setup:** local Deliveroo.js server, one map per server start
  (`GAME_NAME=26c1_N`), agent BDI (`src/main-bdi.js`).
- **Protocol:** 4 strategies × 5 runs × 120 s each, fresh identity per run
  (`scripts/run-baseline.js` via `scripts/run-campaign.js`).
- **Date:** 2026-06-14. **CSV:** `experiments/results/baseline_c1_v1.csv`.
- **Note on map 4:** the first campaign pass failed on `26c1_4` (per-map
  resilience let the other maps finish); the data below is from a clean
  separate retry (label `26c1_4-baseline-v1-retry`, 20 runs).

## Per-map configuration (the explanatory variable)

From `assets/games/26c1_*.json`. Decay = `decaying_event`, reward =
`reward_avg`, cap = `capacity`.

| Map | Description | Decay | Reward | Cap | NPC | Notes |
|---|---|---|---|---|---|---|
| 26c1_1 | Rectangles | 1s | 30 | 20 | — | fast spawn (1s) |
| 26c1_2 | Large simple | 1s | 30 | 20 | — | |
| 26c1_3 | Wide paths 30×30 | 1s | 30 | 20 | — | fast movement (50ms) |
| 26c1_4 | Anti-clockwise loop | 1s | 30±10 | 5 | intelligent | omniscient competitor |
| 26c1_5 | Racing circuit | 1s | 30±10 | 5 | intelligent | one-way arrows |
| 26c1_6 | Two obstacles | 1s | 30 | 20 | — | |
| 26c1_7 | 40×40 | 2s | 50 | 20 | — | slow decay, high reward |
| 26c1_8 | Empty 50×40 | 2s | 50 | 20 | — | slow decay, high reward |

## Winner per map (mean score, n=5)

| Map | Winner | 2nd | Verdict |
|---|---|---|---|
| 26c1_1 | **greedy-nearest** 868 | delivery-threshold 742 | greedy clear |
| 26c1_2 | **greedy-nearest** 866 | delivery-threshold 691 | greedy clear |
| 26c1_3 | tie (dt 397 ≈ greedy 377 ≈ rd 375 ≈ ma 373) | — | within noise |
| 26c1_4 | **greedy-nearest** 828 | delivery-threshold 657 | greedy clear |
| 26c1_5 | tie (dt 337 ≈ rd 321 ≈ greedy 319 ≈ ma 316) | — | within noise |
| 26c1_6 | **greedy-nearest** 917 | delivery-threshold 622 | greedy clear |
| 26c1_7 | **greedy-nearest** 882 | delivery-threshold 290 | greedy huge |
| 26c1_8 | **greedy-nearest** 1035 | delivery-threshold 604 | greedy huge |

**greedy-nearest wins outright on 6/8 maps and ties on the other 2
(26c1_3, 26c1_5). It is never beaten.**

## Key findings

1. **Throughput beats value optimization.** The naive nearest-first
   baseline dominates the value-aware strategies across all maps. In this
   game (roughly uniform rewards, non-trivial decay, frequent spawns),
   grabbing the nearest parcel and delivering immediately maximizes score.
2. **The "slow decay favors batching" hypothesis is falsified.** On the
   slow-decay / high-reward maps (26c1_7, 26c1_8) `delivery-threshold`
   does *worst*, not best: it delivers ~9–18 parcels vs greedy's ~27–31.
   On large maps the bottleneck is travel time, not decay; holding 3
   parcels before delivering collapses throughput. (Whether the 3× gap
   also hides an inefficiency in the batching logic is open — Phase 1
   step 3.)
3. **`mission-aware` and `reward-distance` share the lower band, but are
   not interchangeable, and neither challenges greedy.** They are close on
   several maps, yet diverge by more than noise on others — `reward-distance`
   is clearly ahead on 26c1_2 (679 vs 563, >2 SE) and `mission-aware` on
   26c1_4 (573 vs 514, >2 SE); `mission-aware` is also numerically ahead on
   26c1_8 (517 vs 433), though variance is higher there (~1.7 SE). So
   `mission-aware` does not simply reduce to `reward-distance` when no
   mission is active.
4. **Variance is regime-dependent.** Low on small/simple maps; high where
   the intelligent NPC is present (26c1_5 std 141) or the map is large
   (26c1_7 std 173, 26c1_8 std 255, range 726–1360). The ties on 26c1_3
   and 26c1_5 are genuine ties given these intervals.

## Full results (mean ± sample std over 5 runs)

| Scenario | Strategy | Score mean | Score std | Min | Max | Delivered mean |
|---|---|---:|---:|---:|---:|---:|
| 26c1_1 | greedy-nearest | 868.2 | 96.7 | 762 | 956 | 56.8 |
| 26c1_1 | delivery-threshold | 742.0 | 47.2 | 693 | 808 | 40.4 |
| 26c1_1 | mission-aware | 660.2 | 46.3 | 604 | 715 | 35.2 |
| 26c1_1 | reward-distance | 649.6 | 68.8 | 546 | 722 | 33.8 |
| 26c1_2 | greedy-nearest | 865.6 | 46.5 | 800 | 917 | 47.8 |
| 26c1_2 | delivery-threshold | 691.4 | 55.6 | 624 | 751 | 34.8 |
| 26c1_2 | reward-distance | 678.8 | 72.4 | 601 | 757 | 30.4 |
| 26c1_2 | mission-aware | 563.2 | 94.7 | 437 | 699 | 28.8 |
| 26c1_3 | delivery-threshold | 397.0 | 64.8 | 318 | 456 | 30.8 |
| 26c1_3 | greedy-nearest | 377.4 | 33.8 | 344 | 421 | 30.4 |
| 26c1_3 | reward-distance | 374.6 | 38.7 | 319 | 412 | 23.6 |
| 26c1_3 | mission-aware | 373.4 | 64.8 | 285 | 460 | 23.6 |
| 26c1_4 | greedy-nearest | 827.8 | 101.1 | 730 | 965 | 38.2 |
| 26c1_4 | delivery-threshold | 657.2 | 122.8 | 461 | 801 | 31.4 |
| 26c1_4 | mission-aware | 573.2 | 40.8 | 532 | 637 | 24.4 |
| 26c1_4 | reward-distance | 513.8 | 29.6 | 475 | 552 | 25.0 |
| 26c1_5 | delivery-threshold | 336.8 | 64.3 | 252 | 418 | 18.6 |
| 26c1_5 | reward-distance | 320.8 | 43.8 | 251 | 372 | 15.6 |
| 26c1_5 | greedy-nearest | 318.8 | 140.8 | 206 | 550 | 22.0 |
| 26c1_5 | mission-aware | 316.2 | 39.4 | 271 | 367 | 16.4 |
| 26c1_6 | greedy-nearest | 916.6 | 152.3 | 658 | 1046 | 47.0 |
| 26c1_6 | delivery-threshold | 622.0 | 56.9 | 554 | 691 | 28.8 |
| 26c1_6 | reward-distance | 562.0 | 49.5 | 487 | 620 | 24.4 |
| 26c1_6 | mission-aware | 538.8 | 83.1 | 415 | 616 | 24.4 |
| 26c1_7 | greedy-nearest | 882.4 | 173.2 | 656 | 1037 | 27.4 |
| 26c1_7 | delivery-threshold | 289.6 | 69.0 | 200 | 353 | 8.8 |
| 26c1_7 | mission-aware | 265.8 | 32.1 | 213 | 300 | 7.6 |
| 26c1_7 | reward-distance | 247.8 | 44.9 | 182 | 304 | 7.8 |
| 26c1_8 | greedy-nearest | 1034.8 | 255.2 | 726 | 1360 | 30.6 |
| 26c1_8 | delivery-threshold | 604.4 | 123.9 | 450 | 752 | 17.6 |
| 26c1_8 | mission-aware | 516.8 | 76.6 | 415 | 620 | 14.8 |
| 26c1_8 | reward-distance | 432.6 | 79.7 | 340 | 525 | 13.6 |

(Scenario labels in the raw files carry the `-baseline-v1` suffix;
`26c1_4` is `-baseline-v1-retry`.)
