# To Wake a Stone with 6 Birds  
## Layered obstruction‑lifting dynamics: six substrate‑agnostic primitives, three lenses, and evidence from a meta‑enabled simulator

**Scope:** This report is a *repo‑grounded* theory+evidence write‑up. It sticks closely to the internal theory notes (`01_*`, `02_*`, `03_*`, `15_*`) and the reproducible runs logged in `EXPERIMENTS.md`. Where I speculate beyond those sources, I label it explicitly as **Hypothesis**.

**What changed vs the earlier draft:** this version (i) keeps the repo’s *primitive definitions* intact (no “economy = P₂” type substitutions), (ii) makes the *obstruction lens* explicit, (iii) adds the *error‑correction/spacetime* mechanism, and (iv) reports the experiments using the repo’s own “safe claims” blocks and numeric summaries.

**Terminology note.** Earlier drafts used a shorter name borrowed from a specific tradition of stochastic pumping. This version standardizes on **layered obstruction‑lifting dynamics** to emphasize the mechanism we actually study here: primitives that reshape *obstruction landscapes* (energetic barriers, informational bottlenecks, and viability constraints) across multiple coupled substrates (including latent operator layers). Only the terminology is being normalized; the primitives, simulator, and experimental evidence are unchanged.

---

## Abstract

Layered obstruction‑lifting dynamics (LOD) is a framework, developed in this repository, for building persistent non‑equilibrium structure from six substrate‑agnostic primitives (P₁–P₆): **operator write** (P₁), **feasible‑set shaping** (P₂), **protocol cycling** (P₃), **topological/quantized degrees of freedom** (P₄), **closure/viability growth** (P₅), and **resource transduction** (P₆). The core move is *layering*: the same primitives can act not only on an observable substrate but also on latent substrates (meta layers) that encode operators, constraints, and control structure; additionally, coupling operators can themselves be lifted into a writable substrate (operator‑lifted coupling via tokenized kernels). We enforce a strict null regime (P₃=off, P₆=off ⇒ EP≈0) and summarize an experiment suite showing (i) conservative vs drive‑only coupling controls, (ii) drive‑selected operator kernels with measurable dissipation, and (iii) deadline/repair phenomena where operator coupling shifts EP–reliability tradeoffs and improves repair‑budget success curves in the tested regime. All claims are tied to logged CSV/JSONL artifacts and conservative controls; broader interpretations are explicitly labeled as speculative.

---

## 1. Primitives, motifs, and the null requirement

### 1.1 What we built and what the experiments actually cover

This repo is not a single "demo run"; it is an experiment platform with three progressively stronger capabilities:

1) **A reversible null baseline with exact entropy production (EP) accounting.**  
   With P₃=OFF and P₆=OFF, every enabled reversible channel relaxes toward detailed balance and `epExactRateWindowLast ≈ 0` with tight windowed tests.

2) **A layered substrate (metaLayers) where the same primitives operate at multiple "levels."**  
   The simulator implements a base particle substrate plus stacked lattice-field layers. Turning on coupling (`eta`) or drive-only alignment (`etaDrive` + P₆) allows higher layers to bias/maintain patterns in lower layers (and vice-versa, depending on which couplings are actually wired; Section 5).

3) **Operator lifting: coupling operators become state.**  
   For the S channel, the base-to-meta alignment is lifted from a fixed pointwise constraint into a learned/local operator represented by a writable token substrate `K`. This makes "the way layers talk" an object of selection under drive (Section 5.6 and 6.5).

What is demonstrated in the experiments log is therefore not "life," but a set of mechanistic existence proofs:
- exact EP sanity (null stays null; drive generates EP),
- a working clock current + TUR harness,
- self-healing / maintenance behaviors under perturbation and deadlines,
- and operator-selection/hierarchy signatures in the lifted coupling regime.

### 1.2 Primitives are not motifs

The repo distinguishes **primitives** (operations you can switch on/off) from **motifs** (composite patterns that show up at higher levels). For example, “Weakness × Economy” is cited as a motif that can arise from interacting constraints, but it is **not** a primitive definition. Treating P₂ as “economy” is a category error.

### 1.3 Null regime as a core test

The repo’s theory doc defines a *null regime* in which P₁, P₂, P₄, P₅ are present but **should behave reversibly** when P₃ and P₆ are absent. Only **P₃ (protocol)** and **P₆ (resource)** are allowed to break reversibility in this framing.

Practically, that becomes a testable statement:

- In null: long‑window **exact EP rate** ≈ 0 (with CI containing 0), and time‑odd currents (e.g., clock drift) ≈ 0.
- With P₆ on: EP rate becomes clearly positive and directed currents can appear.

---

## 2. Three compatible lenses on layered obstruction‑lifting dynamics

This repo effectively supports three “takes” on layered obstruction‑lifting dynamics. They are **compatible** because they emphasize different aspects of the same underlying structure.

### 2.1 Obstruction lifting

The overview note frames organization as requiring: (i) loops that break reversibility, (ii) state variables that store/rectify, and (iii) brakes that ensure boundedness. In an obstruction framing:

- **Obstruction O₁ (no persistent currents):** In time‑homogeneous detailed‑balance Markov dynamics, steady‑state probability currents vanish.
- **Obstruction O₂ (no autonomous clock drift):** A “clock” is a directed cyclic current; in reversible dynamics it cannot have a nonzero mean drift.
- **Obstruction O₃ (maintenance limits):** Under noise, maintaining a structured subset of states (“code space”, “viability set”) requires work; without a closure target and a resource gradient, repair is either undefined or thermodynamically unavailable.

Each primitive can be read as a way to remove one of these obstructions *selectively*, instead of hard‑coding “do X” goals.

### 2.2 MFQX atoms

The atoms note provides a compact vocabulary:

- **M (Memory):** something that can store structure (e.g., couplings).
- **F (Feasible):** something that constrains what’s allowed (capacities/constraints).
- **Q (Quantized):** discrete/topological degrees of freedom (counters, phases).
- **X (Drive):** a source of non‑equilibrium bias (work/resource).

This is useful as a design language: you can ask “what’s the smallest MFQX composition that supports an autonomous clock?” (Answer: at least Q+X, plus a cycle with ≥3 states.)

### 2.3 Error correction / spacetime

The spacetime note makes the strongest “mechanism” story in the repo: stable structure is treated as **encoded information** maintained against noise via active correction. The mapping is:

- **P₅ closure** defines what counts as “on‑code / viable”.
- **P₄ quantization** provides discrete syndrome/phase variables (or discrete clock bins).
- **P₆ resource** supplies the work needed to bias repairs “back toward code”.
- **P₃ protocol** can orchestrate measurement/repair steps even if each step is reversible in isolation.
- **P₁ operator‑write** can represent an adaptive decoder/controller in the dynamics itself.
- **P₂ feasible‑set‑write** constrains/regularizes repair pathways (budgets, locality).

This lens is also what naturally produces the “clock + code” experiments in `EXPERIMENTS.md`: a clock current is a physically realized time reference; a code field is a maintained structure.

---

## 3. The six primitives (repo definitions, substrate‑agnostic)

I’m restating these in the repo’s terms: **what is written**, **what changes**, and **what obstruction it targets**.

### P₁ — Operator‑write (write couplings)

- **Write target:** a coupling/operator structure (weights, kernels, connection strengths).
- **What changes:** the *generator of dynamics*—which transitions are energetically favored or suppressed.
- **Obstruction addressed:** without operator memory, “structure” must live only in fast variables; P₁ enables persistent “wiring” that can be selected or tuned.

### P₂ — Feasible‑set‑write (write constraints/capacities)

- **Write target:** capacities/constraints that gate feasibility (soft or hard budgets).
- **What changes:** the feasible region in state space (which transitions are allowed, saturated, or costly).
- **Obstruction addressed:** boundedness and brake‑like constraints are difficult to realize purely via energy bias; P₂ provides an explicit mechanism to *shape feasibility*.

**Important correction:** P₂ is not “economy/weakness”. Those are *motifs* that can emerge from constraints interacting. The primitive is the ability to *write the feasible set*.

### P₃ — Protocol (non‑commuting schedule)

- **Write target:** a schedule over kernels (time ordering of reversible steps).
- **What changes:** even if each kernel is reversible, a cycle of non‑commuting kernels can produce net pumping currents.
- **Obstruction addressed:** detailed‑balance time‑homogeneous dynamics cannot generate directed cycles; protocol creates time‑structure.

### P₄ — Topological / quantized (discrete counter)

- **Write target:** discrete/topological variables (an integer counter “click” variable).
- **What changes:** introduces robust discrete sectors and phase labels; supplies a minimal cycle substrate for clocks and symbolic regimes.
- **Obstruction addressed:** continuous degrees can be fragile under coarse‑graining; quantization stabilizes coarse symbols and enables oriented cycle currents when driven.

### P₅ — Closure (safe sets / viability fields)

- **Write target:** a closure/viability field that defines “safe set” structure.
- **What changes:** creates endogenous “repair” vs “damage” distinctions by anchoring dynamics to a viability criterion.
- **Obstruction addressed:** maintenance needs a target; closure defines what must be preserved.

### P₆ — Resource (chemical potential / work term)

- **Write target:** a resource gradient / chemical potential that adds antisymmetric work.
- **What changes:** breaks detailed balance, enabling sustained entropy production and directed currents.
- **Obstruction addressed:** autonomous directionality (clock drift, steady pumping) requires non‑reversibility; P₆ supplies it.

---

## 4. Minimal formal core

This section is intentionally small, but it is the “mechanism spine”.

### 4.1 Detailed balance vs currents

Consider a continuous‑time Markov process on discrete states \(i\) with transition rates \(w_{ij}\). Let \(\pi\) be the stationary distribution.

- **Detailed balance (reversibility):** \(\pi_i w_{ij} = \pi_j w_{ji}\) for all \(i,j\).
- **Probability current:** \(J_{ij} = \pi_i w_{ij} - \pi_j w_{ji}\).

If detailed balance holds, \(J_{ij}=0\) for all edges: no sustained currents.

### 4.2 Cycle affinity and entropy production

Define the edge log‑ratio \(A_{ij} = \ln\frac{w_{ij}}{w_{ji}}\). For a cycle \(C\), the **cycle affinity** is:

\[
\mathcal{A}(C) = \sum_{(i\to j)\in C} \ln\frac{w_{ij}}{w_{ji}}.
\]

- In reversible dynamics, \(\mathcal{A}(C)=0\) for all cycles.
- Nonzero \(\mathcal{A}(C)\) implies broken detailed balance and nonzero EP.

A common “exact EP” estimator for a trajectory is a sum over realized jumps of these log‑ratios.

### 4.3 Minimal clock statement (why 2 states cannot work)

A clock is an oriented cyclic current. In a time‑homogeneous Markov chain:

- With 2 states, the only “cycle” is back‑and‑forth; the net oriented current cancels in steady state.
- With ≥3 states, a biased ring can support a nonzero steady‑state current around the ring.

This is why P₄ (a discrete counter state) and P₆ (non‑reversible bias) form a minimal autonomous clock architecture: Q+X with ≥3 states.

### 4.4 Stratified substrates: when "laws" become state (meta layers and operator lifting)

A central design move in layered obstruction‑lifting dynamics is that the primitives (P₁-P₆) are not "about particles" or "about error correction" per se. They are a set of allowed transition kernels and bookkeeping constraints that can be instantiated on many substrates.

The simulator's key conceptual extension is **stratification**: we stack additional degrees of freedom ("meta layers") that are not directly observed in the base substrate, but which can be coupled to it. This yields a useful interpretation:

- **Base substrate:** the degrees of freedom we treat as "physical" (here: particles + bond graph + a lattice field).
- **Meta substrate(s):** additional fields that evolve under the same primitive moves, and that can bias or stabilize base-level structure via coupling terms.

This is the sense in which the architecture resembles a **meta-physics**: higher, less directly observed layers do not merely store copies; they can encode effective constraints or operators that shape what lower layers tend to do.

Operator lifting pushes this one step further. Instead of coupling layers with a fixed rule ("match cell-by-cell"), we lift the coupling rule itself into an explicit writable substrate. In the simulator this is done by introducing a token field `K` that represents a local kernel/operator used to predict an upper-layer field from a lower-layer field. Under drive (P₆), `K` can be selected/maintained because it changes the work/EP balance of repair.

A helpful schematic (conceptual):

layer l+1:   S_{l+1}  <->  (operator / kernel)  <->  S_l
                  ^                ^
                  |                |
              P₅ updates       P₅ updates (token moves)
              + P₆ work        + P₆ work (optional)

The rest of the paper should be read with this in mind: meta layers and operator lifting are not decorations; they are the mechanism by which "higher-level effective rules" can themselves become objects of dynamical selection.

---

## 5. The simulator as one instantiation

The simulator is a deliberately minimal lab in which:
- the **null regime** is reversible and measured to be EP ≈ 0, and
- turning on P₃/P₆ produces non-equilibrium signatures without adding goal-directed rules.

It is best understood as **two coupled substrates**:
1) a continuous particle system (the "physical" degrees of freedom), and  
2) a discrete lattice-field system (the "code/repair" degrees of freedom), which can be stacked into meta layers.

### 5.1 Substrate A: particles on a 2D torus

State:
- `n` particles with positions `(x_i, y_i) in [0,1)^2`, with periodic boundary conditions (torus distance).

Energy contributions (schematic; constants are parameters):
- **Repulsion:** soft-core pair repulsion, active for short distances.
- **Bonded springs:** for each particle pair `(i,j)` with bond weight `w_{ij}`, a quadratic spring energy proportional to `w_{ij}`.

Intuition:
- The particle subsystem is "physics-like": it has geometry, distances, and an energy landscape.
- It supplies a concrete base where P₁ updates (bond weights) have physical consequences (they reshape the bond energy that depends on distance).

### 5.2 Substrate B: discrete carriers (W, N, A, S)

In addition to particle positions, the simulator includes discrete/bounded carriers that can store and transform structure.

**P₁ carrier (W): bond weights on particle pairs**
- `w_{ij}` is an integer weight (bounded), updated by ±1 proposals.
- It contributes both to a quadratic "storage cost" and to bond energy (spring strength).

**P₂ carrier (A): per-particle allocation counter**
- `a_i` is a bounded integer per particle with its own quadratic storage cost.
- Important limitation of this instantiation: **A does not currently hard-budget W** (there is no strict conservation tying P₂ to P₁). P₂ here is an independent carrier channel, useful for testing reversibility and channel interactions, but not yet a full allocation-budget implementation.

**P₄ carrier (N): per-particle discrete counter**
- `n_i` is an integer counter (bounded) with quadratic storage cost.
- In experiments, N is also used as the natural home for "clock-like" dynamics because it is discrete and can be driven to carry a current.

**P₅ carrier (S): a lattice field (gridSize x gridSize)**
- `S(q)` is a bounded integer per grid cell.
- It is the primary "code/closure" field used in maintenance and repair experiments (it supports mismatch/error metrics, gating, and corruption/repair protocols).

### 5.3 Meta layers: stacked lattice-field substrates

Parameter: `metaLayers = L`.

For each meta layer l in {0..L-1}, the simulator includes additional lattice-based carriers:
- `S_l(q)` (meta S field on the grid),
- `A_l(q)` (meta A field on the grid),
- `N_l(q)` (meta N field on the grid),
- `W_l(e)` (meta W on lattice edges; not particle-pair bonds).

Crucially:
- **The same primitives act on meta layers** via the same kinds of local write moves (±1 bounded proposals), just targeting the meta arrays instead of base arrays.
- Meta layers are therefore "real state," not a post-processing abstraction.

Important implementation detail (to avoid over-claiming):
- In the current codebase, **only the S channel is coupled directly between the base S field and the first meta S layer**.
- Meta A/N/W are coupled among meta layers (l <-> l±1) but are not wired back to the base particle A/N/W channels.  
  This is sufficient for the code/repair experiments (which live primarily on S), but it means top-down influence "all the way to particle forces" is not yet implemented.

### 5.4 Dynamics: proposals, acceptance, and EP

Each step selects a move type (X, P₁, P₂, P₄, P₅, and optionally OpK) and proposes a bounded local change:
- particle displacement (X),
- increment/decrement an integer carrier (P₁/P₂/P₄/P₅),
- or token exchange for operator lifting (OpK; Section 5.6).

Null regime (P₃=OFF, P₆=OFF):
- acceptance is Metropolis: `a = min(1, exp(-beta * DeltaE))`,
- detailed balance holds in the intended reversible channels,
- and windowed exact EP estimates converge near 0.

Driven regime (P₆=ON):
- acceptance becomes `a = min(1, exp(-beta * (DeltaE - W)))`,
  where `W` is a work term injected by the drive (context dependent).
- The simulator tracks **exact EP** from forward/backward proposal/acceptance ratios (not only a naive proxy), enabling tight null tests.

P₃ (protocol/schedule) changes which kernels are composed in time (non-commuting update order), enabling loop currents without changing the underlying energies.

### 5.5 Cross-layer coupling: conservative and drive-only alignment

There are two distinct ways layers are made to "talk":

1) **Conservative coupling (`eta`)**  
   Adds an energy penalty for mismatch between adjacent layers. For S this includes base <-> meta0 and meta l <-> l+1.  
   This is equilibrium-like: the coupling term is part of DeltaE.

2) **Drive-only alignment (`etaDrive` with P₆)**  
   Adds a non-conservative work term that favors moves that *reduce* mismatch.  
   This is the mechanism used for **maintenance / self-healing**: repair succeeds by spending EP to push the system "uphill" against noise/corruption.

A subtle but important detail: in some gated regimes, drive-alignment work is intentionally disabled for base-layer alignment so that the clock-gated meta repair is the only active work source (this was needed to keep traversal/gating regressions honest).

### 5.6 Operator lifting: writable coupling operators via the K token substrate

Operator lifting is implemented for the S channel.

Instead of coupling an upper layer to a lower layer cell-by-cell, we define a **local predictive operator**:

- For each interface (base->meta0, meta0->meta1, ...) and each grid cell `q`,
  there is a small stencil of offsets `r` and an integer token budget `B_K`.
- A tensor `K(q,r)` allocates `B_K` tokens over stencil offsets.
- The normalized kernel `k(q,r) = K(q,r) / B_K` predicts the upper field from the lower:  
  `pred(q) = sum_r k(q,r) * S_lower(q+r)`.
- The coupling energy uses mismatch: `(S_upper(q) - pred(q))^2`.

Dynamics:
- `K` is updated by **token-exchange moves** (move one token from offset r0 to r1), preserving the per-cell budget exactly.
- These OpK moves are scheduled as part of P₅'s target selection (with `opKTargetWeight` controlling how often OpK vs S is targeted, while preserving the legacy RNG path at weight=1.0).

Drive:
- If `opDriveOnK=1`, the P₆ work term can act on OpK moves as well, allowing **selection over operators**: kernels that reduce mismatch become easier to maintain under drive.

This is the concrete "meta-physics" mechanism in the repo: the *rule* relating layers is not fixed; it becomes a stateful object that can be driven, selected, and maintained.

### 5.7 Clocks, gates, deadlines, hazards

Clock subsystem (used in the clock-code and deadline suites):
- A driven discrete state (`clock_state`) accumulates a current `Q` under P₆.
- The clock gates which spatial region is eligible for repair moves (quadrants or stripe bins), producing a scanning/attention-like control signal.

Deadline and hazard harnesses:
- Corruption/noise can be injected into a spatial region of the lattice code field.
- Repair is evaluated via recovery times, miss fractions, uptime tails, and EP budgets decomposed by move categories (clock/repair/opK/noise).
- The moving-hazard suite extends this by making the corruption target drift over time and measuring whether repair policies track.

### 5.8 What this instantiation does not yet do

To keep theory and implementation aligned, the report should state explicitly:

- P₂ does not currently implement a strict budget that constrains P₁.
- P₅/S does not currently feed back into particle forces or noise rates (beyond gating/measurement); it is a "memory substrate" in this instantiation.
- Operator lifting is implemented for S coupling only (not for W/N/A).
- Meta layers are lattice-field layers; they are not additional particle populations.

---

## 6. Evidence from the logged campaigns

All numbers below are copied from `EXPERIMENTS.md` and are reproducible via the recorded commands.

### 6.1 Tight exact‑EP null test

The “tight demonstration upgrade” introduced **exact EP accounting** and tested null vs drive:

| case | meanExactWindow | stdExactWindow | ciHalfWidth |
|---|---:|---:|---:|
| base_null | 3.505e‑6 | 5.345e‑5 | 4.685e‑5 |
| meta_null | 3.830e‑5 | 6.396e‑5 | 5.607e‑5 |
| p6_drive | 4.255e‑3 | 1.122e‑4 | 1.270e‑4 |

Interpretation: both null cases have CI containing 0 and satisfy the repo’s null‑tight threshold, while P₆ drive is clearly positive.

### 6.2 Clock current appears only under P₆

Clock current test summary (5 seeds, 2M steps, clockFrac=0.01):

- **Null:** drift in \([-7.8\times10^{-5},\, 4.6\times10^{-5}]\), EP rate ≈ 0  
- **P₆ drive:** drift ≈ \(3.15\times10^{-3}\) with consistent sign, EP rate ≈ \(3.3\times10^{-3}\)

This is a clean “directed current requires dissipation” signal in the implemented clock variable.

### 6.3 Drive-only code maintenance: self-healing as EP-funded error correction

The clearest "self-healing" demonstration in the log is the drive-only code-maintenance suite:

- Setup (conceptually): treat the lattice S field as an error-corrected code replicated across layers. Inject a localized corruption. Measure whether the system restores alignment (low mismatch) and whether reconstruction error collapses.
- Mechanism: with P₆ ON and `etaDrive>0`, P₅ moves that *reduce* cross-layer mismatch receive positive work, making repair statistically favored. In null mode the same moves are unbiased and do not sustain repair against noise/perturbations.

Representative outcomes (from the logged sweep tables; mean across seeds):
- **Null (no drive):** large mismatch (Sdiff ~ 7), nontrivial reconstructibility error (err(f=0.5) ~ 0.4), EP rate ~ 0.
- **Drive-only repair:** mismatch drops by >80% (Sdiff ~ 0.8), reconstructibility error collapses to ~0, and EP rate becomes clearly positive.
- **Clock-gated repair:** comparable fidelity to drive-only repair, but with higher EP (because repair is constrained to gated windows, increasing the work needed per unit time).

Interpretation (still strictly within the simulator):
- This is a controlled example of **maintenance with thermodynamic accounting**: recovery is not "free"; it is funded by P₆ work and shows up in EP.
- It also illustrates why the primitives are arranged as they are: P₅ supplies a closure/correction channel; P₆ supplies the work that turns that channel into sustained repair rather than relaxation.

### 6.4 Deadline tasks: clocks as scanning controllers for repair under noise

The deadline suite makes the maintenance problem harder: repair must happen *fast enough* in the presence of continuous noise and repeated corruption events.

Core design:
- A spatial **gate** restricts when/where repair actions can occur (e.g., stripe bins or quadrants).
- A **clock** (a driven discrete subsystem) advances the active gate region over time.
- A **deadline** is imposed per corruption event; failures are counted as "misses."

Key qualitative outcomes repeatedly observed in the logged runs:
- **Static gates fail** in hard regimes: if the active repair region never traverses the damaged region, recovery times blow up and miss fractions approach 1.
- **Drifting clocks improve reliability** relative to random/static controls under the same corruption schedule: the system benefits from systematic traversal.
- EP decompositions show that the improvement is paid for primarily in the repair channel's EP (and, in clock-heavy regimes, an additional clock EP contribution).

Interpretation:
- This is not "purpose" inserted by hand; the only extra ingredient is P₆ drive plus a gate that constrains when repair can act.
- The clock's role is *control-like*: it schedules attention/repair over space, creating a mechanistic bridge between a current (clock drift) and improved maintenance outcomes.

### 6.5 Operator lifting (S channel): K tokens, operator selection, and hierarchy signatures

Operator lifting is the most "meta" mechanism implemented: the system does not merely maintain a field across layers; it can maintain an *operator* that maps lower-layer structure into upper-layer structure.

What changes relative to fixed coupling:
- Fixed coupling says "upper cell should match lower cell."
- Lifted coupling says "upper cell should match a locally learned prediction of lower cells," where the prediction operator is represented by a writable kernel `K(q,r)`.

Three experimental findings from the campaign are especially relevant:

1) **Selection over operators is real and costs EP.**  
   In the drive-selection ablation, allowing drive to act on K (`opDriveOnK=1`) reduces operator mismatch substantially relative to freezing K drive (`opDriveOnK=0`) and relative to null controls, while producing a non-zero OpK EP contribution. This is exactly the analogue of "selection costs dissipation," but now in operator space rather than state space.

2) **Hierarchy/coarse-graining signatures appear when metaLayers >= 3.**  
   With more than two layers, composed-operator diagnostics show strong monotone trends in effective radius statistics across layer index (a coarse-graining-like signature). The signal is not universally strong for all metrics (e.g., total variation measures are weaker/mixed), but a consistent R2_eff growth across layers is observed in best-found configs.

3) **Maintenance efficiency shifts (exploratory but statistically supported in one slice).**  
   In deadline-style regimes, raw throughput matching hit a ceiling (op modes could not reach the baseline repair throughput within the allowed pSWrite range). However:
   - an iso-miss comparison shows a statistically significant EP reduction for an op mode relative to a dilution-only control (bootstrap CI excludes 0 for DeltaEP), and
   - repair-budget curves show a consistent dominance pattern: for fixed repair budgets N, one op mode achieves higher success probability than the baseline/dilution controls across the tested budgets (with bootstrap confidence bands).

Interpretation (carefully framed):
- The implemented operator lifting does not yet prove "semantic abstraction," but it **does** demonstrate that *operators themselves* can be maintained/selected as dynamical objects under the primitive set.
- This is the concrete sense in which meta layers + lifting define a "meta-physics" space: higher-layer coupling rules become endogenous state, and the system can pay EP to keep those rules in a useful regime.

### 6.6 Moving-hazard homeostasis (exploratory triage)

The moving-hazard suite was introduced as an exploratory next step beyond static deadlines: the corruption target (hazard region) changes over time, so repair must either (i) be robustly global or (ii) track the hazard's motion.

What was measured:
- standard deadline metrics (miss fraction, uptime tail, recovery percentiles),
- EP budgets and EP-per-repair-action,
- and a coarse-grained "repair motif" process defined over accepted P₅ actions (entropy, symmetry gap, coarse EP),
  plus weak tracking diagnostics (e.g., mutual information between hazard index and motif distribution).

Key observed pattern (qualitative):
- Op-mode variants produce a much richer repair action alphabet (higher motif entropy) and larger transition asymmetry (larger symmetry gap) than the legacy variant, indicating a more structured non-equilibrium action process under selection pressure.
- The instrumentation invariance control passes (logging does not measurably change dynamics with fixed seeds).
- An EP/action null control shows that the coarse-grained EP/action measures collapse to ~0 when the drive is removed, supporting that the motif irreversibility is selection-driven rather than an artifact of counting.

What remains unresolved:
- In these initial settings, increased action-graph richness does not automatically translate into lower miss fractions; hazard speed sweeps show non-monotone dependence and mixed A vs C performance depending on hazard hold time.
- The right success criterion for "tracking" may not be mutual information in the current coarse-graining; more targeted tracking metrics (predicting hazard location from repair policy, or measuring spatial error gradients) may be needed.

For report inclusion, this suite should be presented as a *triage result*: it demonstrates a robust dissipative action-transition structure under moving hazards and establishes key controls, but it does not yet establish a reliable performance advantage from operator lifting in this regime.

---

## 7. What is “done” vs what remains exploratory

The repo’s experiment log maintains a “safe claims” index. For the purpose of report inclusion:

Done:
- A null-regime-validated implementation of the primitive channels with **exact EP accounting**: when P₃=OFF and P₆=OFF, `epExactRateWindowLast` is tightly ~0 even with meta layers and (when enabled) operator coupling.
- A **two-substrate simulator** (continuous particles + discrete lattice fields) with a clean separation between reversible null dynamics and driven non-equilibrium behavior.
- A **meta-layer stack** (`metaLayers`) where P₂/P₄/P₅-style write moves act on higher layers as bona fide state variables, plus conservative coupling (`eta`) and drive-only alignment (`etaDrive`) as controlled interaction modes.
- A working **clock current + TUR harness** and a family of gating experiments showing when traversal matters.
- A family of **self-healing / maintenance tasks**: drive-only code maintenance, deadline traversal under noise, and a moving-hazard extension with instrumentation and null controls.
- A concrete **operator-lifted coupling mechanism** for the S channel: writable K-token kernels, selection under drive, and hierarchy/coarse-graining diagnostics (including composed-operator measures).

Exploratory:
- Whether the observed hierarchical statistics correspond to "abstraction" in any semantic sense (no claim made here).
- Whether operator lifting yields a universal reliability advantage in the hardest deadline/moving-hazard regimes; current evidence is mixed and throughput ceilings complicate fair comparisons.
- Extensions where meta layers feed back into the particle forces/noise rates (not implemented yet in this simulator).

---

## 8. Limitations and next expansions

To keep this report manageable, it does not yet provide:

1. A full mathematical treatment of protocol pumping (P₃) and constraints under which pumping is impossible (“no‑pumping” conditions).
2. Cross‑substrate realizations beyond this simulator (the primitives are intended to be substrate‑agnostic, but evidence here is one substrate).
3. A formal coarse‑graining analysis for why action‑level symmetry gaps can persist even when exact EP is ~0.
4. A systematic open‑endedness test suite.
5. In the current implementation, meta layers are **lattice-field layers**; only the S field is directly coupled to the base S field. Meta W/N/A do not currently feed back into the base particle channels.
6. The operator lifting implemented here is **S-only** and does not yet make the particle mechanics depend on S/K (so "top-down influence into particle physics" is a conceptual extension, not a present claim).

---

## 9. Speculative outlook: Why layered obstruction‑lifting dynamics might be ubiquitous (hypothesis‑generating; no claims)

> **Reader note (non‑claims):** Everything in this section is intentionally **speculative**. It is included to spark disciplined imagination and generate testable hypotheses. It is **not required** to accept any of the empirical claims reported above, and it is **not** presented as evidence‑backed inference from the simulator campaigns.

The experiments in Section 6 establish a narrow set of mechanistic existence proofs inside a controlled testbed: null correctness (exact EP≈0), dissipation‑priced directed currents, self‑healing under drive‑only repair, and (for S) a concrete operator‑lifting mechanism where “the interface law” becomes writable state. The questions below are: *if* these primitives are genuinely substrate‑agnostic, what kinds of broader interpretations become plausible—and what would we need to measure to move them out of philosophy?

### 9.1 “Substrate‑agnostic” may also mean “state‑space‑agnostic”

Layered obstruction‑lifting dynamics defines primitives as substrate‑agnostic; if the same “obstruction‑lifting moves” can act on physical variables and on latent operator variables, then similar motifs could, in principle, appear across many substrates and scales.

**Hypothesis:** A “state” here need not be only microphysical configuration. It can be a *physically encoded* representation of possibilities—latent variables, hypotheses, internal models—so long as those possibilities are carried by actual degrees of freedom (molecules, synapses, bits, tokens). On this reading, P₁–P₆ are as much about navigating a *space of what could be* as they are about evolving what already is, because “what could be” becomes physical once represented.

A useful discipline that comes with this framing is always asking:
- **Where is the representation physically stored?** (P₁)
- **What limits it and keeps it bounded?** (P₂)
- **What schedules/loops act on it?** (P₃)
- **What discrete sectors make coarse symbols robust?** (P₄)
- **What counts as viability / on‑manifold?** (P₅)
- **What resource gradient pays for maintaining it?** (P₆)

### 9.2 Meta layers as an endogenous “meta‑physics” vocabulary

In the simulator, meta layers are explicit stacked lattice fields coupled to the base layer (Section 5). Conceptually, this is a formal way to talk about degrees of freedom that are:
- less directly observed (latent),
- often slower (persistent),
- and able to bias or stabilize lower‑level patterns through coupling.

**Hypothesis:** In natural systems, many “higher layers” need not be spatial layers. They could be slow chemical regulators, developmental programs, learned internal models, institutional states, or other “hidden substrates” that nonetheless couple back into fast dynamics. If so, “meta‑physics” need not mean supernatural influence; it could mean: **higher‑level latent degrees of freedom that alter lower‑level effective dynamics**.

Important caution aligned with Section 8: the current implementation **does not** yet allow most meta variables to feed back into particle forces/noise rates; in this repo, “top‑down influence into particle mechanics” remains a conceptual extension rather than a present claim.

### 9.3 Operator lifting as “laws that can be written”

A key repo idea is **operator lifting** (Section 5.6): instead of fixing how layers couple, the coupling operator itself becomes writable state (`K` tokens), updated by reversible moves and optionally selected under drive.

**Hypothesis:** Operator lifting is a general mechanism for “effective laws becoming mutable” without teleology. It provides a way to formalize how systems can rewrite their own interface rules—within budgets and constraints—so that what counts as a good predictive/coordination relation can be shaped by selection pressure.

This is one reason the layered + lifted picture can feel “meta‑physical”: the *rule that relates layers* is not fixed; it is part of the system’s state, and therefore can be driven, selected, and maintained.

### 9.4 Extra substrates and open‑endedness as a design pattern

The current simulator fixes substrate sizes: fixed particle count, fixed grid size, fixed token budgets. Even within those bounds, adding new writable substrates (extra layers; lifted operators) expands what can be stored, selected, and maintained.

In obstruction‑lifting terms, “open‑endedness” could mean repeatedly creating *new writable substrates* (new layers, new operator alphabets, new closure notions) so that novelty does not saturate when any single substrate equilibrates. This is a hypothesis about *capacity expansion by added substrates*, not a claim that the present simulator already exhibits unbounded innovation.

This is not a claim about biology; it is a proposed *operational lens* for recognizing when a system’s “innovation space” is expanding.

### 9.5 Implications for AI and continual learning (hypothesis‑generating; no claims)

A tempting (and testable) way to read this theory for ML is **not** “P₁–P₆ as knobs around SGD,” but: *a neural learner is itself a substrate on which P₁–P₆ run as the microscopic physics of learning*. In that picture, training is not an external optimizer acting on a model; it is a nonequilibrium dynamical system whose “learning” is the emergent macroscopic behavior.

**Neural substrate reinterpretation.** Imagine the base substrate is a network with weights, activations, sparse gates, and local plasticity traces. Then:
- **P₁ (operator‑write)** is the act of writing couplings/operators: synaptic updates, rewiring, learned routing/attention kernels—anything that changes the effective operator the network applies to inputs.
- **P₂ (feasible‑set‑write)** writes *constraints on change*: plasticity budgets, saturation, protected subspaces, locality limits, resource caps on rewiring. Crucially, these constraints are themselves writable state, not fixed regularizers.
- **P₃ (protocol)** is the schedule of noncommuting phases: which update kernels are applied when (e.g., inference‑like passes, consolidation‑like passes, replay‑like passes). The key idea is that *order can matter at O(1)* because composing noncommuting updates produces qualitatively different trajectories than averaging them.
- **P₄ (quantized/topological)** provides discrete internal regimes: mode indices, phase bins, addresses, symbolic “which program is active” variables. In a neural context, this is where robust switching between skills/contexts can live without requiring a continuous interpolant.
- **P₅ (closure)** is the definition of “what must not drift”: a viability set over internal function. In ML terms, closure is a maintained constraint like “retain competence on past tasks” or “keep these internal codes aligned,” implemented as a repair channel, not as a static penalty.
- **P₆ (resource/drive)** is the work source that biases updates toward goals: reward, supervision, curiosity signals, metabolic/compute budgets—anything that breaks detailed balance and pays for maintenance against noise/interference.

**Meta layers as continual learning, not as architecture garnish.** In this framing, “meta layers” are additional writable substrates that store slower, more persistent structure than fast synapses: long‑term codes, learned decoders, credit‑assignment scaffolds, plasticity policies, or interface operators. Continual learning then becomes a *layered maintenance problem*: fast layers adapt; slow layers preserve and repair; coupling between them defines what is “remembered.” Catastrophic forgetting is simply a closure failure (P₅) under insufficient drive/budget (P₆/P₂).

**Why this could change sample efficiency (the noncommutativity intuition).** If different task contexts effectively activate different update operators, then learning is not just “fit task A.” The trajectory depends on *which operators you apply in what order*, and revisiting A after B,C,D can be genuinely productive because B,C,D have modified the internal substrates (operators, constraints, discrete modes) that A now acts through. Said differently: the learner is building the tool while using it; spacing/interleaving is not a nuisance but a mechanism (P₃) for sculpting the substrates that determine future learning.

**Operator lifting as learned interfaces (a concrete bridge).** The repo’s operator‑lifting idea suggests a neural analogue: instead of hard‑coding how “slow memory” talks to “fast computation,” lift that interface into writable state (a learnable kernel/router/decoder) and allow drive to select and maintain it. This makes “how to update / how to route / how to decode” part of the substrate, not part of the optimizer.

This section is speculative by design. The falsifiable version is straightforward: implement a neural instantiation where (i) P₅ defines a maintained skill set, (ii) P₆ pays for repair, (iii) P₃ schedules noncommuting phases, and (iv) meta substrates store slower structure; then measure whether revisitation/interleaving yields systematic gains in retention and sample efficiency at a measurable dissipation cost.

### 9.6 Evolution as recursive substrate design

Biological evolution does not only select organisms; it also shapes developmental machinery, regulatory architectures, and “ways of varying” (often discussed under evolvability).

**Hypothesis:** In obstruction‑lifting terms, evolution can be seen as a process that not only searches over phenotypes, but also progressively discovers and stabilizes *better substrates for search*—i.e., it “learns how to learn” by making previously fixed constraints and operators partially writable and selectable.

### 9.7 Life before replication?

Many origin‑of‑life narratives treat replication as the first essential ingredient.

**Hypothesis:** The error‑correction / spacetime lens suggests a different ordering worth exploring: closure‑plus‑repair (P₅), coupled to a resource gradient (P₆), might yield persistent self‑maintenance under noise *before* high‑fidelity replication exists. Replication would then be a later specialization that exploits already‑maintained structure.

This is not asserted as a historical claim; it is a prompt for model design: study the smallest MFQX compositions that yield persistent maintenance, and treat replication as an optional add‑on rather than a prerequisite.

### 9.8 Scale agnosticism and the temptation of cosmology

Because the primitives are defined operationally, they are not tied to a particular spatial scale. Wherever there is nonequilibrium drive, memory, constraints, discrete sectors, and closure/repair, a primitive‑aligned decomposition might be attempted.

**Hypothesis (very speculative):** This invites—but does not justify—thinking about whether some large‑scale structures (ecosystems, economies, perhaps even astrophysical systems) could be described as layered substrates with hidden variables and effective couplings. It also tempts analogies to “dark” degrees of freedom (e.g., dark matter/energy) as unseen substrates that bias visible dynamics.

We stress: in this paper, such notions are metaphor, not model. The value is in a disciplined question set: *what is the substrate, what is written, what is the closure, what is the resource, and where is the EP/current?*

### 9.9 How to make this less philosophical

If any of the above is to become more than metaphor, it should cash out as measurable hypotheses. Examples aligned with Section 8’s limitations:

- Add explicit **meta→particle feedback** (e.g., allow S/K to modulate bond energies or noise rates) and test for genuinely new behaviors while preserving null correctness.
- Implement an explicit **open‑endedness test suite** (novelty under fixed budgets; creation of new writable substrates under constraints; long‑horizon diversity measures).
- Try **cross‑substrate instantiations** (symbolic substrate; pure network substrate) to test which signatures generalize.

---

## 10. Reproducibility pointers

All commands, presets, and output artifacts are in `EXPERIMENTS.md`. Key scripts cited above include:

- `node scripts/test-ep-null-tight.mjs`
- `node scripts/test-clock-current.mjs`
- `node scripts/run-code-maintenance.mjs`
- `node scripts/test-clock-deadline-traversal.mjs`
- `node scripts/run-deadline-event-stats.mjs`
- `node scripts/run-deadline-opk-ci-iso.mjs`
- `node scripts/run-deadline-opk-repair-budget-curves.mjs`

---

## Appendix: why the earlier draft wasn’t patchable

The earlier draft had structural failures: it replaced primitive definitions with motifs (“economy”), omitted the quantized/symbolic core of P₄, and did not carry the obstruction and error‑correction mechanisms into the explanation. This version rebuilds the theory spine from the repo docs and anchors evidence in the experiment log.
