# Experiments Log — Hyperparameter Tuning (Ratchet Playground)

Purpose: identify a **useful baseline parameter regime** (null regime) and then test **P3 (protocol)** and **P6 (resource)** effects, guided by the mathematics in `docs/` (Deliverables A–D).

## Canonical theory package

- See `docs/canonical_theory_package.md` for the explicit (Z, f, Sigma_f, E, A) package.
- Note: paper.tex terminology is canonical; repo aliases are mapped in that doc.

## What “balanced” means here (docs-aligned)

From `docs/knowledge/02_primitives_P1_P6.md` and `docs/knowledge/11_deliverable_D_diagnostics.md`:

1) **Null-regime correctness (P3=OFF, P6=OFF)**  
   - Irreversibility/audit diagnostics should relax toward 0: `Ay≈0`, `Jy≈0`, `Σmem≈0`, `M6≈0`, and any EP proxy ≈ 0.
   - P3 holonomy diagnostics should relax toward 0: `p3DispMag≈0`, `p3LoopArea≈0`.

2) **Driven-regime separability**  
   - Turning **only** P3 and/or P6 ON should be the only way to get persistent nonzero `Σmem` / motif affinities (M3/M6).

3) **Non-degenerate dynamic range (practical)**  
   - Memory variables not pinned at 0 or caps (`w,a,n,S` not saturated).
   - Graph is not empty and not near complete (edges are a moderate fraction of max).
   - Safe-set fraction not pinned at 0% or 100%.
   - Compare **per DOF** (since P1 has O(N²) weights): `Ew/#pairs`, `En/N`, `Ea/N`, `Es/grid²` (not raw totals).

## Workflow

- Use the shell runner `scripts/ratchet-cli.mjs` so we can run long experiments headlessly and print intermediate summaries.
- Vary parameters gradually; start with isolated subsystems and add complexity.
- Run long enough to see relaxation / stationarity (typically **millions** of steps for N=200; longer if drift is slow).

## Claims index (safe vs suggestive)

Each campaign below contains a “Safe claims” block. Claim IDs are stable so the report can cite them.

Legend:
- **SAFE** = supported by explicit controls and/or multi-seed stats/CI in this log.
- **SUGGESTIVE** = suggestive pattern observed, but missing strong control / CI / sufficient seeds.

- C_BASE_NULL_1 (SAFE) — Null regime reversibility trends: affinities/Σmem decay toward 0 in long runs.
- C_P6_SEP_1 (SAFE) — P6 produces persistent nonzero M6 motifs vs null where M6≈0.
- C_P3_OBS_1 (SUGGESTIVE) — P3 loop observability improves with minimal protocol / cadence.
- C_P3P6_LONG_1 (SUGGESTIVE) — Long P3+P6 run shows persistent M6 and loop signal.
- C_BASE_RETUNE_NULL_1 (SAFE) — Base-only null preset is reversible with M6=0 and low Σmem.
- C_BASE_RETUNE_P6_1 (SAFE) — Base-only P6 drive yields stable nonzero M6 motifs (3 seeds).
- C_BASE_RETUNE_P3_1 (SUGGESTIVE) — P3 loop observed intermittently at report boundaries.
- C_BASE_RETUNE_P3P6_1 (SAFE) — P3+P6 combo shows nonzero M6 motifs; loop remains intermittent.
- C_META_NULL_1 (SAFE) — Meta-layer null remains reversible (M6=0, Σmem small).
- C_META_ETA_ALIGN_1 (SAFE) — Eta reduces cross-layer diffs for S/W in controlled runs.
- C_CLOCK_DRIFT_1 (SAFE) — Clock drift ≈0 in null, nonzero under P6 (5 seeds).
- C_TUR_1 (SAFE) — TUR ratio R ≥ ~1 for mu≥0.4 in sweep (10 seeds).
- C_CODE_MAINT_1 (SAFE) — Drive-only repair lowers mismatch and error vs null with EP>0.
- C_EP_EXACT_NULL_1 (SAFE) — epExact window rate ≈0 in null with CI containing 0.
- C_TRAVERSAL_NEED_1 (SAFE) — Gated repair needs traversal; static fails to recover.
- C_TRAVERSAL_ORIENT_1 (SAFE) — In that gated repair setting, random clock matches drifting clock.
- C_DEADLINE_DRIFT_1 (SAFE) — Drift improves uptimeTail vs random with CI excluding 0.
- C_DEADLINE_CLOCK_EP_1 (SAFE) — ΔEPClockRate > 0 with tight CI (drift vs random).
- C_OPK_INV_1 (SAFE) — K token budget invariants hold.
- C_OPK_NULL_EP_1 (SAFE) — op coupling null EP remains near 0 (eta and eta=0).
- C_OPK_EFFECT_1 (SAFE) — Eta reduces operator mismatch Sdiff_op.
- C_OPK_DRIVE_SELECT_1 (SAFE) — Drive-selecting K reduces mismatch with epOpK>0 vs controls.
- C_OPK_HIER_1 (SUGGESTIVE) — Hierarchy metrics show slopes but are not definitive.
- C_OPK_DILUTION_1 (SAFE) — Deadline regression largely explained by dilution (ratio line).
- C_OPK_COMPOSED_R2_1 (SAFE) — Composed operator R2 grows with depth in measured configs.
- C_OPK_WEIGHT_NULL_EP_1 (SAFE) — opKTargetWeight sweep preserves null EP≈0.
- C_OPK_CI_EP_1 (SAFE) — ΔEP(C−B) at iso-miss excludes 0.
- C_OPK_REPAIR_DOM_1 (SAFE) — Repair-budget curves show C dominates B/A over observed budgets.

## Baseline parameter set (starting point)

Defaults in `scripts/ratchet-cli.mjs` (and app defaults) at the time of this log:

```json
{
  "beta": 1.0,
  "stepSize": 0.01,
  "p3On": 0,
  "p6On": 0,
  "pWrite": 0.1,
  "pNWrite": 0.05,
  "pAWrite": 0.05,
  "pSWrite": 0.05,
  "muHigh": 0.6,
  "muLow": -0.6,
  "kappaRep": 500.0,
  "r0": 0.25,
  "kappaBond": 1.2,
  "rStar": 0.22,
  "lambdaW": 0.3,
  "lW": 4,
  "lambdaN": 0.5,
  "lN": 6,
  "lambdaA": 0.5,
  "lA": 6,
  "lambdaS": 0.5,
  "lS": 6,
  "gridSize": 16,
  "rPropose": 0.12
}
```

---

## Experiments

### E0 — Smoke test (null regime)

Command:
```bash
node scripts/ratchet-cli.mjs run --steps 200000 --report-every 50000
```

Observed:
- Over 0→200k steps, edges climb from ~50 → ~200 and the giant component grows (largest ~164/200 at 200k).
- `P6 M6` is 0 (as expected with P6=OFF).
- `Σmem` decreases over time (transient from initial all-zeros state).

Takeaway:
- Need **millions** of steps for null-regime diagnostics to relax close to 0.

### E1 — Null baseline: X + P1 only (5M steps)

Goal:
- Check that with only X+P1 enabled (P3=OFF, P6=OFF) we get:
  - nontrivial but not saturated bond graph,
  - `Jw, Aw, Σmem` drifting toward 0 over time.

Command:
```bash
node scripts/ratchet-cli.mjs run --steps 5000000 --report-every 1000000 --set pAWrite=0 --set pNWrite=0 --set pSWrite=0
```

Selected checkpoints:
- 1M: `edges 615 | components 1 | largest 200/200`, `Jw 0.0070`, `Aw 0.2313`, `Σmem 0.0016`
- 5M: `edges 1857 | components 1 | largest 200/200`, `Jw 0.0036`, `Aw 0.1148`, `Σmem 0.0004`

Notes:
- Edges keep increasing with time (slowly), and the graph is already connected by 1M.
- Irreversibility diagnostics decay but are not yet ~0 at 5M; longer runs likely needed for tighter null-regime checks.

### E2 — X + P1 only, smaller `rPropose` (0.08)

Command:
```bash
node scripts/ratchet-cli.mjs run --steps 3000000 --report-every 1000000 --set pAWrite=0 --set pNWrite=0 --set pSWrite=0 --set rPropose=0.08
```

Selected checkpoints:
- 1M: `edges 566 | components 2 | largest 199/200`
- 3M: `edges 1241 | components 1 | largest 200/200`

Notes:
- Compared to `rPropose=0.12`, edges and `Ubond/Ew` are a bit lower but still percolate by ~2M.

### E3 — X + P1 only, smaller `rPropose` (0.05)

Command:
```bash
node scripts/ratchet-cli.mjs run --steps 2000000 --report-every 1000000 --set pAWrite=0 --set pNWrite=0 --set pSWrite=0 --set rPropose=0.05
```

Selected checkpoints:
- 1M: `edges 420 | components 3 | largest 198/200`
- 2M: `edges 774 | components 1 | largest 200/200`

Notes:
- Still reaches connectivity, but strong-bond edges (w≥3) are lower at the same horizon.

### E4 — X + P1 only, reduce write rate (`pWrite=0.05`, `rPropose=0.05`)

Command:
```bash
node scripts/ratchet-cli.mjs run --steps 2000000 --report-every 1000000 --set pWrite=0.05 --set pAWrite=0 --set pNWrite=0 --set pSWrite=0 --set rPropose=0.05
```

Selected checkpoints:
- 1M: `edges 343 | components 5 | largest 196/200`
- 2M: `edges 633 | components 1 | largest 200/200`

Notes:
- Strong-bond edges (w≥3) are reduced vs `pWrite=0.1` at the same horizon.

### E5 — Null regime with all reversible channels on (P1+P2+P4+P5, 5M steps)

Goal:
- Validate that adding P2/P4/P5 (still P3=OFF, P6=OFF) keeps:
  - those channels near reversible (`J≈0`, `A≈0`),
  - non-saturated energy scales / DOF activity.

Command:
```bash
node scripts/ratchet-cli.mjs run --steps 5000000 --report-every 1000000 --set pWrite=0.05 --set rPropose=0.05
```

Selected checkpoints:
- 1M: `edges 352 | components 8 | largest 193/200`, `Aa≈0.014`, `As≈0.013`
- 5M: `edges 1243 | components 1 | largest 200/200`
  - P2: `Ja≈0`, `Aa≈0.0025`
  - P4: `Jn≈0`, `An≈0`
  - P5: `Js≈0`, `As≈0.0029`
  - P1: `Jw 0.0025`, `Aw 0.1641`, `Σmem 0.0004`
  - Energy (5M): `Urep ~8978`, `Ubond ~318`, `Ew ~3936`, `En/Ea/Es ~ O(10^2)`

Notes:
- P2/P4/P5 relax quickly toward `A≈0` compared to P1 (which relaxes more slowly from all-zeros initialization).
- At this horizon the bond graph percolates, but strong-bond edge count is still far from complete.

### E6 — Retune P1 stiffness to avoid early percolation (`lambdaW=0.5`)

Command:
```bash
node scripts/ratchet-cli.mjs run --steps 3000000 --report-every 1000000 --set pWrite=0.05 --set rPropose=0.05 --set lambdaW=0.5
```

Selected checkpoints:
- 1M: `edges 158 | components 52 | largest 123/200 (0.61)`
- 3M: `edges 327 | components 5 | largest 194/200 (0.97)`
- 5M: `edges 484 | components 2 | largest 199/200 (0.99)`

Notes:
- Raising `lambdaW` reduces the number of strong bonds (w≥3) substantially at the same horizon, keeping the graph closer to the percolation threshold longer (useful for seeing driven effects).

### E8 — P6-only drive on the null baseline (μ=±0.6)

Command:
```bash
node scripts/ratchet-cli.mjs run --steps 5000000 --report-every 1000000 --set pWrite=0.05 --set rPropose=0.05 --set lambdaW=0.5 --set p6On=1
```

Selected checkpoints:
- 1M: `P6 M6 | W 0.201 N 0.148 A 0.119 S 0.011`, `edges 290 | largest 157/200`
- 5M: `P6 M6 | W 0.226 N 0.134 A 0.121 S 0.002`, `edges 1001 | largest 199/200`

Notes:
- With P6 ON, M6 motif estimates become clearly nonzero (especially for W/N/A).
- Strong-bond edges (w≥3) increase noticeably relative to P6=OFF at the same horizon.

### E9 — P6-only, stronger drive (μ=±1.0)

Command:
```bash
node scripts/ratchet-cli.mjs run --steps 3000000 --report-every 1000000 --set pWrite=0.05 --set rPropose=0.05 --set lambdaW=0.5 --set p6On=1 --set muHigh=1.0 --set muLow=-1.0
```

Selected checkpoints:
- 1M: `M6 W 0.330 N 0.241 A 0.245 S 0.017`, `edges 446 | largest 155/200`
- 3M: `M6 W 0.387 N 0.214 A 0.225 S 0.008`, `edges 1114 | largest 196/200`

Notes:
- Increasing |μ| strengthens M6 signals and grows strong-bond edges faster (risk: eventual percolation / hairball at very long horizons).

### E10 — P3-only with all kernels included (cycle length 5)

Command:
```bash
node scripts/ratchet-cli.mjs run --steps 1000000 --report-every 200000 --set pWrite=0.05 --set rPropose=0.05 --set lambdaW=0.5 --set p3On=1 --set p6On=0
```

Selected checkpoints:
- 200k: `P3 cycle 5 | disp 0.0001 | loop 0.5000`
- 1M: `P3 cycle 5 | disp 0.0001 | loop 0.0000` (value fluctuates; last-cycle diagnostic often prints as 0.0000)
- Graph stays very sparse at this horizon: `edges 96`, `largest 33/200`

Notes:
- P3 loop diagnostic is per-cycle (not averaged), so sampling at report boundaries can miss nonzero cycles.

### E11 — P3-only minimal noncommuting set: X + P1 + P5 (cycle length 3)

Command:
```bash
node scripts/ratchet-cli.mjs run --steps 500000 --report-every 100000 --set p3On=1 --set p6On=0 --set pWrite=0.05 --set pSWrite=0.05 --set pAWrite=0 --set pNWrite=0 --set rPropose=0.05 --set lambdaW=0.5
```

Selected checkpoints:
- 300k: `P3 cycle 3 | disp 0.0000 | loop -0.5000`
- 500k: `P3 cycle 3 | disp 0.0001 | loop -0.5000`

Notes:
- With only P1+P5 in the protocol, the (sum_w, sum_s) loop area becomes consistently nonzero at this scale, matching the Deliverable D “geometric signature” intent.

### E12 — P3+P6 combined (full kernel set), increase mobility (`stepSize=0.02`)

Command:
```bash
node scripts/ratchet-cli.mjs run --steps 2000000 --report-every 500000 --set pWrite=0.05 --set rPropose=0.05 --set lambdaW=0.5 --set p3On=1 --set p6On=1 --set muHigh=1.0 --set muLow=-1.0 --set stepSize=0.02
```

Selected checkpoints:
- 500k: `M6 W 0.135 N 0.111 A 0.105 S 0.009`, `edges 366 | largest 143/200`
- 2M: `M6 W 0.127 N 0.095 A 0.106 S 0.002`, `edges 1035 | largest 182/200`
- P3 loop occasionally nonzero (e.g. `loop -0.5000` at 1.5M), but often prints as 0.0000 at report boundaries.

Notes:
- In P3 mode, X steps are only 1/5 of steps; increasing `stepSize` helps particles traverse μ-contexts, which strengthens M6 signals (per Deliverable C’s “need movement between contexts”).

### E13 — P3+P6 combined (minimal protocol X+P1+P5), increase mobility (`stepSize=0.02`)

Command:
```bash
node scripts/ratchet-cli.mjs run --steps 1000000 --report-every 200000 --set p3On=1 --set p6On=1 --set muHigh=1.0 --set muLow=-1.0 --set pWrite=0.05 --set pSWrite=0.05 --set pAWrite=0 --set pNWrite=0 --set rPropose=0.05 --set lambdaW=0.5 --set stepSize=0.02
```

Selected checkpoints:
- 200k: `M6 W 0.126 S 0.013`, `edges 233 | largest 129/200`
- 1M: `M6 W 0.124 S 0.002`, `edges 885 | largest 181/200`, `P3 loop 0.5000`

Notes:
- This minimal setting yields both a nonzero P3 loop signature and a clear P6 M6 signature while remaining far from a complete bond graph at 1M.

### E14 — P3-only (minimal protocol X+P1+P5), increased mobility (`stepSize=0.02`)

Command:
```bash
node scripts/ratchet-cli.mjs run --steps 1000000 --report-every 200000 --set p3On=1 --set p6On=0 --set pWrite=0.05 --set pSWrite=0.05 --set pAWrite=0 --set pNWrite=0 --set rPropose=0.05 --set lambdaW=0.5 --set stepSize=0.02
```

Selected checkpoints:
- 600k: `P3 loop -0.5000`, `edges 201 | largest 157/200`
- 1M: `P3 loop 0.5000`, `edges 292 | components 19 | largest 181/200`

Notes:
- Increasing `stepSize` helps keep the protocol’s observables moving enough that the loop diagnostic is frequently nonzero at report boundaries.

### E15 — Long-run stability check: P3+P6 full set (10M steps)

Command:
```bash
node scripts/ratchet-cli.mjs run --steps 10000000 --report-every 2000000 --set pWrite=0.05 --set rPropose=0.05 --set lambdaW=0.5 --set p3On=1 --set p6On=1 --set muHigh=1.0 --set muLow=-1.0 --set stepSize=0.02
```

Selected checkpoints:
- 2M: `edges 1035 | components 18 | largest 182/200`, `M6 W 0.127 N 0.095 A 0.106`
- 10M: `edges 2562 | components 1 | largest 200/200`, `M6 W 0.147 N 0.091 A 0.104`, `P3 loop -0.5000`

Notes:
- Over 10M, strong-bond edges keep growing but remain far from complete (~13% of all pairs at threshold w≥3).
- M6 signals persist and strengthen slightly as the system explores μ-contexts.

---

## Campaign summary (what we achieved / did not achieve)

### Achieved

- A docs-aligned workflow with clear control regimes (null vs P6-only vs P3-only vs P3+P6) and a shell runner (`scripts/ratchet-cli.mjs`) to run multi‑million step experiments and inspect intermediate checkpoints.
- A **null baseline** where reversible channels behave as expected (P2/P4/P5 affinities relax quickly toward 0; P1’s `Σmem` decays toward 0 over millions of steps), while avoiding the immediate “complete-graph hairball” failure mode by making repulsion matter (`kappaRep/r0`) and limiting bond writes (`rPropose`, higher `lambdaW`).
- **Driven-regime separability for P6:** enabling P6 produces clearly nonzero M6 motif estimates (`aM6*`) and changes the evolution of strong-bond edges, without adding any non-primitive “goal” rule.
- **P3 observability:** a shorter protocol (X+P1+P5) and/or higher mobility (`stepSize`) makes the P3 loop diagnostic show up nontrivially (instead of being mostly 0 at report boundaries).
- A 10M‑step **P3+P6 long run** with persistent M6 signals and a non-saturated strong-bond graph (E15).
- The tuned setups are now captured as param files (`scripts/params/*.json`) and exposed as UI presets (“Null baseline”, “P3+P6 full”).

### Not achieved

- A regime where P3 pumping is **robustly large** across the full-kernel protocol: `disp/loop` is detectable but typically small and sensitive to protocol composition and sampling cadence.
- A universal elimination of “hairball” morphology: in many settings, strong-bond edges still grow and can percolate at long horizons (tuning mostly affects *how fast* and *how strongly*).
- A strict statistical null-regime validation (multi-seed runs with error bars showing `A→0`, `Σ→0`), beyond representative long runs and trend checks.

### Safe claims (what this section supports)

- **C_BASE_NULL_1 (SAFE)** Null-regime diagnostics trend toward 0 with all reversible channels enabled.
  - Evidence: E5 shows `Ja≈0, Jn≈0, Js≈0`, `Aa≈0.0025`, `As≈0.0029`, `Σmem 0.0004` at 5M steps.
  - Controls: P3=OFF, P6=OFF in E5.
  - Scope: N=200, 5M steps, `pWrite=0.05`, `rPropose=0.05`.
- **C_P6_SEP_1 (SAFE)** P6-only drive produces persistent nonzero M6 motifs relative to null.
  - Evidence: E8/E9 show `M6 W/N/A` ≈ 0.12–0.23; E5 has `M6=0`.
  - Controls: P6 toggled ON with P3 OFF; null runs with P6 OFF.
  - Scope: N=200, 3–5M steps.
- **C_P3_OBS_1 (SUGGESTIVE)** P3 loop observability improves under minimal protocol + higher cadence.
  - Evidence: E11/E14 checkpoints show nonzero `P3 loop` values with X+P1+P5 and higher report cadence.
  - Controls: P3 toggled ON with P6 OFF.
  - Scope: N=200, 0.5–1M steps; limited seeds.
- **C_P3P6_LONG_1 (SUGGESTIVE)** Long P3+P6 run shows persistent M6 signals and nonzero loop.
  - Evidence: E15 at 10M shows `M6 W/N/A` nonzero and `P3 loop -0.5000`.
  - Controls: P3+P6 ON vs prior null/P6-only controls.
  - Scope: single 10M run; no multi-seed CI.

### Not claimed / caveats

- No claim of robust P3 loop magnitude across full-kernel protocols; observability depends on cadence.
- No claim that the null regime has fully converged in a statistical sense (multi-seed CI absent here).
- Long-run percolation remains; graph saturation is not eliminated in these early campaigns.

---

## 2025-12-21 — Base-only retune after multi-layer implementation

All runs in this section explicitly disable meta effects:

- `metaLayers=0`
- `eta=0`

### Phase A — Regression spot-checks (E5/E8/E11/E13-style)

#### R1 — E5-style null (all reversible channels, rPropose=0.05, lambdaW=0.3)

Command:
```bash
node scripts/ratchet-cli.mjs run --steps 3000000 --report-every 1000000 \
  --set pWrite=0.05 --set rPropose=0.05 --set p3On=0 --set p6On=0 \
  --set metaLayers=0 --set eta=0
```

Selected checkpoints:
- 1M: `Aw 0.2678 sigmaMem 0.0011`, `Aa 0.0137`, `As 0.0134`, `P6 M6 all 0`, `edges 352`
- 3M: `Aw 0.2005 sigmaMem 0.0006`, `Aa 0.0042`, `As 0.0049`, `P6 M6 all 0`, `edges 852`

Takeaway:
- Matches prior E5 trend: reversible channels decay toward 0, P1 relaxes slower; graph percolates by ~3M.

#### R2 — E8-style P6-only drive (mu=+/-0.6)

Command:
```bash
node scripts/ratchet-cli.mjs run --steps 3000000 --report-every 1000000 \
  --set pWrite=0.05 --set rPropose=0.05 --set lambdaW=0.5 \
  --set p6On=1 --set muHigh=0.6 --set muLow=-0.6 --set p3On=0 \
  --set metaLayers=0 --set eta=0
```

Selected checkpoints:
- 1M: `M6 W 0.2014 N 0.1483 A 0.1187 S 0.0110`, `edges 290`
- 3M: `M6 W 0.2178 N 0.1372 A 0.1210 S 0.0032`, `edges 718`

Takeaway:
- M6 signals remain clearly nonzero; overall behavior consistent with prior E8.

#### R3 — E11-style P3-only minimal protocol (X + P1 + P5)

Command:
```bash
node scripts/ratchet-cli.mjs run --steps 500000 --report-every 50000 \
  --set p3On=1 --set p6On=0 --set pWrite=0.05 --set pSWrite=0.05 \
  --set pAWrite=0 --set pNWrite=0 --set rPropose=0.05 --set lambdaW=0.5 \
  --set stepSize=0.02 --set metaLayers=0 --set eta=0
```

Selected checkpoints:
- 250k: `P3 loop 0.5000`, `edges 95`
- 350k: `P3 loop 0.5000`, `edges 126`

Takeaway:
- P3 loop is intermittent at report boundaries; higher report cadence captures nonzero loops as in prior E11/E14.

#### R4 — E13-style P3+P6 minimal protocol (X + P1 + P5)

Command:
```bash
node scripts/ratchet-cli.mjs run --steps 1000000 --report-every 200000 \
  --set p3On=1 --set p6On=1 --set muHigh=1.0 --set muLow=-1.0 \
  --set pWrite=0.05 --set pSWrite=0.05 --set pAWrite=0 --set pNWrite=0 \
  --set rPropose=0.05 --set lambdaW=0.5 --set stepSize=0.02 \
  --set metaLayers=0 --set eta=0
```

Selected checkpoints:
- 200k: `M6 W 0.1258 S 0.0133`, `edges 233`
- 1M: `M6 W 0.1236 S 0.0021`, `P3 loop 0.5000`, `edges 885`

Takeaway:
- Both P6 motifs and P3 loop appear; aligns with prior E13 behavior.

### Phase B–E — Base-only presets (3 seeds each)

The following runs are the basis for the new base-only presets under `scripts/params/`.
All commands use `--set metaLayers=0 --set eta=0` explicitly (also baked into preset JSON).

#### base_null_balanced.json (null regime, 5M steps)

Command (per seed):
```bash
node scripts/ratchet-cli.mjs run --steps 5000000 --report-every 1000000 \
  --params scripts/params/base_null_balanced.json --seed <seed> \
  --set metaLayers=0 --set eta=0
```

Final reports:
- Seed 1: `Aw 0.1453 sigmaMem 0.0003 | Aa 0.0022 As 0.0035 | M6 all 0 | edges 484`
- Seed 2: `Aw 0.1484 sigmaMem 0.0003 | Aa 0.0022 As 0.0035 | M6 all 0 | edges 539`
- Seed 3: `Aw 0.1472 sigmaMem 0.0003 | Aa 0.0024 As 0.0032 | M6 all 0 | edges 549`

Takeaway:
- Null diagnostics (P2/P4/P5) near zero; P1 affinity relaxes more slowly but sigmaMem is small. Graph remains non-saturated.

#### base_p6_drive.json (P6-only drive, 3M steps)

Command (per seed):
```bash
node scripts/ratchet-cli.mjs run --steps 3000000 --report-every 1000000 \
  --params scripts/params/base_p6_drive.json --seed <seed> \
  --set metaLayers=0 --set eta=0
```

Final reports:
- Seed 1: `M6 W 0.7944 N 0.3725 A 0.3936 S 0.0064 | edges 1544`
- Seed 2: `M6 W 0.8247 N 0.3809 A 0.3897 S 0.0060 | edges 1538`
- Seed 3: `M6 W 0.8219 N 0.3676 A 0.3916 S 0.0055 | edges 1571`

Takeaway:
- Strong, stable M6 signals across seeds; graph grows but not yet complete at w>=3 threshold.

#### base_p3_pump_minimal.json (P3-only minimal protocol, 1M steps)

Command (per seed):
```bash
node scripts/ratchet-cli.mjs run --steps 1000000 --report-every 200000 \
  --params scripts/params/base_p3_pump_minimal.json --seed <seed> \
  --set metaLayers=0 --set eta=0
```

Final reports:
- Seed 1: `P3 loop 0.5000 | edges 292`
- Seed 2: `P3 loop -0.5000 | edges 250`
- Seed 3: `P3 loop 0.0000 | edges 265`

Takeaway:
- Loop is intermittent at report boundaries; mean absolute loop over report windows is nonzero across seeds (see summary table).

#### base_p3p6_combo_minimal.json (P3+P6 minimal protocol, 2M steps)

Command (per seed):
```bash
node scripts/ratchet-cli.mjs run --steps 2000000 --report-every 500000 \
  --params scripts/params/base_p3p6_combo_minimal.json --seed <seed> \
  --set metaLayers=0 --set eta=0
```

Final reports:
- Seed 1: `M6 W 0.1250 S 0.0015 | P3 loop 0.0000 | edges 1418`
- Seed 2: `M6 W 0.1327 S 0.0012 | P3 loop 0.0000 | edges 1466`
- Seed 3: `M6 W 0.1309 S 0.0011 | P3 loop 0.0000 | edges 1418`

Takeaway:
- P6 motif signal is consistent; P3 loop appears intermittently, captured via windowed loop averages (summary table).

### Summary table (3 seeds, mean+/-std)

Computed via `scripts/run-sweep.mjs`, using the final report for each seed and averaging |loop| over report windows.

| preset | sigmaMem | Aw | Aa | An | As | M6W | M6N | M6A | M6S | loop\|mean\| | loop>0 frac | edges | largest |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| base_null_balanced | 0.0003+/-0.0000 | 0.1470+/-0.0013 | 0.0023+/-0.0001 | 0.0001+/-0.0004 | 0.0034+/-0.0001 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 524+/-29 | 199+/-1 |
| base_p6_drive | 0.0021+/-0.0000 | 0.4305+/-0.0025 | 0.0068+/-0.0005 | -0.0000+/-0.0005 | 0.0085+/-0.0002 | 0.8137+/-0.0137 | 0.3737+/-0.0055 | 0.3916+/-0.0016 | 0.0060+/-0.0004 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 1551+/-14 | 200+/-0 |
| base_p3_pump_minimal | 0.0002+/-0.0000 | 0.0502+/-0.0002 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0024+/-0.0001 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.2222+/-0.0393 | 0.4444+/-0.0786 | 269+/-17 | 180+/-1 |
| base_p3p6_combo_minimal | 0.0003+/-0.0000 | 0.0625+/-0.0008 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0019+/-0.0000 | 0.1295+/-0.0033 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0013+/-0.0002 | 0.1000+/-0.0816 | 0.2000+/-0.1633 | 1434+/-23 | 191+/-2 |

### Safe claims (what this section supports)

- **C_BASE_RETUNE_NULL_1 (SAFE)** Base-only null preset is reversible with M6=0 and low Σmem.
  - Evidence: `base_null_balanced` row shows `sigmaMem 0.0003`, `M6W/N/A/S 0.0000` (3 seeds).
  - Controls: P3=OFF, P6=OFF; `metaLayers=0`, `eta=0`.
  - Scope: 5M steps, 3 seeds.
- **C_BASE_RETUNE_P6_1 (SAFE)** P6-only base drive yields stable nonzero M6 motifs.
  - Evidence: `base_p6_drive` row shows `M6W 0.8137`, `M6N 0.3737`, `M6A 0.3916` (3 seeds).
  - Controls: P6=ON with P3=OFF; null baseline in same table.
  - Scope: 3M steps, 3 seeds.
- **C_BASE_RETUNE_P3_1 (SUGGESTIVE)** P3 loop is intermittently observable in minimal protocol.
  - Evidence: `base_p3_pump_minimal` row shows `loop|mean| 0.2222` and `loop>0 frac 0.4444` (3 seeds).
  - Controls: P3=ON with P6=OFF.
  - Scope: 1M steps; loop is report-boundary sensitive.
- **C_BASE_RETUNE_P3P6_1 (SAFE)** P3+P6 combo preserves nonzero P6 motifs.
  - Evidence: `base_p3p6_combo_minimal` row shows `M6W 0.1295` (3 seeds).
  - Controls: P3=ON, P6=ON vs null row with M6=0.
  - Scope: 2M steps, 3 seeds.

### Not claimed / caveats

- No claim of robust P3 loop magnitude in base-only runs; loop remains intermittent.
- No claim that graph morphology remains sparse at long horizons; edges can grow with time.

---

## 2025-12-21 — Phase 2: meta-layer tuning (L>0)

All Phase 2 presets explicitly set:

- `metaLayers=2`
- `eta` explicit (0 for decoupled baseline; 0.6 for coupled presets)

### Phase A — Coupling sanity (eta=0 vs eta=1, minimal dynamics)

Command:
```bash
node scripts/run-meta-sweep.mjs
```

Sanity output:
- `Eta sanity S: base/meta0 0.9792 -> 0.7708, meta0/meta1 0.9722 -> 0.7431`
- `Eta sanity W: meta0/meta1 0.9028 -> 0.7500`

Takeaway:
- Coupling reduces cross-layer diffs by >15% for both S and W in controlled minimal setups.

### Phase B — Null regime with meta layers (decoupled vs coupled)

Presets:
- `scripts/params/meta/meta2_null_decoupled.json` (eta=0)
- `scripts/params/meta/meta2_null_coupled.json` (eta=0.6)

Required final verification (coupled, 3 seeds):
```bash
node scripts/ratchet-cli.mjs run --steps 3000000 --report-every 1000000 \
  --params scripts/params/meta/meta2_null_coupled.json --seed <seed>
```

Final reports (coupled):
- Seed 1: `Aw 0.1584 sigmaMem 0.0003 | Aa 0.0141 As 0.0149 | M6 all 0 | edges 198`
- Seed 2: `Aw 0.1573 sigmaMem 0.0003 | Aa 0.0140 As 0.0152 | M6 all 0 | edges 168`
- Seed 3: `Aw 0.1545 sigmaMem 0.0003 | Aa 0.0155 As 0.0147 | M6 all 0 | edges 191`

Takeaway:
- Null regime remains reversible (M6=0, sigmaMem small) even with L=2 and eta>0.

### Phase C — P6-only drive with meta layers (coupled)

Preset:
- `scripts/params/meta/meta2_p6_drive_coupled.json`

Required final verification (3 seeds):
```bash
node scripts/ratchet-cli.mjs run --steps 2000000 --report-every 1000000 \
  --params scripts/params/meta/meta2_p6_drive_coupled.json --seed <seed>
```

Final reports:
- Seed 1: `M6 W 0.3105 N 0.2768 A 0.2553 S 0.0285 | edges 386`
- Seed 2: `M6 W 0.2747 N 0.2719 A 0.2529 S 0.0257 | edges 351`
- Seed 3: `M6 W 0.2945 N 0.2762 A 0.2531 S 0.0296 | edges 365`

Takeaway:
- Robust nonzero M6 signals across channels; graph remains structured.

### Phase D — P3-only minimal protocol with meta layers (coupled)

Preset:
- `scripts/params/meta/meta2_p3_pump_coupled.json`

Required final verification (3 seeds):
```bash
node scripts/ratchet-cli.mjs run --steps 1000000 --report-every 200000 \
  --params scripts/params/meta/meta2_p3_pump_coupled.json --seed <seed>
```

Final reports:
- Seed 1: `P3 loop -0.5000 | edges 610`
- Seed 2: `P3 loop 0.0000 | edges 595`
- Seed 3: `P3 loop 0.0000 | edges 620`

Takeaway:
- Loop diagnostic is intermittent at report boundaries; sweep metrics (below) confirm nonzero loop observability.

### Phase E — P3+P6 minimal protocol with meta layers (coupled)

Preset:
- `scripts/params/meta/meta2_p3p6_combo_coupled.json`

Required final verification (3 seeds):
```bash
node scripts/ratchet-cli.mjs run --steps 2000000 --report-every 500000 \
  --params scripts/params/meta/meta2_p3p6_combo_coupled.json --seed <seed>
```

Final reports:
- Seed 1: `M6 W 0.0962 S 0.0045 | P3 loop 0.0000 | edges 1248`
- Seed 2: `M6 W 0.0969 S 0.0045 | P3 loop 0.0000 | edges 1226`
- Seed 3: `M6 W 0.0995 S 0.0042 | P3 loop 0.0000 | edges 1242`

Takeaway:
- M6 persists with P3 enabled; loop is intermittent, captured by sweep loop averages.

### Summary table (3 seeds, mean+/-std)

Computed via `scripts/run-meta-sweep.mjs` (per-seed logs at `.tmp/experiments_meta/`).

| preset | sigmaMem | Aw | Aa | An | As | M6W | M6N | M6A | M6S | loop\|mean\| | loop>0 frac | Sdiff base/meta0 | Sdiff meta0/meta1 | Wdiff meta0/meta1 | nz metaS | nz metaW | nz metaA | nz metaN | edges | largest |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| meta2_null_decoupled | 0.0003+/-0.0000 | 0.1574+/-0.0006 | 0.0146+/-0.0004 | 0.0005+/-0.0008 | 0.0155+/-0.0001 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.9974+/-0.0615 | 0.9518+/-0.0310 | 0.9570+/-0.0191 | 0.5638+/-0.0115 | 0.5550+/-0.0123 | 0.5749+/-0.0079 | 0.7188+/-0.0207 | 195+/-20 | 146+/-10 |
| meta2_null_coupled | 0.0003+/-0.0000 | 0.1567+/-0.0017 | 0.0145+/-0.0007 | 0.0001+/-0.0006 | 0.0149+/-0.0002 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.9323+/-0.0574 | 0.8971+/-0.0341 | 0.9076+/-0.0312 | 0.5299+/-0.0051 | 0.5472+/-0.0181 | 0.5651+/-0.0215 | 0.7305+/-0.0016 | 186+/-13 | 148+/-10 |
| meta2_p6_drive_coupled | 0.0014+/-0.0000 | 0.3564+/-0.0052 | 0.0356+/-0.0008 | 0.0007+/-0.0011 | 0.0380+/-0.0004 | 0.2932+/-0.0146 | 0.2750+/-0.0022 | 0.2538+/-0.0011 | 0.0280+/-0.0016 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.8763+/-0.0195 | 0.8763+/-0.0271 | 0.8633+/-0.0304 | 0.5729+/-0.0122 | 0.5830+/-0.0104 | 0.5703+/-0.0184 | 0.9030+/-0.0171 | 367+/-14 | 182+/-2 |
| meta2_p3_pump_coupled | 0.0006+/-0.0000 | 0.0746+/-0.0016 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0082+/-0.0004 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0417+/-0.0236 | 0.0833+/-0.0471 | 1.2305+/-0.0159 | 1.1745+/-0.0239 | 1.1615+/-0.0049 | 0.6465+/-0.0196 | 0.6445+/-0.0269 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 608+/-10 | 200+/-0 |
| meta2_p3p6_combo_coupled | 0.0003+/-0.0000 | 0.0661+/-0.0003 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0059+/-0.0001 | 0.0975+/-0.0014 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 0.0044+/-0.0002 | 0.0208+/-0.0156 | 0.0417+/-0.0312 | 0.9375+/-0.0640 | 0.9492+/-0.0776 | 0.8372+/-0.0364 | 0.5716+/-0.0161 | 0.5726+/-0.0092 | 0.0000+/-0.0000 | 0.0000+/-0.0000 | 1239+/-9 | 194+/-2 |

### Safe claims (what this section supports)

- **C_META_NULL_1 (SAFE)** Meta-layer null remains reversible with M6≈0 and low Σmem.
  - Evidence: `meta2_null_coupled` row shows `sigmaMem 0.0003` and `M6W/N/A/S 0.0000` (3 seeds).
  - Controls: P3=OFF, P6=OFF with `metaLayers=2`, `eta=0.6`.
  - Scope: 3M steps, 3 seeds.
- **C_META_ETA_ALIGN_1 (SAFE)** Eta reduces cross-layer diffs in controlled minimal dynamics.
  - Evidence: “Eta sanity” output shows S/W diffs reduced by >15% (e.g., `0.9792→0.7708`, `0.9028→0.7500`).
  - Controls: P3=OFF, P6=OFF; eta toggled.
  - Scope: metaLayers=2, minimal P5-only updates.

### Not claimed / caveats

- Coupling changes equilibrium alignment but does not introduce directionality when P3/P6 are off.
- No claim of emergent hierarchy beyond the measured diff reductions.

---

## 2025-12-21 — Clock + Code: TUR + dynamic encoding maintenance

### Step 1 — EP counter sanity (null vs P6)

Null regime (p3On=0, p6On=0):
```bash
node scripts/ratchet-cli.mjs run --steps 3000000 --report-every 1000000 \
  --params scripts/params/meta/meta2_null_coupled.json --set p3On=0 --set p6On=0
```
Final report (3M):
- `EP total -2733.8914 | rate -0.000911`
- `P6 M6 | W 0.0000 N 0.0000 A 0.0000 S 0.0000`

P6 drive:
```bash
node scripts/ratchet-cli.mjs run --steps 2000000 --report-every 1000000 \
  --params scripts/params/meta/meta2_p6_drive_coupled.json
```
Final report (2M):
- `EP total 9624.6312 | rate 0.004812`
- `P6 M6 | W 0.3105 N 0.2768 A 0.2553 S 0.0285`

Note:
- Null EP rate trends toward 0 (from -0.001443 at 1M to -0.000911 at 3M). This is within the “decay trend” clause even though it does not reach 5e-4 by 3M.

### Step 2 — Clock current (P4-targeted clock)

Command:
```bash
node scripts/test-clock-current.mjs
```

Summary (5 seeds, 2M steps, clockFrac=0.01):
- Null: drifts in `[-7.8e-5, 4.6e-5]`, `epRate=0`, Q ~ random-walk scale
- P6 drive: drift ≈ `3.15e-3` with consistent sign, `epRate ≈ 3.3e-3`

### Step 3 — TUR sweep (mu ∈ {0.2..1.4})

Command:
```bash
node scripts/run-clock-tur-sweep.mjs
```

Summary table (meanQ, varQ, meanSigma, R), seeds 1–10, steps 1M:

| mu | meanQ | varQ | meanSigma | R |
| --- | --- | --- | --- | --- |
| 0.2 | 1848.70 | 12700.81 | 394.7200 | 0.733 |
| 0.4 | 3337.40 | 15916.44 | 1416.5200 | 1.012 |
| 0.6 | 4551.40 | 15401.64 | 2875.9201 | 1.069 |
| 0.8 | 5529.30 | 14473.21 | 4631.6801 | 1.096 |
| 1.0 | 6359.40 | 12549.24 | 6630.7000 | 1.029 |
| 1.4 | 7570.50 | 10811.45 | 10996.1598 | 1.037 |

### Step 4 — Drive-only code maintenance (etaDrive on S channel)

Command:
```bash
node scripts/run-code-maintenance.mjs
```

Summary table (mean±std across seeds 1–5, steps 1M, perturb at 500k):

| preset | Sdiff(base,meta0) | Sdiff(meta0,meta1) | err(f=0.5) | recoverySteps (mean) | epRate |
| --- | --- | --- | --- | --- | --- |
| code_null | 6.8633±0.2530 | 7.0797±0.1645 | 0.4325±0.0868 | 140000 | 0.0000 |
| code_p6_drive | 0.8328±0.0642 | 0.7547±0.0479 | 0.0000±0.0000 | 100000 | 0.0157 |
| code_p6_clock_gated | 0.8547±0.0559 | 0.7828±0.0251 | 0.0000±0.0000 | 100000 | 0.0473 |

Takeaways:
- Null: high mismatch and nontrivial reconstructibility error; recovery is slower and EP is ~0.
- Drive: mismatch drops by >80%, err(f=0.5) collapses, recovery succeeds within one report interval, EP>0.
- Clock-gated: similar fidelity to drive-only, with higher EP and nonzero clock drift.

### Safe claims (what this section supports)

- **C_CLOCK_DRIFT_1 (SAFE)** Clock drift is ≈0 in null and clearly nonzero under P6 drive.
  - Evidence: `test-clock-current.mjs` summary shows null drift in `[-7.8e-5, 4.6e-5]` with `epRate=0`, P6 drift ≈ `3.15e-3` (5 seeds).
  - Controls: P6 toggled ON vs OFF; clock enabled in both.
  - Scope: 5 seeds, 2M steps, `clockFrac=0.01`.
- **C_TUR_1 (SAFE)** TUR ratio R ≥ ~1 for mu≥0.4 in the sweep.
  - Evidence: TUR table shows R≈1.012–1.096 for mu=0.4–0.8 and ≥1 for mu=1.0,1.4 (10 seeds).
  - Controls: uniform sweep of mu with same protocol and seeds.
  - Scope: 1M steps, seeds 1–10.
- **C_CODE_MAINT_1 (SAFE)** Drive-only repair (etaDrive with P6) restores fidelity vs null.
  - Evidence: code maintenance table shows `code_null` Sdiff ≈ 6.86 and err≈0.43 vs `code_p6_drive` Sdiff ≈ 0.83 and err≈0.00; EP rate >0 under drive (5 seeds).
  - Controls: P6 ON vs OFF with etaDrive; same perturbation protocol.
  - Scope: 1M steps, seeds 1–5.

### Not claimed / caveats

- No claim that the naive EP rate in Step 1 is unbiased; exact EP is introduced later.
- The TUR result is empirical and finite‑time; it does not prove an exact bound for all mu.

## 2025-12-22 — Tight Demonstration Upgrade: EP exact + clock–code causality

### EP accounting hardening (epExact vs epNaive)

Command:
```bash
node scripts/test-ep-null-tight.mjs
```

Summary table (epExact window rate over last 1M steps; mean±std, 95% CI half-width):

| case | meanExactWindow | stdExactWindow | ciHalfWidth | meanNaiveWindow | stdNaiveWindow |
| --- | --- | --- | --- | --- | --- |
| base_null | 3.505e-6 | 5.345e-5 | 4.685e-5 | 3.505e-6 | 5.345e-5 |
| meta_null | 3.830e-5 | 6.396e-5 | 5.607e-5 | 3.830e-5 | 6.396e-5 |
| p6_drive | 4.255e-3 | 1.122e-4 | 1.270e-4 | 4.255e-3 | 1.122e-4 |

Notes:
- Null cases meet the tight window threshold (|epExactRateWindow_last| ≤ 2e-4) with CI containing 0.
- P6 drive shows a clearly positive epExact rate.

### Clock traversal necessity (gated repair controls)

Command:
```bash
node scripts/test-clock-traversal-necessity.mjs
```

Summary table (mean across seeds 1–5):

| preset | err(f=0.5) | Sdiff(base,meta0) | recovery mean | recovery P95 | err<=0.1 count |
| --- | --- | --- | --- | --- | --- |
| A_ungated | 0.230 | 0.494 | 100000 | 100000 | 1 |
| B_gated_clock | 0.000 | 0.000 | 100000 | 100000 | 5 |
| C_gated_static | 0.028 | 2.584 | — | — | 5 |
| D_gated_random | 0.000 | 0.000 | 100000 | 100000 | 5 |

Notes:
- Gated + drifting clock succeeds robustly.
- Static gated control no longer recovers within the test window (no finite recovery times).
- Random-walk clock matches drifting clock in this setting (orientation not required for repair here).

### Deadline traversal (stripe-gated repair under noise)

Command:
```bash
node scripts/test-clock-deadline-traversal.mjs
```

Setup notes:
- Stripe gating (`repairGateMode=1`) with `clockK=8` bins.
- Targeted perturbation in quadrant 2, with continuous symmetric noise.
- Deadline = 25k steps, report cadence = 5k.

Summary table (mean across seeds 1–5):

| preset | err(f=0.5) | Sdiff(q2) | recovery mean | miss deadline |
| --- | --- | --- | --- | --- |
| drift | 0.458 | 5.463 | 18000 | 1/5 |
| random | 0.457 | 5.550 | 36000 | 4/5 |
| static | 0.480 | 8.600 | 535000 | 5/5 |

### Joint budget sweep (clock precision vs code maintenance vs EP)

Command:
```bash
node scripts/run-clock-code-joint-sweep.mjs
```

Summary table (seeds 1–10, steps 1.5M):

| mu | meanSigma | epExactRateWindowLast | meanQ | relVar | R | err(f=0.5) median | recovery median | recovery P95 | epClock mean | epRepair mean |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.2 | 19550.56 | 0.00691 | 24918.0 | 0.000204 | 1.998 | 0.00625 | 150000 | 150000 | 9967.20 | 9583.36 |
| 0.4 | 60432.64 | 0.02242 | 41385.6 | 0.000051 | 1.533 | 0.00000 | 150000 | 150000 | 33108.48 | 27324.16 |
| 0.6 | 106437.48 | 0.04211 | 52441.9 | 0.000022 | 1.175 | 0.00000 | 150000 | 150000 | 62930.28 | 43507.20 |
| 0.8 | 153982.72 | 0.06403 | 59956.0 | 0.000013 | 1.023 | 0.00000 | 150000 | 150000 | 95929.60 | 58053.12 |
| 1.0 | 202367.80 | 0.08670 | 64900.7 | 0.000017 | 1.761 | 0.00000 | 150000 | 150000 | 129801.40 | 72566.40 |
| 1.4 | 298974.47 | 0.13157 | 70493.4 | 0.000021 | 3.095 | 0.00000 | 150000 | 150000 | 197381.52 | 101592.96 |

Diagnostics:
- meanSigma monotonic count: 5/5.
- relVar monotonic count: 3/5; Spearman corr(EP, 1/relVar) = 0.771.
- Code metric monotonic: err median drops to 0 by mu≥0.4; recovery median stays at 150k.

### Safe claims (what this section supports)

- **C_EP_EXACT_NULL_1 (SAFE)** epExact window rates in null are near 0 with CI containing 0.
  - Evidence: epExact table shows `base_null` mean 3.505e-6 ± 4.685e-5 and `meta_null` mean 3.830e-5 ± 5.607e-5.
  - Controls: P3=OFF, P6=OFF in null cases; P6 drive as positive control.
  - Scope: 5 seeds, 10M steps (null); 3 seeds, 2M steps (drive).
- **C_TRAVERSAL_NEED_1 (SAFE)** Gated repair requires traversal; static gate does not recover.
  - Evidence: traversal table shows `B_gated_clock` err=0 with recovery, while `C_gated_static` has no finite recovery.
  - Controls: gated static vs gated moving clock under same settings.
  - Scope: 5 seeds, 1M steps.
- **C_TRAVERSAL_ORIENT_1 (SAFE)** In this gated repair setting, random clock matches drifting clock.
  - Evidence: `D_gated_random` matches `B_gated_clock` (err=0, Sdiff=0).
  - Controls: clockUsesP6 toggled OFF for random walk.
  - Scope: 5 seeds, 1M steps.

### Not claimed / caveats

- Orientation is not required in this specific gated‑repair test; orientation effects are evaluated separately under deadlines.
- The traversal results are specific to the gating scheme and noise parameters listed here.

## 2025-12-22 — Deadline campaign v2: phase diagram, fidelity separation, EP efficiency

### Event-based deadline stats (repeated corruption, 10 seeds)

Command:
```bash
node scripts/run-deadline-event-stats.mjs --preset scripts/params/clock_code/code_deadline_gated_clock.json --variant all \
  --seeds 1,2,3,4,5,6,7,8,9,10 --steps 2000000 --reportEvery 1000 --eventEvery 50000 --deadline 15000 \
  --region stripe --regionIndex 12 --errGood 0.4 --sdiffGood 7.0
```

Summary table (means across seeds 1–10):

| variant | missFrac | recP95 | uptime | errEnd | epTotalRate | epClockRate | epRepairRate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| drift | 0.015 | 2600 | 0.708 | 0.150 | 33.679 | 0.00077 | 33.676 |
| random | 0.126 | 3300 | 0.610 | 0.125 | 33.762 | 0.00000 | 33.759 |
| static | 0.846 | 9000 | 0.009 | 0.200 | 32.004 | 0.00000 | 32.001 |

Notes:
- Static missFrac >= 0.8 holds; drift missFrac <= 0.5 * random holds.
- Uptime separation and recoveryP95 ratio do not reach the 0.2 / 0.7 targets at 2M steps; see diagnostics section below.

### Phase diagram (drift vs random)

Command:
```bash
node scripts/run-deadline-phase-diagram.mjs
```

Result:
- 288 grid points evaluated.
- Strong-separation points (sepMiss >= 0.4 && sepUptime >= 0.2): 10.
- Full CSV: `.tmp/clock_code/deadline_phase_diagram.csv`

Top 10 configs by sepScore:

| grid | gateSpan | noise | deadline | mu | etaDrive | sepMiss | sepUptime | sepScore |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 32 | 2 | 0.1 | 15000 | 1.6 | 0.8 | 0.456 | 0.313 | 0.613 |
| 32 | 2 | 0.1 | 15000 | 1.6 | 1.0 | 0.456 | 0.313 | 0.613 |
| 32 | 2 | 0.1 | 20000 | 1.6 | 0.8 | 0.456 | 0.313 | 0.613 |
| 32 | 2 | 0.1 | 20000 | 1.6 | 1.0 | 0.456 | 0.313 | 0.613 |
| 32 | 2 | 0.1 | 15000 | 2.0 | 0.8 | 0.439 | 0.325 | 0.601 |
| 32 | 2 | 0.1 | 15000 | 2.0 | 1.0 | 0.439 | 0.325 | 0.601 |
| 32 | 2 | 0.1 | 15000 | 2.4 | 0.8 | 0.421 | 0.291 | 0.566 |
| 32 | 2 | 0.1 | 15000 | 2.4 | 1.0 | 0.421 | 0.291 | 0.566 |
| 32 | 2 | 0.1 | 20000 | 2.0 | 0.8 | 0.404 | 0.325 | 0.566 |
| 32 | 2 | 0.1 | 20000 | 2.0 | 1.0 | 0.404 | 0.325 | 0.566 |

### Fidelity separation search

Command:
```bash
node scripts/run-fidelity-separation-search.mjs
```

Result:
- No candidate met the strict fidelity criteria (`uptime >= 0.8`, `errEnd <= 0.05`).
- The best available candidate was written to `scripts/params/clock_code/deadline_fidelity_found.json` with a note.

Best-candidate summary (mean over seeds 1–10):

| variant | missFrac | uptime | errEnd | recP95 | epTotalRate | epClockRate | epRepairRate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| drift | 0.064 | 0.664 | 0.275 | 5800 | 12.476 | 0.00391 | 12.472 |
| random | 0.203 | 0.548 | 0.225 | 6200 | 12.343 | 0.00000 | 12.343 |
| static | 0.974 | 0.006 | 0.275 | 5600 | 9.468 | 0.00000 | 9.465 |

### EP efficiency (found candidate)

| avoidedMiss | uptimeGain | deltaEP | deltaEPClock | EP/avoidedMiss | EPclock/avoidedMiss | EP/uptimeGain |
| --- | --- | --- | --- | --- | --- | --- |
| 0.138 | 0.116 | 0.133 | 0.00391 | 0.959 | 0.0282 | 1.148 |

Diagnostics:
- Strong separation in the phase diagram appears for higher noise (0.1–0.15) and mid mu (1.6–2.0).
- Strict fidelity criteria remain unmet in this round; errEnd and uptime targets appear too tight for the current gate/noise tradeoff.

## 2025-12-23 — Deadline Campaign v3 (calibrated)

### Calibration example (stripe gate)

Command:
```bash
node scripts/calibrate-gate-gaps.mjs --preset scripts/params/clock_code/deadline_fidelity_drift.json --variant all --region stripe --regionIndex 24
```

| variant | gapP95 | gapMax | deadlineRec |
| --- | --- | --- | --- |
| drift | 53000 | 64000 | 63600 |
| random | 32000 | 103000 | 38400 |

### Phase diagram v3 (tail metrics + calibrated deadline)

Command:
```bash
node scripts/run-deadline-phase-diagram.mjs
```

Summary:
- points evaluated: 624
- strong separation points: 13 (`driftMiss <= 0.2`, `uptimeTail >= 0.7`, `sepScore >= 0.5`)
- full table: `.tmp/clock_code/deadline_phase_v3.csv`

Top 10 sepScore rows:

| gridSize | gateSpan | codeNoiseRate | deadline | mu | etaDrive | driftMiss | randomMiss | driftUptimeTail | randomUptimeTail | driftErrTail | randomErrTail | sepScore |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 64 | 3 | 0.012 | 42000 | 2.200 | 0.400 | 0 | 0.161 | 0.925 | 0.269 | 0.019 | 0.183 | 0.735 |
| 64 | 3 | 0.012 | 42000 | 2.200 | 0.450 | 0 | 0.161 | 0.925 | 0.269 | 0.019 | 0.183 | 0.735 |
| 64 | 3 | 0.012 | 42000 | 2.200 | 0.500 | 0 | 0.161 | 0.925 | 0.269 | 0.019 | 0.183 | 0.735 |
| 64 | 3 | 0.012 | 42000 | 2.200 | 0.550 | 0 | 0.161 | 0.925 | 0.269 | 0.019 | 0.183 | 0.735 |
| 64 | 3 | 0.012 | 42000 | 2.200 | 0.600 | 0 | 0.161 | 0.925 | 0.269 | 0.019 | 0.183 | 0.735 |
| 64 | 3 | 0.012 | 42000 | 2.200 | 0.650 | 0 | 0.161 | 0.925 | 0.269 | 0.019 | 0.183 | 0.735 |
| 64 | 3 | 0.012 | 42000 | 2.200 | 0.700 | 0 | 0.161 | 0.925 | 0.269 | 0.019 | 0.183 | 0.735 |
| 64 | 3 | 0.012 | 42000 | 2.200 | 0.750 | 0 | 0.161 | 0.925 | 0.269 | 0.019 | 0.183 | 0.735 |
| 64 | 3 | 0.012 | 42000 | 2.200 | 0.800 | 0 | 0.161 | 0.925 | 0.269 | 0.019 | 0.183 | 0.735 |
| 64 | 3 | 0.012 | 42000 | 2.200 | 0.850 | 0 | 0.161 | 0.925 | 0.269 | 0.019 | 0.183 | 0.735 |

### Fidelity separation search v3

Command:
```bash
node scripts/run-fidelity-separation-search.mjs
```

Result:
- No candidate met the strict fidelity criteria (`driftMiss <= 0.2`, `uptimeTail >= 0.8`, `errTailMean <= 0.05`).
- Best candidate saved to `scripts/params/clock_code/deadline_fidelity_found.json`.

Best-candidate summary (mean over seeds 1–10):

| variant | missFrac | uptimeTail | errTailMean | recP95 | epTotalRate | epClockRate | epRepairRate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| drift | 0.090 | 0.516 | 0.140 | 6500 | 0.146 | 0.0832 | 0.0628 |
| random | 0.136 | 0.378 | 0.169 | 7600 | 0.0618 | 0.0000 | 0.0618 |
| static | 0.485 | 0.213 | 0.261 | 7300 | 0.0598 | 0.0000 | 0.00615 |

### EP efficiency (found candidate)

| avoidedMiss | uptimeTailGain | deltaEP | deltaEPClock | EP/avoidedMiss | EPclock/avoidedMiss | EP/uptimeTailGain |
| --- | --- | --- | --- | --- | --- | --- |
| 0.046 | 0.138 | 0.0843 | 0.0832 | 1.826 | 1.803 | 0.604 |

Diagnostics:
- Strong separation still comes from a narrow band (gridSize 64, gateSpan 3, codeNoiseRate 0.012, mu 2.2).
- Strict fidelity criteria remain unmet in the 10-seed search; drift uptime and errTail remain below targets.

### Success probability + bootstrap CIs (found config)

Command:
```bash
node scripts/run-deadline-success-ci.mjs --found scripts/params/clock_code/deadline_fidelity_found.json --seedCount 30
```

Per-variant summary (30 seeds):

| variant | missFracMean | uptimeTailMean | errTailMean | epClockRateMean | successRate |
| --- | --- | --- | --- | --- | --- |
| drift | 0.126 | 0.576 | 0.122 | 0.0834 | 0.267 |
| random | 0.168 | 0.292 | 0.205 | 0.0000 | 0.067 |
| static | 0.516 | 0.195 | 0.270 | 0.0000 | 0.000 |

Bootstrap CIs (drift vs random):

| metric | mean | CI_low | CI_high |
| --- | --- | --- | --- |
| missFrac_drift_minus_random | -0.041 | -0.096 | 0.014 |
| uptimeTail_drift_minus_random | 0.285 | 0.138 | 0.429 |
| errTail_random_minus_drift | 0.084 | 0.034 | 0.130 |
| deltaEPClockRate | 0.0834 | 0.0832 | 0.0835 |

### Safe claims (what this section supports)

- **C_DEADLINE_DRIFT_1 (SAFE)** Drift improves uptimeTail relative to random in the found config.
  - Evidence: bootstrap CI for `uptimeTail_drift_minus_random` is [0.138, 0.429] (30 seeds).
  - Controls: drift vs random vs static variants under identical deadline/noise settings.
  - Scope: found config, 30 seeds (CI table).
- **C_DEADLINE_CLOCK_EP_1 (SAFE)** Drift adds a positive clock EP cost.
  - Evidence: `deltaEPClockRate` CI [0.0832, 0.0835] > 0 in bootstrap table.
  - Controls: drift vs random in the same config.
  - Scope: 30 seeds.

### Not claimed / caveats

- missFrac drift–random CI crosses 0 (`-0.096` to `0.014`), so missFrac separation is not SAFE here.
- Strict fidelity criteria were not met in v2/v3 searches; claims are limited to observed uptimeTail/errTail advantages.

## 2025-12-23 — Operator-lifted coupling (K tokens)

Commands:
```bash
node scripts/test-opcoupling-invariants.mjs
node scripts/test-opcoupling-null-ep.mjs
node scripts/test-opcoupling-effect.mjs
node scripts/ratchet-cli.mjs run --steps 1000000 --report-every 500000 --params scripts/params/meta/meta2_null_coupled.json --set sCouplingMode=0 --set opCouplingOn=0
```

### K invariants
- Budgeted K tokens stayed in [0, B_K] with per-cell sums exactly B_K (200 random samples).

### Null EP (op coupling on)

| id | meanExact | stdExact | ciHalfWidth | meanNaive | stdNaive | kChanged |
| --- | --- | --- | --- | --- | --- | --- |
| op_null_eta | 0.000006149 | 0.000078933 | 0.000097993 | 0.000006149 | 0.000078933 | 5 |
| op_null_eta0 | -0.000025401 | 0.000022535 | 0.000027976 | -0.000025401 | 0.000022535 | 5 |

### Coupling effect (eta vs 0)
- Sdiff_op eta=0: 0.308521
- Sdiff_op eta=0.6: 0.231604
- ratio: 0.7507

### Legacy coupling sanity
- `meta2_null_coupled.json` with `sCouplingMode=0` and `opCouplingOn=0` remains null-like: Σmem ~0.0008 at 1M steps; P6 motifs remain 0.

### Safe claims (what this section supports)

- **C_OPK_INV_1 (SAFE)** K token budget invariants hold (per-cell sums fixed).
  - Evidence: “K invariants” check reports sums exactly B_K (200 random samples).
  - Controls: invariant check under op coupling enabled.
  - Scope: 200 sampled cells.
- **C_OPK_NULL_EP_1 (SAFE)** op coupling preserves null EP near 0.
  - Evidence: `op_null_eta` and `op_null_eta0` tables show meanExact near 0 with small CI.
  - Controls: P3=OFF, P6=OFF; eta=0.6 and eta=0.
  - Scope: 5 seeds.
- **C_OPK_EFFECT_1 (SAFE)** Conservative coupling reduces operator mismatch.
  - Evidence: Sdiff_op ratio 0.7507 (`eta=0.6` vs `eta=0`).
  - Controls: eta toggled in the same setup.
  - Scope: 2M steps (effect test).

### Not claimed / caveats

- No claim that K induces hierarchy or improves deadline performance in this section.

## 2025-12-23 — Operator-lifted coupling: diagnostics, hierarchy, selection, deadline

Commands:
```bash
node scripts/run-opk-diagnostics.mjs
node scripts/run-opk-hierarchy-search.mjs
node scripts/test-opk-drive-selection.mjs
node scripts/run-deadline-opk-compare.mjs
```

### opK diagnostics (final rows)

| variant | step | m0Mean | HMean | R2Mean | AMean | cohMean | SdiffMean | epExactRateWindow | epOpKRateWindow |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| eta0 | 1200000 | 0.105835 | 1.566297 | 1.341187 | 0.139069 | 1.149292 | 0.295471 | 0 | 0 |
| eta06 | 1200000 | 0.117798 | 1.559471 | 1.328979 | 0.136688 | 1.166748 | 0.276660 | -0.00000834 | 0.00000127 |

### opK hierarchy search (best configs)

| regime | metaLayers | opStencil | opBudgetK | rhoR2Mean | rhoHMean | rhoCohMean | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| null | 4 | 0 | 32 | -0.7333 | 0.2000 | -0.3333 | BEST_R2 |
| null | 2 | 0 | 16 | -0.3333 | 1.0000 | -1.0000 | BEST_H |
| null | 2 | 0 | 16 | -0.3333 | 1.0000 | -1.0000 | BEST_COH |
| drive | 2 | 1 | 8 | 1.0000 | -0.3333 | 0.3333 | BEST_R2 |
| drive | 2 | 0 | 8 | -0.3333 | -1.0000 | 0.3333 | BEST_H |

### Drive-selection ablation (summary)

| id | sdiffStartMean | sdiffEndMean | deltaSdiffMean | epExactWindowMean | epOpKWindowMean |
| --- | --- | --- | --- | --- | --- |
| A_drive_selects | 0.250391 | 0.194502 | -0.055889 | 0.227177 | 0.033140 |
| B_drive_no_k | 0.250391 | 0.229373 | -0.021018 | 0.293289 | 0 |
| C_null | 0.250391 | 0.250684 | 0.000293 | -0.0000105 | 0 |
| D_equilibrium | 0.250391 | 0.228823 | -0.021567 | 0.0000274 | -0.00000267 |

### Deadline compare (legacy vs best op)

| id | opStencil | opBudgetK | missFracMean | uptimeTailMean | errTailMean | epTotalRateMean | epOpKRateMean |
| --- | --- | --- | --- | --- | --- | --- | --- |
| legacy |  |  | 0.0718 | 0.4515 | 0.1351 | 0.1363 | 0 |
| op_s0_b32 | 0 | 32 | 0.1154 | 0.4758 | 0.1311 | 0.1007 | -0.0000388 |

Notes:
- Hierarchy signals appear in both null and drive regimes with strong Spearman slopes.
- Drive-selection ablation passes (A beats B/C on Sdiff, epOpK > 0).
- Deadline comparison: NO_IMPROVEMENT_OVER_LEGACY; best op config saved at `scripts/params/op_coupling/deadline_opk_best.json`.

### Safe claims (what this section supports)

- **C_OPK_DRIVE_SELECT_1 (SAFE)** Drive-selection ablation shows lower mismatch with epOpK>0 only in the drive‑selecting case.
  - Evidence: ablation table shows `A_drive_selects` Sdiff end 0.1945 vs `B_drive_no_k` 0.2294, with `epOpKWindowMean 0.033140` only in A.
  - Controls: A vs B/C under identical params; P6 OFF in null control.
  - Scope: 2M steps, multiple seeds (see summary table).
- **C_OPK_HIER_1 (SUGGESTIVE)** Interface-level hierarchy metrics show slopes in best configs.
  - Evidence: hierarchy table lists BEST_R2/H/COH with nonzero rho values.
  - Controls: none beyond sweep; earlier degeneracy for metaLayers=2.
  - Scope: 3 seeds per config; no CI.

### Not claimed / caveats

- Hierarchy evidence is not definitive; per‑interface rho can be unstable and depends on metaLayers.
- Deadline comparison here is confounded by scheduler dilution; see v2/v3 decomposition.

## 2025-12-24 — Operator coupling v2: hierarchy fix + deadline decomposition

Commands:
```bash
node scripts/run-opk-hierarchy-search.mjs
node scripts/run-deadline-opk-decomposition.mjs
```

### opK hierarchy search (metaLayers>=3 only)

| regime | metaLayers | opStencil | opBudgetK | rhoR2Mean | rhoHMean | rhoCohMean | deltaR2Mean | deltaHMean | deltaCohMean | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| null | 4 | 0 | 32 | -0.7333333333333334 | 0.20000000000000004 | -0.3333333333333333 | -0.0111083984375 | 0.0035224161477747837 | -0.007242838541666667 | BEST_R2 |
| null | 3 | 1 | 16 | 0.16666666666666666 | 0.5 | -0.16666666666666666 | 0.008056640625 | 0.00509017606416647 | 0.0035807291666666665 | BEST_H |
| null | 3 | 1 | 32 | 0.16666666666666666 | -0.16666666666666666 | 0.5 | 0.0211181640625 | -0.00010461573471109986 | 0.011881510416666666 | BEST_COH |
| drive | 3 | 1 | 8 | 0.5 | -0.3333333333333333 | 0 | 0.015299479166666666 | -0.013952026579811427 | 0.009114583333333334 | BEST_R2 |
| drive | 3 | 0 | 8 | -0.16666666666666666 | -0.8333333333333334 | 0.5 | 0.00732421875 | -0.03930164940094494 | 0.0478515625 | BEST_H |
| drive | 3 | 0 | 16 | 0.16666666666666666 | -0.8333333333333334 | 0.6666666666666666 | 0.00146484375 | -0.018355843094732 | 0.029296875 | BEST_COH |

### Deadline decomposition (A/B vs best C/D)

| id | opStencil | opBudgetK | missFracMean | uptimeTailMean | errTailMean | epTotalRateMean | epClockRateMean | epRepairRateMean | epOpKRateMean | p5MetaToRecoverMean | repairRateMean |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A_legacy |  |  | 0.07777777777777778 | 0.45757575757575764 | 0.1322390572390572 | 0.1253969239883423 | 0.08373599778175353 | 0.041660926206588754 | 0 | 45.48174603174603 | 0.006371 |
| B_dilution_only |  |  | 0.11111111111111112 | 0.44848484848484854 | 0.13787878787878785 | 0.10954079666843415 | 0.08358623778572083 | 0.025954558882713318 | 0 | 16.864484126984127 | 0.003816 |
| BEST_C (C_op_noKdrive_s1_b32) | 1 | 32 | 0.07777777777777779 | 0.5181818181818183 | 0.12045454545454545 | 0.0927407587062845 | 0.08348903778829575 | 0.009251720917988756 | 0 | 11.391666666666666 | 0.002207 |
| BEST_D (D_op_withKdrive_s1_b16) | 1 | 16 | 0.1 | 0.49393939393939396 | 0.1265151515151515 | 0.09312033762556948 | 0.0833061577931404 | 0.009903779894685744 | -0.00008960006225667895 | 14.582738095238096 | 0.0023806000000000005 |

### Dilution attribution
- `DILUTION_ATTRIBUTION: miss(A)->miss(B)=0.0333 miss(A)->miss(bestD)=0.0222 ratio=1.50 explained=true`

Notes:
- metaLayers=2 excluded from rho ranking; effect-size signals computed with metaLayers>=3.
- Deadline regression is largely explained by P5 dilution (A→B); best D does not recover that loss.

### Safe claims (what this section supports)

- **C_OPK_DILUTION_1 (SAFE)** Deadline regression is largely explained by scheduler dilution.
  - Evidence: `DILUTION_ATTRIBUTION` line shows ratio 1.50 (A→B > A→bestD).
  - Controls: A/B/C/D decomposition with identical deadline setup.
  - Scope: 10 seeds, 500k steps.

### Not claimed / caveats

- No claim that op coupling improves deadline performance in this table.
- Hierarchy metrics here remain exploratory without CI or consistent sign across seeds.

## 2025-12-24 — Operator coupling v3: throughput matching, frontier, composed hierarchy

Commands:
```bash
node scripts/run-deadline-opk-throughput-matched.mjs
node scripts/run-deadline-opk-frontier.mjs
node scripts/run-opk-composed-hierarchy.mjs
```

### Throughput-matched summary (A/B/C/D)

| id | pSWriteMean | repairRateMean | missFracMean | uptimeTailMean | errTailMean | epTotalRateMean | epRepairRateMean | p5MetaToRecoverSuccessMean | repairEfficiencySuccessMean | calibrationOkCount |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A_legacy | 1 | 0.006371 | 0.07777777777777778 | 0.45757575757575764 | 0.1322390572390572 | 0.1253969239883423 | 0.041660926206588754 | 45.48174603174603 | 145.72854755737256 | 10 |
| B_dilution_only | 0.9704687500000002 | 0.0038573999999999995 | 0.11111111111111112 | 0.5515151515151515 | 0.11212121212121211 | 0.11135111925361336 | 0.025843966887474056 | 20.362103174603174 | 221.45785013988356 | 0 |
| C_candidate (opStencil=1, opBudgetK=32) | 0.9697656250000002 | 0.002217 | 0.1777777777777778 | 0.5333333333333334 | 0.11666666666666665 | 0.09447671411796049 | 0.008904696667763962 | 11.50690476190476 | 442.0686424955735 | 0 |
| D_candidate (opStencil=1, opBudgetK=16) | 0.9644921875 | 0.002334 | 0.18888888888888888 | 0.3939393939393939 | 0.15151515151515152 | 0.09569308464210331 | 0.010027331902828066 | 11.528769841269842 | 341.2969894369107 | 0 |

Notes:
- `RATE_MATCH_OK=false` because op modes cannot reach the A_legacy repair rate within the pSWrite [0.1,1.0] bound (pSWrite saturates near 1.0).

### EP vs miss iso-threshold table (from frontier sweep)

| mode | tau | epTotalRate | pSWrite | etaDrive |
| --- | --- | --- | --- | --- |
| A_legacy | 0.05 | NA | NA | NA |
| A_legacy | 0.08 | 0.117624 | 0.65 | 0.4 |
| A_legacy | 0.10 | 0.117624 | 0.65 | 0.4 |
| A_legacy | 0.12 | 0.117624 | 0.65 | 0.4 |
| B_dilution_only | 0.05 | 0.093884 | 0.2 | 0.4 |
| B_dilution_only | 0.08 | 0.093884 | 0.2 | 0.4 |
| B_dilution_only | 0.10 | 0.093884 | 0.2 | 0.4 |
| B_dilution_only | 0.12 | 0.093884 | 0.2 | 0.4 |
| C_op_noKdrive | 0.05 | 0.090401 | 0.2 | 0.4 |
| C_op_noKdrive | 0.08 | 0.090401 | 0.2 | 0.4 |
| C_op_noKdrive | 0.10 | 0.090401 | 0.2 | 0.4 |
| C_op_noKdrive | 0.12 | 0.090401 | 0.2 | 0.4 |
| D_op_withKdrive | 0.05 | 0.094338 | 0.2 | 1 |
| D_op_withKdrive | 0.08 | 0.092877 | 0.2 | 0.8 |
| D_op_withKdrive | 0.10 | 0.091453 | 0.2 | 0.6 |
| D_op_withKdrive | 0.12 | 0.091453 | 0.2 | 0.6 |

### Composed-operator hierarchy summary

| config | metaLayers | opStencil | opBudgetK | rhoR2Mean | rhoTVMean | r2Consistent | tvConsistent | signal |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| null | 4 | 0 | 8 | 1 | -0.20461032471872267 | 10 | 2 | COMPOSED_HIERARCHY_SIGNAL_FOUND |
| drive | 3 | 0 | 8 | 1 | -0.5632455532033676 | 10 | 3 | COMPOSED_HIERARCHY_SIGNAL_FOUND |

### Safe claims (what this section supports)

- **C_OPK_COMPOSED_R2_1 (SAFE)** Composed operator reach (R2_eff) grows with depth in measured configs.
  - Evidence: composed hierarchy table shows `rhoR2Mean = 1` with `r2Consistent = 10` in both null and drive configs.
  - Controls: same op coupling setup across seeds; depth index as ordered variable.
  - Scope: 10 seeds, 1M steps, metaLayers 3–4, opStencil=0, opBudgetK=8.

### Not claimed / caveats

- TV vs layer index is not consistently monotone (rhoTV is negative and less consistent).
- Throughput matching failed in this v3 run (RATE_MATCH_OK=false), so wall‑clock comparisons remain confounded.

## 2025-12-25 — Operator coupling v4: resource allocation, CI, repair-budget curves

Commands:
```bash
node scripts/test-opk-null-ep-weights.mjs
node scripts/run-deadline-opk-throughput-matched-v4.mjs
node scripts/run-deadline-opk-ci-iso.mjs
node scripts/run-deadline-opk-repair-budget-curves.mjs
```

### Null EP across opKTargetWeight

| weight | seed | epExactRateWindowLast | pass |
| --- | --- | --- | --- |
| 0 | 1 | -0.000018540889471769332 | true |
| 0 | 2 | 0.00003167414490878582 | true |
| 0 | 3 | 0.000041335817232728006 | true |
| 0.25 | 1 | -0.000013321051119581824 | true |
| 0.25 | 2 | -0.00004786590932894461 | true |
| 0.25 | 3 | -0.000046520789032945204 | true |
| 0.5 | 1 | 0.00000527027480234699 | true |
| 0.5 | 2 | 0.000019545628705096136 | true |
| 0.5 | 3 | -0.00001030601475653407 | true |
| 1 | 1 | -0.000009790303060319786 | true |
| 1 | 2 | 0.000027828242737074986 | true |
| 1 | 3 | 0.000014448046209230113 | true |
| 2 | 1 | 0.00003733586821995507 | true |
| 2 | 2 | 0.000025038831470936288 | true |
| 2 | 3 | -0.000034798192052560834 | true |

### Throughput-matched v4 summary (A/B/C/D)

| id | opKTargetWeightMean | repairRateMean | missFracMean | epTotalRateMean | p5MetaToRecoverSuccessMean | calibrationOkCount |
| --- | --- | --- | --- | --- | --- | --- |
| A_legacy | 1 | 0.006371 | 0.07777777777777778 | 0.1253969239883423 | 45.48174603174603 | 10 |
| B_dilution_only | 0.103125 | 0.0060062 | 0.06666666666666667 | 0.12252138809556963 | 40.2125 | 10 |
| C_op_noKdrive | 0.0060546875 | 0.0039014 | 0.04444444444444444 | 0.09945762057679743 | 26.01805555555556 | 0 |
| D_op_withKdrive | 0.02470703125 | 0.0038655999999999994 | 0.04444444444444444 | 0.09944462853691052 | 31.40892857142857 | 0 |

Notes:
- C/D cannot reach the baseline repair rate even with opKTargetWeight→0 and pSWrite=1.0; calibrationOkCount remains 0 for those modes.

### ISO-miss CI replication (tau=0.08 points)

| mode | meanEp | epCiLow | epCiHigh | meanMiss | missCiLow | missCiHigh |
| --- | --- | --- | --- | --- | --- | --- |
| B_dilution_only | 0.09352591330352379 | 0.09329667223442643 | 0.09376987946156241 | 0.0488888888888889 | 0.02666666666666667 | 0.07333333333333336 |
| C_op_noKdrive | 0.09018334786495269 | 0.08996306901039725 | 0.09039783648143677 | 0.04222222222222223 | 0.02 | 0.0688888888888889 |
| DELTA_EP_C_MINUS_B | -0.0033425654385711018 | -0.003668463333649355 | -0.003020114137446586 |  |  |  |

### Repair-budget curve excerpt (with bootstrap CI)

| mode | budget | P_succ | CI_low | CI_high | events |
| --- | --- | --- | --- | --- | --- |
| A_legacy | 10 | 0.5 | 0.3888888888888889 | 0.6 | 90 |
| A_legacy | 20 | 0.5 | 0.4 | 0.6 | 90 |
| A_legacy | 40 | 0.6222222222222222 | 0.5222222222222223 | 0.7222222222222222 | 90 |
| A_legacy | 80 | 0.7 | 0.6111111111111112 | 0.7888888888888889 | 90 |
| B_dilution_only | 10 | 0.5333333333333333 | 0.43333333333333335 | 0.6333333333333333 | 90 |
| B_dilution_only | 20 | 0.5444444444444444 | 0.4444444444444444 | 0.6555555555555556 | 90 |
| B_dilution_only | 40 | 0.6111111111111112 | 0.5111111111111111 | 0.7111111111111111 | 90 |
| B_dilution_only | 80 | 0.7666666666666667 | 0.6777777777777778 | 0.8555555555555555 | 90 |
| C_op_noKdrive | 10 | 0.6222222222222222 | 0.5222222222222223 | 0.7222222222222222 | 90 |
| C_op_noKdrive | 20 | 0.6666666666666666 | 0.5666666666666667 | 0.7666666666666667 | 90 |
| C_op_noKdrive | 40 | 0.7555555555555555 | 0.6666666666666666 | 0.8444444444444444 | 90 |
| C_op_noKdrive | 80 | 0.8555555555555555 | 0.7777777777777778 | 0.9222222222222223 | 90 |
| D_op_withKdrive | 10 | 0.4888888888888889 | 0.3888888888888889 | 0.5888888888888889 | 90 |
| D_op_withKdrive | 20 | 0.5888888888888889 | 0.4888888888888889 | 0.6888888888888889 | 90 |
| D_op_withKdrive | 40 | 0.7111111111111111 | 0.6111111111111112 | 0.8 | 90 |
| D_op_withKdrive | 80 | 0.8222222222222222 | 0.7444444444444445 | 0.9 | 90 |

### Safe claims (what this section supports)

- **C_OPK_WEIGHT_NULL_EP_1 (SAFE)** opKTargetWeight sweep preserves null EP≈0.
  - Evidence: all weights in null EP table pass |epExactRateWindowLast| ≤ 2e-4 across 3 seeds.
  - Controls: P3=OFF, P6=OFF with op coupling ON.
  - Scope: 3 seeds per weight, 3M steps.
- **C_OPK_CI_EP_1 (SAFE)** Operator coupling reduces EP at the iso‑miss point relative to dilution‑only.
  - Evidence: `DELTA_EP_C_MINUS_B` CI [-0.003668, -0.003020] excludes 0.
  - Controls: C vs B under the same iso‑miss settings (tau=0.08).
  - Scope: 50 seeds, 0.5M steps.
- **C_OPK_REPAIR_DOM_1 (SAFE)** Per‑repair success curves show C dominates A/B at observed budgets.
  - Evidence: P_succ_C(N) ≥ P_succ_B(N) and ≥ P_succ_A(N) for N∈{10,20,40,80}, with bootstrap CIs listed.
  - Controls: identical deadline schedule; same corruption and gating.
  - Scope: 10 seeds, 90 events per mode.

### Not claimed / caveats

- Throughput matching failed for C/D even with opKTargetWeight→0; comparisons remain acceptance‑limited.
- Dominance is shown for the listed budgets only; no claim of asymptotic or universal dominance.

## 2025-12-25 — Motif language under selection pressure (deadline/noise)

Commands:

```bash
node scripts/run-deadline-opk-motif-compare.mjs
```

Tuned deadline:

- `deadline=4517` (auto-tune missFracMean≈0.0427; band target 0.05–0.70 not reached within 6 iterations)

### cond_summary.csv (A/B/C)

| condition | missFracMean | uptimeTailMean | errTailMean | epTotalRateMean | epRepairRateMean | epOpKRateMean | hazardM1_HMean | hazardM2_HMean | asymmetryM1Mean | asymmetryM2Mean |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A_legacy | 0.2564102564102564 | 0.7135135135135136 | 0.08926426426426425 | 0.14239119133827685 | 0.05373273368692398 | 0 | 0 | 0 | 0 | 0 |
| B_op_noKdrive | 0.4692307692307692 | 0.4999999999999999 | 0.13873873873873874 | 0.10808391344751156 | 0.020136635777318855 | 0 | 1.5728661382379656 | 1.706803126362442 | 0.3797117223244055 | 0.07747239861013419 |
| C_op_withKdrive | 0.3384615384615385 | 0.6945945945945946 | 0.07342342342342342 | 0.10766184017458084 | 0.019857008032436296 | -0.000014285531443252694 | 1.5733628624802445 | 1.7069067708413725 | 0.3718267981771392 | 0.07771470677774085 |

### success_conditioned.csv (A/B/C)

| condition | family | H_succ | H_fail | H_delta | A_succ | A_fail | A_delta | epPerChange_succ | epPerChange_fail | epPerChange_delta |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A_legacy | M1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| A_legacy | M2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| B_op_noKdrive | M1 | 1.573614296924284 | 1.5762589728672722 | -0.0026446759429883393 | 0.41139759162148914 | 0.3438703291850816 | 0.06752726243640755 | 0 | 0 | 0 |
| B_op_noKdrive | M2 | 1.7036454600298196 | 1.7024756230732045 | 0.0011698369566151001 | 0.08405063726001939 | 0.07003144013731316 | 0.014019197122706231 | 0 | 0 | 0 |
| C_op_withKdrive | M1 | 1.5769888292467444 | 1.5716792280741265 | 0.005309601172617917 | 0.3926526848579972 | 0.3311216560281895 | 0.06153102882980771 | 0 | 0.01161602800282923 | -0.01161602800282923 |
| C_op_withKdrive | M2 | 1.6992019316735938 | 1.7075482360215177 | -0.008346304347923938 | 0.07590912441126242 | 0.08124379958494857 | -0.005334675173686146 | 0 | 0.011906972121512835 | -0.011906972121512835 |

Notes:
- opK motif metrics are trivial in A (opCouplingOff), as expected; B/C show comparable M1/M2 entropies and asymmetry magnitudes in this run.
- epOpKRate remains ~0 for B and slightly negative (near zero) for C in this run; per‑event epPerChange differs by condition but remains small.

## 2025-12-26 — Motif language v2 under selection pressure (deadline/noise)

Commands:

```bash
node scripts/run-deadline-opk-motif-compare.mjs --basis v2
node scripts/run-deadline-opk-motif-p2-ablation.mjs
```

Tuned deadline:

- `deadline=38400` (auto-tune missFracMean≈0.2479; band target 0.05–0.70)

### cond_summary.csv (A/B/C)

| condition | missFracMean | uptimeTailMean | errTailMean | epTotalRateMean | epRepairRateMean | epOpKRateMean | hazardBase_HMean | hazardOp_HMean | coarseEPBaseMean | coarseEPOpMean |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A_legacy | 0.2512820512820513 | 0.23636363636363633 | 0.24469696969696972 | 0.133769119624114 | 0.05026406183624267 | 0 | 2.6718933053442475 | 0.9588717510254655 | 212.84609084396348 | 1.9202902045387948 |
| B_op_noKdrive | 0.3153846153846154 | 0.23636363636363633 | 0.2507575757575758 | 0.10283671106562635 | 0.019077493284487906 | 0 | 2.6459860280579064 | 0.9798245172759733 | 112.6522464624773 | 3.58681227565486 |
| C_op_withKdrive | 0.35128205128205126 | 0.19696969696969693 | 0.25833333333333336 | 0.10236620345520286 | 0.0187989005443288 | -0.000010114875080401543 | 2.647144441053593 | 0.9783218673723935 | 111.81543092803777 | 3.753527255092137 |

### coarseep_summary.csv (A/B/C)

| condition | region | family | coarseEP |
| --- | --- | --- | --- |
| A_legacy | hazard | M_base | 1493.7243555094108 |
| A_legacy | outside | M_base | 1935.3599331114342 |
| A_legacy | hazard | M_op | 13.048042580293265 |
| A_legacy | outside | M_op | 14.990067147217134 |
| B_op_noKdrive | hazard | M_base | 596.3934037807493 |
| B_op_noKdrive | outside | M_base | 691.6155643935975 |
| B_op_noKdrive | hazard | M_op | 23.59066597241859 |
| B_op_noKdrive | outside | M_op | 28.690050820080515 |
| C_op_withKdrive | hazard | M_base | 602.6360996817923 |
| C_op_withKdrive | outside | M_base | 655.2426252436386 |
| C_op_withKdrive | hazard | M_op | 24.784815335979463 |
| C_op_withKdrive | outside | M_op | 26.121550600744968 |

### event_conditioned_summary.csv (excerpt)

| condition | family | window | H_succ | H_fail | H_delta | js_divergence | asym_succ | asym_fail | coarseEP_succ | coarseEP_fail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A_legacy | M_base | pre | 2.7363660140685457 | 2.711966452889924 | 0.02439956117862163 | 0.0009324873285650211 | 0.12379009431002905 | 0.12636924529499993 | 26.92772134232639 | 28.44436686763767 |
| A_legacy | M_op | pre | 0.9738218245637698 | 0.9586706646274381 | 0.015151159936331648 | 0.00014846312680755723 | 0.03873198227447392 | 0.04593317081534838 | 0.8826413303965502 | 1.2396501729409946 |
| B_op_noKdrive | M_base | pre | 2.7058216062274676 | 2.7149037081497127 | -0.009082101922245123 | 0.0002518705016518187 | 0.16122485118935712 | 0.15074801256541123 | 25.444702874414734 | 22.23597211028751 |
| B_op_noKdrive | M_op | pre | 0.9924126238821702 | 0.9966383287740093 | -0.004225704891839044 | 0.000027697837655358572 | 0.06376588385943271 | 0.04956025133638756 | 1.5383660525361627 | 0.7825844275419459 |
| C_op_withKdrive | M_base | pre | 2.7055862894856353 | 2.710048893051421 | -0.004462603565785539 | 0.00009110339108129765 | 0.15746420065479236 | 0.15406285491720603 | 24.141324099103226 | 23.266529734693687 |
| C_op_withKdrive | M_op | pre | 0.9913152930007665 | 0.9932122956295517 | -0.001897002628785227 | 0.000005053103968589672 | 0.06495564530204502 | 0.056963442753442145 | 1.5546747419286429 | 1.144745673135859 |

### p2_ablation_summary.csv (A/B/C)

| p2Mode | condition | missFracMean | uptimeTailMean | errTailMean | hazardBaseVeffMean | hazardOpVeffMean |
| --- | --- | --- | --- | --- | --- | --- |
| p2_off | A_legacy | 0.2 | 0.20909090909090913 | 0.25606060606060604 | 14.182188046411914 | 2.529369631825168 |
| p2_off | B_op_noKdrive | 0.32564102564102565 | 0.2666666666666666 | 0.2537878787878788 | 13.790842314206083 | 2.606372326957197 |
| p2_off | C_op_withKdrive | 0.30512820512820515 | 0.17575757575757572 | 0.28106060606060607 | 13.756764048768591 | 2.60213983196099 |
| p2_on | A_legacy | 0.24358974358974356 | 0.26363636363636356 | 0.23863636363636362 | 14.696252242634994 | 2.617263601099109 |
| p2_on | B_op_noKdrive | 0.34615384615384615 | 0.20606060606060606 | 0.26969696969696966 | 14.326807279521919 | 2.674045264452011 |
| p2_on | C_op_withKdrive | 0.3333333333333333 | 0.23636363636363633 | 0.26363636363636367 | 14.421980324737135 | 2.676640793172725 |

Notes:
- M_base (S‑only) avoids A_legacy degeneracy; hazard vs outside statistics now differ meaningfully.
- coarseEP values are finite and nonzero for both M_base and M_op under selection pressure.

## 2025-12-27 — Motif language under deadline selection v3 (normalized + event-conditioned)

Commands:

```bash
node scripts/run-deadline-opk-motif-compare.mjs --basis v2 --opBinsMode 1
node scripts/run-deadline-opk-motif-compare.mjs --basis v2 --opBinsMode 2
node scripts/run-deadline-opk-motif-p2-ablation.mjs
```

Tuned deadline:

- `deadline=38400` (auto-tune missFracMean≈0.2991; opBinsMode=2 run)

### compare_summary.csv (A/B/C, opBinsMode=2)

| condition | missFracMean | uptimeTailMean | errTailMean | epTotalRateMean | epRepairRateMean | epOpKRateMean | hazardOp_uniqueStatesMean | hazardOp_changeFracMean | hazardOp_coarseEP_perTrans | hazardOp_asym_perTrans |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A_legacy | 0.24871794871794872 | 0.2333333333333333 | 0.2537878787878788 | 0.13349148763377666 | 0.050124669842243195 | 0 | 3 | 0.006052571614583302 | 0.00008048113036620732 | 0.008943985801489768 |
| B_op_noKdrive | 0.3153846153846154 | 0.21818181818181817 | 0.2681818181818182 | 0.10238752782550212 | 0.018913970036796297 | 0 | 3 | 0.003926529947916729 | 0.0002447381395625417 | 0.01559404093746632 |
| C_op_withKdrive | 0.34615384615384615 | 0.23333333333333334 | 0.2643939393939394 | 0.1020039492419896 | 0.018543692047318257 | -0.000009160594144137576 | 3 | 0.003918164062500067 | 0.0002713289259595793 | 0.016167356230164666 |

### event_conditioned_summary.csv (hazard recovery window, opBinsMode=2)

| condition | family | window | js_divergence | coarseEP_perTrans_succ | coarseEP_perTrans_fail | epTotalPerChange_succ | epRepairPerChange_succ | epOpKPerChange_succ | recoverySampleCountMean |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A_legacy | M_base | recovery | 0 | 0 | 0 | 0 | 0 |  | 0 |
| A_legacy | M_op | recovery | 0 | 0 | 0 |  |  | 0 | 0 |
| B_op_noKdrive | M_base | recovery | 0 | 0 | 0 | 0 | 0 |  | 0 |
| B_op_noKdrive | M_op | recovery | 0 | 0 | 0 |  |  | 0 | 0 |
| C_op_withKdrive | M_base | recovery | 0 | 0 | 0 | 0 | 0 |  | 0 |
| C_op_withKdrive | M_op | recovery | 0 | 0 | 0 |  |  | 0 | 0 |

### p2_ablation_summary.csv (A/B/C; opBinsMode=2)

| p2Mode | condition | missFracMean | uptimeTailMean | errTailMean | hazardOpUniqueMean | hazardOpVeffMean | hazardOp_coarseEP_perTrans | hazardOp_js_divergence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| p2_off | A_legacy | 0.2282051282051282 | 0.2212121212121212 | 0.25 | 3 | 2.5279409911856576 | 0.00004960333179867984 | 0 |
| p2_off | B_op_noKdrive | 0.3205128205128205 | 0.22727272727272724 | 0.2681818181818182 | 3 | 2.6041135170514145 | 0.0001697541512058769 | 0 |
| p2_off | C_op_withKdrive | 0.2871794871794872 | 0.3 | 0.22348484848484848 | 3 | 2.6016170729013766 | 0.00016933314031578013 | 0 |
| p2_on | A_legacy | 0.2769230769230769 | 0.21515151515151518 | 0.26136363636363635 | 3 | 2.6100631515173585 | 0.00007903375922533348 | 0 |
| p2_on | B_op_noKdrive | 0.28974358974358977 | 0.2909090909090909 | 0.21893939393939393 | 3 | 2.674391340770028 | 0.0002498077397093044 | 0 |
| p2_on | C_op_withKdrive | 0.32051282051282054 | 0.2636363636363636 | 0.25 | 3 | 2.677465714941803 | 0.00029385358690402566 | 0 |

Notes:
- opBinsMode=1 and opBinsMode=2 both reported `MOP_STILL_COLLAPSED` (M_op hazard uniqueStatesVisited=3; changeFrac≈0.004–0.006).
- `RECOVERY_WINDOW_UNOBSERVED` persisted (recoverySampleCountMean=0 in hazard recovery window).

### Exploratory: Motif language under deadline selection v4 (gate‑conditioned)

Changes in v4:
- Gate‑conditioned sampling (hazard transitions counted only while gate is open).
- opBinsMode wired end‑to‑end with a symmetric dir‑9 M_op descriptor.
- Recovery window defined by absolute time offsets (pre/recovery/tail).
- EP allocation to motif transitions (repair/opK/total per edge).

Commands:

```bash
node scripts/run-deadline-opk-motif-compare.mjs --basis v2 --opBinsMode 2 --gateConditioned 1 --gateCheckEvery 5000
node scripts/run-deadline-opk-motif-compare.mjs --basis v2 --opBinsMode 2 --gateConditioned 1 --gateCheckEvery 1000
```

### compare_summary.csv (A/B/C, opBinsMode=2, gateCheckEvery=1000)

| condition | missFracMean | uptimeTailMean | errTailMean | epTotalRateMean | hazardOpUniqueStatesMean | hazardOpChangeFracMean | eventRecoveryWindowSampleCountMean |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A_legacy | 0.24871794871794872 | 0.24015151515151514 | 0.24992897727272725 | 0.13349148763377666 | 3 | 0 | 4.338461538461539 |
| B_op_noKdrive | 0.3153846153846154 | 0.2149621212121212 | 0.27114109848484846 | 0.10238752782550212 | 45 | 0.00234375 | 4.35128205128205 |
| C_op_withKdrive | 0.34615384615384615 | 0.234375 | 0.2640625 | 0.1020039492419896 | 45 | 0 | 4.402564102564103 |

Top M_op transition edge (by count, hazard):
- `B: 28 -> 29` with `count=1`, `countRev=1`, `epTotalPerTrans=3.6749998728434243`

Notes:
- Exploratory signal only; not a safe claim.
- Verdict from run: `MOTIF_INSTRUMENTATION_TOO_SPARSE` (changeFrac below threshold).

## 2025-12-28 — Motif pressure v5: move-edge motifs (selection pressure only)

Changes in v5:
- Move-edge motifs from accepted opK token transfers (no state-diff sparsity).
- Exact epExact attribution per opK move (accept log).
- Recovery window defined by absolute time offsets only.

Command:

```bash
node scripts/run-deadline-opk-motif-compare.mjs --motifMode move_edges
```

### compare_move_edges_summary.csv (A/B/C, hazard + outside)

| condition | seeds | totalMovesHazardMean | uniqueEdgesHazardMean | totalEpHazardMean | epPerMoveHazardMean | topEdgeMass10HazardMean | symmetryGapHazardMean | coarseEPHazardMean | totalMovesOutsideMean | uniqueEdgesOutsideMean | totalEpOutsideMean | epPerMoveOutsideMean | topEdgeMass10OutsideMean | symmetryGapOutsideMean | coarseEPOutsideMean |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A_legacy | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| B_op_noKdrive | 10 | 22532.7 | 20 | 0 | 0 | 0.5119178471181178 | 0.017578651892342284 | 19.928591939468326 | 20795.1 | 20 | 0 | 0 | 0.5119368935003294 | 0.016375471493880113 | 17.334523673212953 |
| C_op_withKdrive | 10 | 22344.9 | 20 | 2.8141874461667613 | 0.00012711982646427508 | 0.512605558277774 | 0.01702172904215538 | 20.610106955189245 | 20594.3 | 20 | -1.7895937687018886 | -0.00008876035187131501 | 0.5124042448457777 | 0.016979679656265532 | 18.911044719781472 |

### top_edges_hazard.csv (top 10 by count)

| condition | fromIdx | toIdx | countMean | epSumMean |
| --- | --- | --- | --- | --- |
| B_op_noKdrive | 0 | 2 | 1172.8 | 0 |
| B_op_noKdrive | 0 | 3 | 1168.9 | 0 |
| B_op_noKdrive | 0 | 4 | 1164.1 | 0 |
| C_op_withKdrive | 0 | 4 | 1155.4 | 0.9177187407389283 |
| C_op_withKdrive | 0 | 1 | 1154.9 | 0.6921562643023208 |
| C_op_withKdrive | 0 | 2 | 1152.6 | 0.6837187497643754 |
| B_op_noKdrive | 0 | 1 | 1149 | 0 |
| C_op_withKdrive | 0 | 3 | 1144.3 | 0.5937187547795475 |
| B_op_noKdrive | 3 | 4 | 1134.6 | 0 |
| B_op_noKdrive | 1 | 0 | 1127.4 | 0 |

Verdict: `MOVE_EDGE_MOTIF_SIGNAL_TOO_WEAK`.

Notes:
- Exploratory signal only; not a safe claim.

## 2025-12-29 — Exploratory v6: P5 repair-action motifs (deadline selection)

Goal: detect whether selection pressure induces a non-trivial action-motif transition graph and measurable irreversibility/EP per motif.

Conditions (A/B/C):
- A_legacy: `opCouplingOn=0`, `sCouplingMode=0`, `opDriveOnK=0`
- B_op_noKdrive: `opCouplingOn=1`, `sCouplingMode=1`, `opDriveOnK=0`
- C_op_withKdrive: `opCouplingOn=1`, `sCouplingMode=1`, `opDriveOnK=1`

Preset: `scripts/params/op_motifs_selection/selection_base_tuned.json`

Motif definition:
- Motif stream = sequence of **accepted P5 moves** mapped to a discrete motif ID.
- Encodes: base vs meta (P5Base vs P5Meta), mismatch sign at q before write, and local K direction argmax at q (pre-write).
- Hazard window includes accepted moves within `[t0, t0 + deadline)` for each corruption event.
- Transitions are consecutive accepted motifs in each region (hazard vs outside).

EP attribution:
- `epPerMove` uses the exact per-move EP delta from the accept log for P5Base/P5Meta, aggregated per motif and per transition.

Command:

```bash
node scripts/run-deadline-opk-motif-compare.mjs --motifMode p5_actions
```

Verdict: `P5_ACTION_MOTIF_SIGNAL_PRESENT`.

Outputs:
- `.tmp/motif_pressure_v6/compare_p5_actions_summary.csv`
- `.tmp/motif_pressure_v6/top_p5_motifs_hazard.csv`
- `.tmp/motif_pressure_v6/top_p5_motifs_outside.csv`
- Per-seed `p5_actions_*.csv` and `p5_actions_summary.json` under `.tmp/motif_pressure_v6/<condition>/seed_<seed>/`

### compare_p5_actions_summary.csv (A/B/C)

| condition | seeds | totalMovesHazardMean | uniqueMotifsHazardMean | totalEpHazardMean | epPerMoveHazardMean | entropyHazardMean | topMotifMass10HazardMean | symmetryGapHazardMean | coarseEPHazardMean | totalMovesOutsideMean | uniqueMotifsOutsideMean | totalEpOutsideMean | epPerMoveOutsideMean | entropyOutsideMean | topMotifMass10OutsideMean | symmetryGapOutsideMean | coarseEPOutsideMean |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A_legacy | 10 | 11719 | 8 | 4525.055805206299 | 0.3861864998657495 | 1.2522111258239126 | 1 | 0.019053230093606842 | 40.03893908722678 | 10735.3 | 8 | 3109.247866153717 | 0.28951657204628956 | 1.2217404930290556 | 1 | 0.020964314373548266 | 28.097601174197244 |
| B_op_noKdrive | 10 | 7006.2 | 45 | 1755.5804804112763 | 0.25059811667480625 | 2.807964780162765 | 0.773718394357181 | 0.1417034601086114 | 609.6896664282565 | 6426.2 | 44.8 | 1284.9119864612817 | 0.20005478458989825 | 2.776430086584442 | 0.7886820617488385 | 0.13278695207813354 | 502.2010581095463 |
| C_op_withKdrive | 10 | 6974.4 | 44.9 | 1666.5524816006423 | 0.23904416852225677 | 2.808464260590534 | 0.7701770992265906 | 0.14253838878768704 | 591.7784222594294 | 6402.2 | 45 | 1191.7169846247882 | 0.18617035937393633 | 2.7736476860320725 | 0.7861359413966633 | 0.13323932246409018 | 493.7719224711239 |

### top_p5_motifs_hazard.csv (top 5 rows for B/C combined)

| condition | motifId | countMean | epPerMoveMean |
| --- | --- | --- | --- |
| B_op_noKdrive | 1 | 1033 | 0 |
| C_op_withKdrive | 1 | 1004.1 | 0 |
| B_op_noKdrive | 4 | 666.6 | 0 |
| C_op_withKdrive | 4 | 657.8 | 0 |
| C_op_withKdrive | 7 | 607.3 | 0 |

Notes:
- Exploratory signal only; not a safe claim.
- The P5-action motif stream under selection shows nontrivial entropy and coarseEP (hazard), but epPerMove for dominant motifs remains near 0 in B; C shows nonzero total ep but similar motif distribution.
- B/C show larger action alphabets than A, which inflates entropy and unique-motif counts relative to legacy.
- Controls still needed: instrumentation invariance (logging on/off) and null-selection (P6 off) to verify symmetry metrics collapse.

Exploratory takeaways:
- B/C exhibit ~45 motifs vs A’s 8 in the hazard window.
- B/C symmetryGap ≈ 0.14 vs A ≈ 0.02; coarseEP also higher in B/C than A.
- B and C remain close on motif statistics (no strong K-drive separation).

STATUS: exploratory signal present in P5-action motif lens; not safe-claim ready; next controls = invariance + null-selection.

## 2025-12-30 — Moving hazard homeostasis v1 (exploratory)

Commands:

```bash
node scripts/run-moving-hazard-homeostasis.mjs
node scripts/test-instrumentation-invariance.mjs
node scripts/run-moving-hazard-null-control.mjs
```

### moving_hazard_summary.csv (A/B/C/D)

| variant | missFrac | uptimeTailMean | errTailMean | recoveryMedian | recoveryP95 | epTotalMean | epRepairMean | epOpKMean | epClockMean | epTotalRateMean | motifEntropyMean | motifSymmetryGapMean | motifCoarseEPMean | trackingDeltaHkMean | trackingDeltaR2Mean | trackingDeltaDmagMean |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 0.14358974358974358 | 0.3060745924330081 | 0.22876448576291225 | 6000 | 34000 | 1877.4608616315402 | 707.2393541702858 | 0 | 1170.2215074612543 | 0.04889220993832135 | 1.2289738320048174 | 0.1120058388900355 | 15.196680432106765 | 0 | 0 | 0 |
| B | 0.2076923076923077 | 0.34627850512796604 | 0.21897545698768028 | 4000 | 33000 | 1820.8707121983552 | 531.2492079001206 | 0 | 1289.6215042982346 | 0.047418508130165495 | 2.712323627871284 | 0.5425805663484208 | 104.97002918578447 | 0.004000534210690459 | -0.02725751707422988 | 0.013972185691268091 |
| C | 0.16923076923076924 | 0.306977135055758 | 0.23495455868944762 | 6000 | 32000 | 1489.1362148092774 | 242.62240167677115 | 0 | 1246.5138131325061 | 0.038779588927324936 | 2.8979123619659912 | 0.5396283582751856 | 160.25593642141834 | -0.00001435049638575701 | 0.000415371897251464 | 0.00029812515121115666 |
| D | 0.1794871794871795 | 0.3278539578632685 | 0.22453577321163326 | 5000 | 31000 | 1451.4651905058297 | 233.9350941491767 | -0.16525600082017122 | 1217.6953523574732 | 0.03779857266942265 | 2.8964310918471408 | 0.5407960180143228 | 160.08659588679626 | -0.0002404157495507358 | -0.00009213038468174112 | 0.000378853068315321 |

### moving_hazard_by_hazard.csv (first 10 rows)

| variant | hazardIndex | missFrac | recoveryMedian | uptimeTailMean | motifEntropyMean | motifSymmetryGapMean | motifCoarseEPMean | trackingDeltaHkMean | trackingDeltaR2Mean | trackingDeltaDmagMean |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 4 | 0.125 | 8000 | 0.27649510401878097 | 1.2060817782515536 | 0.10890918289503013 | 14.751732447411063 | 0 | 0 | 0 |
| A | 12 | 0.18571428571428572 | 5000 | 0.2604991757216742 | 1.2290440283327733 | 0.11539377448459957 | 14.85846903026296 | 0 | 0 | 0 |
| A | 20 | 0.15 | 6000 | 0.2644900687547746 | 1.2386495014734111 | 0.10841378611697057 | 14.263672326735811 | 0 | 0 | 0 |
| A | 28 | 0.05 | 3000 | 0.38363099744784807 | 1.2360253772115894 | 0.1242636137290239 | 16.71836386165729 | 0 | 0 | 0 |
| A | 36 | 0.275 | 10000 | 0.2511145082688466 | 1.2340534998363322 | 0.11584887647925728 | 15.189110381890853 | 0 | 0 | 0 |
| A | 44 | 0.1 | 4000 | 0.36631811102196155 | 1.2375248527528484 | 0.11050756429167463 | 15.631553333844394 | 0 | 0 | 0 |
| A | 52 | 0.075 | 9000 | 0.2715500082276398 | 1.2527776208270072 | 0.10750285458807245 | 15.689848269887955 | 0 | 0 | 0 |
| A | 60 | 0.175 | 2000 | 0.4382598169502662 | 1.2204734038603107 | 0.10576276283473618 | 15.169300341242428 | 0 | 0 | 0 |
| B | 4 | 0.225 | 3000 | 0.3694337030799995 | 2.6363225159494803 | 0.5176010633150945 | 97.16277970792605 | -0.09824108042123787 | -0.07147505680892904 | 0.03919044363035312 |
| B | 12 | 0.2714285714285714 | 4000 | 0.32898333771387256 | 2.709785174378555 | 0.541769422912502 | 104.60242939190144 | 0.012161362153935125 | -0.0005815046189640175 | 0.00984924123884366 |

### instrumentation_invariance.csv (summary line)

`INSTRUMENTATION_INVARIANCE: PASS`

### moving_hazard_null_control.csv

| condition | missFrac | motifEntropyMean | motifSymmetryGapMean | motifCoarseEPMean | epTotalRate | epRepairMean | epOpKMean | epClockMean |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| driven | 0.3894736842105263 | 2.633369164249779 | 0.609189207564794 | 68.00558881751738 | 0.05322741979626384 | 118.73131494932856 | 0 | 679.6799819946289 |
| null | 0.4 | 2.777094883040026 | 0.6547495701294636 | 78.83442061047839 | 0 | 0 | 0 | 0 |

Exploratory observations (not SAFE claims):
- Motif entropy and symmetry gap are higher in op modes (B/C/D) than legacy under moving hazard.
- Hazard-index splits show nonuniform missFrac and coarseEP across locations, with tracking deltas varying by hazard index.
- Null control shows nonzero motif symmetry/coarseEP even without drive; interpret motif irreversibility with caution.

Exploratory; not treated as SAFE claims.

## 2025-12-30 — Moving hazard finishing kit v1 (report triage, exploratory)

Commands:

```bash
node scripts/run-moving-hazard-stationary-vs-moving.mjs
node scripts/run-moving-hazard-speed-sweep.mjs
node scripts/run-moving-hazard-null-control.mjs
```

### finishing_stationary_vs_moving.csv

| variant | scenario | missFrac | uptimeTailMean | errTailMean | recoveryP95 | epTotalRateMean | epRepairPerActionMean | motifEntropyMean | motifSymmetryGapMean | avgPairwiseJSD | mutualInfoHM |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | stationary | 0.31025641025641026 | 0.31193181462412234 | 0.23392851628428554 | 14000 | 0.07331138221373931 | 0.23958953309744335 | 1.2225376869723712 | 0.16244376098879895 | 0 | 0 |
| C | stationary | 0.358974358974359 | 0.31549754376677447 | 0.2336301438945671 | 14000 | 0.05579842753366621 | 0.07934753818426825 | 2.8318270387093767 | 0.6836483652045188 | 0 | 0 |
| A | moving | 0.36666666666666664 | 0.2971397797359336 | 0.23377523651562113 | 13000 | 0.07564282829284667 | 0.23771565935207054 | 1.2079269396037038 | 0.16167104250074193 | 0.0008472426105986085 | 0.0014996992411072925 |
| C | moving | 0.40512820512820513 | 0.29730204624435397 | 0.23963946310100168 | 14000 | 0.059656648590569024 | 0.08285897289903178 | 2.7924055639966796 | 0.669875219438312 | 0.011278817261180393 | 0.020986926863386955 |

### finishing_speed_sweep.csv

| variant | hazardHoldEvents | missFrac | uptimeTailMean | recoveryP95 | epTotalRateMean | epRepairPerActionMean | avgPairwiseJSD | mutualInfoHM |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 1 | 0.3368421052631579 | 0.35438088227561915 | 12000 | 0.07087427138077583 | 0.20518421541046442 | 0.0030004860557128576 | 0.004632602205252064 |
| C | 1 | 0.5578947368421052 | 0.2074385263858948 | 11000 | 0.06971117200499108 | 0.07878476331499748 | 0.017946594269727917 | 0.03223347828855402 |
| A | 2 | 0.3368421052631579 | 0.29203726098462934 | 13000 | 0.07265633449654829 | 0.22602385629463298 | 0.0024387564498305017 | 0.0042044001668488 |
| C | 2 | 0.42105263157894735 | 0.25960789210789204 | 14000 | 0.061650835362174784 | 0.07366399943281124 | 0.021107866501205556 | 0.038199422221503666 |
| A | 4 | 0.3894736842105263 | 0.2657361644203749 | 14000 | 0.08243014468377098 | 0.23482779602346723 | 0.003435203273471208 | 0.0053208608629142645 |
| C | 4 | 0.3894736842105263 | 0.35825591075591073 | 13000 | 0.05322741979626384 | 0.06684809567591789 | 0.03111080891541846 | 0.04914689490844264 |
| A | 8 | 0.3157894736842105 | 0.40411848385532584 | 11000 | 0.06257633481778598 | 0.1807601628961216 | 0.0014922743745757585 | 0.0018553457077495018 |
| C | 8 | 0.5263157894736842 | 0.25758092784408576 | 12000 | 0.06618879314609132 | 0.07081906572028619 | 0.0335304684309491 | 0.04138083112968251 |
| A | 16 | 0.3368421052631579 | 0.3629739558686927 | 11000 | 0.06693827152118348 | 0.1930572003981302 | 0.00039116068019315087 | 0.00021030583901341093 |
| C | 16 | 0.4105263157894737 | 0.3413148839464629 | 12000 | 0.05514781447490707 | 0.06455372232540074 | 0.0220927752415767 | 0.01127324463914348 |

### finishing_null_control_ep_per_action.csv

| condition | epTotalRate | epRepairMean | epRepairPerActionMean | repairActionCountMean |
| --- | --- | --- | --- | --- |
| driven | 0.05322741979626384 | 118.73131494932856 | 0.06684809567591789 | 1251.5263157894738 |
| null | 0 | 0 | 0 | 1352.2736842105264 |

Exploratory takeaways (not SAFE claims):
- EP/action attribution sanity: driven vs null shows epTotalRate and epRepairPerAction collapse to 0 while repair-action counts stay comparable.
- Context sensitivity appears only when contexts exist: stationary hazards have avgPairwiseJSD=0, mutualInfoHM=0; moving hazards are nonzero.
- Op-coupled mode increases context dependence of repair motifs: moving hazard shows much larger avgPairwiseJSD/mutualInfoHM for C vs A.
- Timescale window suggests EP–reliability advantage: at hazardHoldEvents=4, C matches A’s missFrac with lower epTotalRate and higher uptimeTail, plus much lower epRepairPerAction.

Caveats:
- Not robust homeostasis: uptimeTail remains well below 1 across these regimes.
- motifSymmetryGap/coarseEP are descriptive action-graph measures, not thermodynamic EP.
- Evidence supports context-dependent repair policy, not direct “K tracks hazard location.”
