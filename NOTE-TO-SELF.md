# NOTE TO SELF — Ratchet Playground Status (handoff)

## What we built

We scaffolded a web app and implemented the first MVP simulation loop for the Ratchet Playground:

- **UI:** `apps/web` (Vite + React + TypeScript)
- **Sim core:** `crates/sim-core` (Rust compiled to WASM via `wasm-pack`)
- **Runtime model:** the simulation runs in a **WebWorker** and streams snapshots to the UI.
- **Rendering:** Canvas2D draws particles and P₁ bond edges.
- **Docs source of truth:** `docs/` (ratchet primitives P₁–P₆, null regime, deliverables A–D).

## Key constraints (must preserve)

- **Null regime requirement:** with P₃=OFF and P₆=OFF, the Markov chain must satisfy **detailed balance** w.r.t. an explicit stationary measure (Deliverable A).
- Only P₃ and P₆ may break reversibility. (We are currently implementing only the null regime and P₁.)
- This is a scientific instrument: **what is drawn must equal what the physics is**. We removed a prior UI-only bond filter; the UI now draws exactly the bond list returned by the sim, with torus-aware segment drawing.

## Current simulation (MVP)

State:
- Particles on a 2D torus: `x_i ∈ [0,1)^2`
- P₁ bond weights: `w_ij ∈ {0..L_w}` stored in an upper-triangular array
- P₄ counters: `n_i ∈ {-L_n..L_n}` (per-particle counters)

Dynamics (null regime):
- Mixture kernel per step:
  - **X move**: pick particle `i`, symmetric proposal `x_i' = x_i + δ (mod 1)`, Metropolis accept using `ΔE`
  - **P₁ write**: propose `w_ij → w_ij ± 1` with symmetric proposals, Metropolis accept using `ΔE`
- **P₄ write**: propose `n_i → n_i ± 1` with symmetric proposals, Metropolis accept using `ΔE`
- Energy `E(Z)` includes repulsion and a bond geometry coupling plus quadratic penalties on `w` (matches Deliverable A template for X+P1).
- Energy now also includes quadratic penalties on `n` (P₄) per Deliverable A.
- **Neighbor locality for P₁ proposals:** write proposals are restricted to pairs with torus distance `r_ij ≤ r_propose` (aligned with `docs/12_browser_impl_notes.md` guidance about sparse graphs). Bonds can still persist even if particles later move apart.

Files:
- Sim core: `crates/sim-core/src/lib.rs`
- Worker bridge: `apps/web/src/sim/sim.worker.ts`
- UI: `apps/web/src/App.tsx`
 - Run cache: `apps/web/src/sim/runCache.ts`

## UI/Worker/WASM wiring status

Worker setup was initially broken; fixes applied:
- Vite worker import uses `?worker` (required for correct TS worker bundling).
- Message queuing implemented in `SimWorkerClient` so early worker messages aren’t lost before React effects attach handlers.
- React StrictMode double-mount issue avoided by using a module-level singleton `SimWorkerClient` in `App.tsx`.

Current behavior:
- `Init` constructs the WASM `Sim`, posts `ready` and an immediate snapshot.
- `Run` loops and posts snapshots; `Step` advances fixed steps.
- Each snapshot now includes diagnostics and step count.

## Tunable parameters (now exposed)

We exposed key null-regime params to the UI and plumbed them into WASM:

- UI maintains **draft vs applied** parameters, with a clear “Apply params” button (draft edits do not silently affect runs).
- Worker sends `config` with `{ bondThreshold, params }` and calls `sim.set_params(params)` (or caches params if config arrives before init).
- WASM provides `Sim.set_params(JsValue)` with safe clamps and optional field handling.

Types:
- `apps/web/src/sim/workerMessages.ts` defines `SimParams`
- `apps/web/src/App.tsx` provides presets (`sparse`, `balanced`, `dense`)

P₄ parameters added:
- `pNWrite`, `lambdaN`, `lN`

Important: For clean scientific runs, prefer **Apply params + Init** whenever changing physics parameters.

## Diagnostics + charts (Deliverable D MVP)

We implemented minimal null‑regime diagnostics and time‑series charts:
- **P₁ flux/affinity:** windowed counts of accepted `w+`/`w-`, with `Jw`, `Aw`, and `Σ_mem` (should ~0 in null regime).
- **Graph stats:** edges, component count, largest component size and fraction.
- **Charts panel:** time‑series sparklines for `Jw`, `Aw`, `Σ_mem`, edges, largest component fraction, total energy.
- **Histograms:** bond weight histogram (from WASM) and component size histogram (from UI).
- **Step counter** shown in UI.

Charts are data‑driven (`CHARTS`/`HISTOGRAMS` lists in `apps/web/src/App.tsx`) so adding new metrics is straightforward.

## Torus consistency audit

- Sim-core uses torus wrap for positions and torus minimal-image distance for all distance-dependent terms.
- Rendering draws torus-consistent shortest wrapped segments for each bond; no UI-only filtering remains.
- We fixed a sign bug in the bond wrap drawing (wrong image shift sign caused “curtain” artifacts). Now the “curtains” are gone; remaining density is physics/parameters.

## Build / tooling notes

- Root `Makefile` has `make dev`, `make wasm`, etc.
- `make wasm` has been hardened to use a repo-local temp dir `.tmp/` because `wasm-pack` sometimes fails creating temp dirs for `cargo install wasm-bindgen` on this setup.
- `.gitignore` includes `.tmp/`.
- `scripts/bootstrap.sh` installs `wasm-pack` and also `wasm-bindgen-cli` to reduce wasm-pack download attempts.

## Known issues / open questions

1) **Dense bond graphs** can still occur depending on params and equilibrium regime; after fixing the torus-drawing sign bug, remaining density is not a rendering artifact. Use UI params + `bondThreshold` to explore regimes; add diagnostics next (see below).
2) The P₁ proposal selection currently scans all pairs to choose a random neighbor pair (reservoir sampling). This is O(N²) per write attempt and will not scale; docs recommend spatial hashing / neighbor lists.
3) The “Sparse” preset may still percolate into a single connected component at `bondThreshold=3` (often becomes sparser if threshold is raised to `Lw`). This indicates the chosen null-regime parameters still admit a dense-bond equilibrium for that threshold; needs empirical tuning.
4) Snapshot cadence vs “record every steps” is limited by the worker step chunk (`sim.step(500)`), so recording interval ≤ 500 still yields one sample per snapshot.

## Where we want to go next

Priority roadmap (stay aligned with docs):

1) **Deliverable D (null regime sanity diagnostics)**
   - ✅ Implemented minimal diagnostics + charts + histograms.

2) **Performance correctness: neighbor lists**
   - Replace O(N²) neighbor selection with spatial hashing buckets and symmetric proposal accounting (as in `docs/12_browser_impl_notes.md`).

3) **Expand primitives**
   - Implement P₂/P₄/P₅ as additional reversible channels (still null regime).
   - Only later add P₃ and/or P₆ with the strict constraint that they are the only irreversibility sources (Deliverables B/C).

4) **Experiment management**
   - Add “preset export/import” (JSON) and a run metadata panel (params, seed, timestamp).
   - Make “init required after physics change” more explicit (e.g., disable Run until re-init).
   - **Run cache + export implemented:** `runCache.ts` stores snapshots in IndexedDB + memory and supports JSONL export via UI button. Cache resets on Init. Record interval default is 2000 steps (UI).
