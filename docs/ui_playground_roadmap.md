# UI Playground Roadmap — Experiments Alignment (Step 1)

## 1) Scope + Principles

- We won’t expose everything; we will expose the minimum needed to show the main findings in `EXPERIMENTS.md` and related audits.
- UI diagnostics must remain **descriptive**, not “progress” indicators.
- Audits are **PASS-only cues**: show a badge when a null/consistency test passes; avoid “fail” labels (just show raw values and that PASS criteria are not met).
- The null regime (P3=OFF, P6=OFF) must remain explicitly testable: **detailed balance evidence**, energy breakdown, affinity ~ 0. 
- P3 and P6 are the **only** permitted sources of irreversibility; UI should reinforce this with clear audit gating.

---

## 2) Current UI Capabilities (Snapshot of Today)

### 2.1 Data flow (worker → UI)

- Worker loop: `apps/web/src/sim/sim.worker.ts` constructs `Sim` and sends snapshots (positions, bonds, counters, apparatus, fields, diagnostics, energy).
- UI client: `apps/web/src/sim/workerClient.ts` forwards snapshots to `apps/web/src/App.tsx`.
- Snapshot types: `apps/web/src/sim/workerMessages.ts` defines `SimSnapshot` + `Diagnostics` and `EnergyBreakdown`.
- Run capture/export: `apps/web/src/sim/runCache.ts` stores snapshots to IndexedDB and exports JSONL (base-only fields + diagnostics).

### 2.2 Rendered state

- **Particles + bonds**: Canvas in `App.tsx` renders positions + bonds at `bondThreshold`.
- **Overlays**:
  - P4 counters (signed) or P2 apparatus (unsigned) as particle color (`colorSource`).
  - Field heatmap (base S or meta fields: metaS/metaN/metaA/metaW) via `overlayChannel`.

### 2.3 User‑controllable inputs (today)

- **Run control**: init/step/run/pause; N, seed, recordEverySteps, bondThreshold.
- **Primitive toggles**: P1/P2/P3/P4/P5/P6 on/off.
- **Sim params exposed** (`SimParams` in UI):
  - motion: `beta`, `stepSize`, `kappaRep`, `r0`
  - P1: `pWrite`, `rPropose`, `lambdaW`, `kappaBond`, `rStar`, `lW`
  - P2: `pAWrite`, `lambdaA`, `lA`
  - P4: `pNWrite`, `lambdaN`, `lN`
  - P5: `pSWrite`, `lambdaS`, `lS`, `gridSize`, `safeThreshold`
  - meta: `metaLayers`, `eta`
  - P6: `muHigh`, `muLow`
- **Presets (UI only)**: `sparse`, `balanced`, `dense`, `nullBaseline`, `p3p6Full` in `App.tsx`.

### 2.4 Metrics/diagnostics currently shown

- **Energy breakdown**: total + `uRep`, `uBond`, `eW`, `eN`, `eA`, `eS` (from `Sim.energy_breakdown`).
- **Flux/affinity diagnostics** (per P1/P2/P4/P5): `J`, `A`, `sigmaMem`, `aM6*`, `p3DispMag`, `p3LoopArea` from `Sim.diagnostics()`.
- **Graph stats (derived in UI)**: edges, components, largest component (`computeGraphStats` in `App.tsx`).
- **Safe‑set stats (derived in UI)**: fraction/components/largest from base S only (`computeSafeSetStats`).
- **Histograms**: `wHist` and `sHist` from diagnostics; component size hist from graph stats.
- **Sparklines**: per metric in `CHARTS` and `HISTOGRAMS` lists.

### 2.5 Base‑only vs meta‑aware (important)

- Safe‑set **only** uses `baseSField` today. Meta fields are used only for overlays.
- Diagnostics are **not split** by base vs meta; no per‑layer stats.
- Graph stats use **base bonds only** (`bonds` from `Sim.bonds(...)`).
- Run export (`runCache`) stores **base** fields only (positions, bonds, counters, apparatus, base field). No meta fields, no epExact, no clock, no opK tokens.

---

## 3) Finding Modules We Must Support (by module)

### 3.1 Multi‑layer & η‑alignment

Key artifacts:
- `scripts/run-meta-sweep.mjs` (cross‑layer diffs, nonzero rates)
- `scripts/test-step3-eta-coupling.mjs` (η reduces base/meta and meta/meta mismatch)
- `scripts/test-step2-meta-layers.mjs` (meta field sizing + updates)
- Claims: `C_META_NULL_1`, `C_META_ETA_ALIGN_1` in `EXPERIMENTS.md`

Needed story:
- Show that adding meta layers (and η) **reduces cross‑layer mismatch** without breaking null (when P6=OFF). Provide PASS‑only cues for “alignment improves” and “null EP holds.”

### 3.2 EP / reversibility audits (null)

Key artifacts:
- `scripts/test-ep-null-tight.mjs` (epExact window rate ~ 0 in null; p6_drive > 0)
- `scripts/test-opcoupling-null-ep.mjs` + `scripts/test-opk-null-ep-weights.mjs` (opK null EP constraints)
- Claims: `C_BASE_NULL_1`, `C_EP_EXACT_NULL_1`, `C_OPK_NULL_EP_1`, `C_OPK_WEIGHT_NULL_EP_1`

Needed story:
- In null (P3=OFF, P6=OFF), **epExact window rates** and affinity proxies are ~0 (PASS). Under drive, they become positive (no PASS badge).

### 3.3 Clock/TUR

Key artifacts:
- `scripts/test-clock-current.mjs` (clock drift ~0 in null; >0 with P6)
- `scripts/run-clock-tur-sweep.mjs` (TUR ratio R ≥ 1 in sweep)
- `scripts/test-clock-traversal-necessity.mjs` + `scripts/test-clock-deadline-traversal.mjs`
- Claims: `C_CLOCK_DRIFT_1`, `C_TUR_1`, `C_TRAVERSAL_NEED_1`, `C_TRAVERSAL_ORIENT_1`

Needed story:
- Show a **directional clock current** (drift) with dissipation, and demonstrate a TUR tradeoff. Null runs should PASS on “no drift.”

### 3.4 opK coupling / hierarchy

Key artifacts:
- `scripts/test-opcoupling-invariants.mjs` (K‑token budgets)
- `scripts/test-opcoupling-effect.mjs` (Sdiff_op decreases with η)
- `scripts/run-opk-diagnostics.mjs` (opK metrics + epOpK)
- `scripts/run-opk-hierarchy-search.mjs` (depth hierarchy / slopes)
- Claims: `C_OPK_INV_1`, `C_OPK_EFFECT_1`, `C_OPK_HIER_1`, `C_OPK_COMPOSED_R2_1`

Needed story:
- Show that opK is **budget‑conserving**, explain the **operator mismatch** metric, and show hierarchy trends under drive. 

### 3.5 Code maintenance (noise + repair)

Key artifacts:
- `scripts/run-code-maintenance.mjs` (sdiff recovery, error curves, epRepair/epClock)
- `scripts/run-clock-code-joint-sweep.mjs` (clock × repair tradeoffs)
- Claims: `C_CODE_MAINT_1`, `C_TRAVERSAL_NEED_1`, `C_DEADLINE_CLOCK_EP_1`

Needed story:
- With P6‑drive + repair gating, the system **recovers after perturbation** and pays dissipation (epRepair). Null runs show no repair advantage.

---

## 4) Gap Matrix (Core Deliverable)

| Module | Key claims/tests | User-facing story | Required observables | Where to get it | Current UI status | Proposed UI surface | Priority |
|---|---|---|---|---|---|---|---|
| Multi-layer | `run-meta-sweep.mjs`, `test-step3-eta-coupling.mjs` | “η makes layers align (base↔meta), without breaking null.” | `Sdiff(base, meta0)`, `Sdiff(meta0, meta1)`, `Wdiff(meta0, meta1)`, meta nonzero fraction | Compute in UI from `baseSField`, `metaField`, `metaWEdges` | Partial (overlay only) | “Meta alignment” panel + PASS badge | P0 |
| Multi-layer | `test-step2-meta-layers.mjs` | “Meta layers update and obey bounds.” | meta field max/min vs `lS/lN/lA/lW`, layer sizes | Sim snapshot meta arrays + params | Missing | “Meta sanity” panel | P1 |
| Multi-layer | `run-meta-sweep.mjs` | “Meta safe‑set structure is visible per layer.” | per‑layer safe‑set fraction/CC, meta histograms | Compute in UI from `metaField` | Missing | “Meta safe‑set” panel | P1 |
| EP/null | `test-ep-null-tight.mjs` | “Exact EP ≈ 0 in null (PASS).” | `epExactRateWindow`, `epNaiveRateWindow`, `epExactTotal` | `Sim.ep_exact_total`, `Sim.ep_naive_total` | Missing | “EP audit” panel + PASS badge | P0 |
| EP/null | `EXPERIMENTS.md` (C_BASE_NULL_1) | “Affinity proxies relax to 0 in null.” | `A_y`, `J_y`, `sigmaMem`, `aM6*` with null threshold | already in diagnostics | Present (charts) | Add PASS badge + thresholds | P0 |
| Clock/TUR | `test-clock-current.mjs` | “Clock drift exists only under P6.” | `clock_q`, `clock_fwd`, `clock_bwd`, drift | `Sim.clock_q/fwd/bwd` | Missing | “Clock” panel | P0 |
| Clock/TUR | `run-clock-tur-sweep.mjs` | “TUR ratio R ≥ 1 in sweep.” | `Var(Q)`, `mean(Q)`, `epExactTotal`, `R` | UI aggregate over seeds or worker batch | Missing | TUR plot + PASS badge | P1 |
| opK coupling | `test-opcoupling-invariants.mjs` | “opK budgets conserved.” | `op_k_tokens`, `op_budget_k`, `op_r_count`, `op_interfaces` | new snapshot fields | Missing | “opK invariant” badge | P0 |
| opK coupling | `test-opcoupling-effect.mjs` | “η reduces op mismatch Sdiff_op.” | `Sdiff_op`, `R2`, `H`, `A`, `coh` | compute from opK + fields (`opk-metrics.mjs`) | Missing | “opK metrics” panel | P0 |
| opK coupling | `run-opk-hierarchy-search.mjs` | “Hierarchy slopes with depth.” | `rho(R2)`, `deltaR2`, `deltaH`, `deltaCoh` | compute from per-layer metrics | Missing | “Hierarchy” chart | P1 |
| Maintenance | `run-code-maintenance.mjs` | “Repair recovers after perturbation with EP>0.” | `recoverySteps`, `errCurve`, `sdiffBase`, `sdiffMeta`, `epRepair`, `epClock` | needs `apply_perturbation`, `ep_exact_by_move` | Missing | “Maintenance” panel + PASS badge | P0 |
| Maintenance | `run-clock-code-joint-sweep.mjs` | “Clock/repair tradeoff under drive.” | `clockDrift`, `epExactTotal`, `errF(0.5)` | clock + ep + reconstruction metrics | Missing | Combined “Clock × Repair” view | P1 |
| Maintenance | `run-code-maintenance.mjs` | “Noise/repair knobs drive recovery.” | `codeNoise*`, `repairGate*`, perturbation trigger | params + `apply_perturbation` | Missing | “Noise/repair controls” | P1 |

---

## 5) Parameter Coverage Audit

### 5.1 Params required by experiments but missing in UI

**Multi-layer / η**
- `initRandom` (used in `test-ep-null-tight.mjs`, `run-meta-sweep.mjs`)
- `etaDrive` (used in opK + maintenance regimes)

**EP / null audits**
- `initRandom` (tight null EP checks)
- `epDebug` / `acceptLogOn` / `acceptLogMask` / `acceptLogCap` (for audit trace capture)

**Clock/TUR**
- `clockOn`, `clockK`, `clockFrac`, `clockUsesP6`
- `repairClockGated`, `repairGateMode`, `repairGateSpan`
- `p6SFactor` (used in `run-clock-code-joint-sweep.mjs`)

**opK coupling / hierarchy**
- `opCouplingOn`, `sCouplingMode`, `opStencil`, `opBudgetK`
- `opKTargetWeight`, `opDriveOnK`, `etaDrive`

**Code maintenance**
- `codeNoiseRate`, `codeNoiseBatch`, `codeNoiseLayer`
- `repairClockGated`, `repairGateMode`, `repairGateSpan`
- `p6SFactor`, `etaDrive`

### 5.2 UI params not tied to a main finding (optional pruning)

- `bondThreshold` (useful for visualization but not a claim driver)
- `recordEverySteps` (UI charting convenience)
- `colorSource` / `overlayChannel` / `overlayLayerIndex` (pure visualization)
- `kappaRep`, `r0`, `kappaBond` (model stability, not explicit claims)

---

## 6) Preset Alignment Notes (Preview for Step 7)

Suggested UI‑visible preset list (do not implement yet):

**Multi-layer / η**
- `scripts/params/meta/meta2_null_decoupled.json`
- `scripts/params/meta/meta2_null_coupled.json`
- `scripts/params/meta/meta2_p6_drive_coupled.json`
- `scripts/params/meta/meta2_p3_pump_coupled.json`
- `scripts/params/meta/meta2_p3p6_combo_coupled.json`

**EP / null audits**
- `scripts/params/base_null_balanced.json`
- `scripts/params/base_p6_drive.json`

**Clock/TUR**
- `scripts/params/clock_code/clock_null.json`
- `scripts/params/clock_code/clock_p6.json`
- `scripts/params/clock_code/clock_tur_sweep_base.json`

**opK coupling / hierarchy**
- `scripts/params/op_coupling/opS_null_energy.json`
- `scripts/params/op_coupling/opS_p6_drive_only.json`
- `scripts/params/op_coupling/deadline_opk_best.json`
- `scripts/params/op_motifs_selection/selection_base_tuned.json`

**Code maintenance**
- `scripts/params/clock_code/code_null.json`
- `scripts/params/clock_code/code_p6_drive.json`
- `scripts/params/clock_code/code_p6_clock_gated.json`
- `scripts/params/clock_code/code_deadline_gated_clock.json`

---

## 7) Minimal Milestone Proposal

1) **Plumbing**: extend snapshot/worker types for epExact + clock + opK tokens; add PASS badge logic.
2) **EP + Null Audits**: EP windowed rate panel + null PASS badge; show A_y + Sigma_mem as today.
3) **Meta Alignment**: Sdiff/Wdiff metrics + meta sanity stats, per-layer selector.
4) **Clock/TUR**: clock current panel + TUR ratio chart; include clock parameter controls.
5) **opK & Maintenance**: opK metrics/invariants and repair/noise panels; add perturbation action.
