# The Six Primitives P₁–P₆

This document defines the six primitives used in the Ratchet Playground in a way that supports:
- rigorous null-regime reversibility,
- toggleable mechanism design (no global objectives),
- and later cycle-affinity analysis.

We use a fast–slow state:
\[
Z_t=(X_t,W_t),
\]
where \(X_t\) is the fast substrate and \(W_t\) contains slow variables (memory / constraints / fields).

## P₁ — Operator-write

**Intuition:** The effective “operator” governing interactions can itself be modified locally. In practice this means writable couplings/weights that alter the dynamics.

**Canonical state variable:** bond/coupling levels \(w_{ij}\).

- \(w_{ij}\) strengthens or weakens the influence between \(i\) and \(j\).
- In null regime, \(w_{ij}\) must be reversible (up and down transitions both exist).

**What P₁ can enable:**
- persistent interaction backbones (graphs),
- changes in mixing/synchronization properties,
- structural memory in the operator itself.

**What P₁ cannot do alone:**
- create a thermodynamic arrow-of-time (in null regime it must remain reversible).

## P₂ — Feasible-set-write

**Intuition:** The system can locally modify what it is capable of doing (constraints/capacities), again without a global schedule.

**Canonical state variable:** apparatus/capacity level \(a_i\).

- \(a_i\) controls local capabilities (e.g., max signal amplitude, max bond maintenance, max update frequency).
- In null regime, \(a_i\) is reversible.

**What P₂ can enable:**
- adaptive local constraint landscapes,
- endogenous changes in “expressivity capacity” if a drive exists,
- Constraint×Constraint motifs (e.g., Weakness × Economy) at higher modeling levels.

**What P₂ cannot do alone:**
- guarantee monotone growth of capacity without a drive (P₆) or externally imposed protocol; P₃ alone is a holonomy diagnostic and does not certify directionality in an autonomous model.

## P₃ — Protocol-cycle

**Intuition:** The order of operations matters. A cyclic protocol (A→B→C→…) can generate geometric currents even when each substep is individually reversible.

**Canonical representation:** a phase \(\phi(t)\) that modulates which kernel is applied or modifies proposals.

**Key property:**
- P₃ does not store memory by itself; it is a *protocol/holonomy* effect (order of operations).
- If the protocol is external or its phase is hidden, noncommutativity can yield **stroboscopic asymmetry** in the observed process:
  \[
  K_{\rm cyc}=K_C K_B K_A \quad\text{nonreversible if }[K_A,K_B]\ne 0.
  \]
  In an **autonomous lifted model** that includes the phase variable and has reversible phase dynamics with a common stationary distribution, P₃ alone does **not** certify a sustained arrow-of-time audit.

**What P₃ can enable:**
- pumped currents,
- hysteresis loops in observable planes,
- holonomy/route-mismatch diagnostics; any directionality claim must be supported by a P₆ audit (nonzero affinity) or an explicit external schedule.

## P₄ — Topological/quantized

**Intuition:** Discrete “click” variables (integer indices) support stepwise transitions and robust coarse states.

**Canonical state variable:** integer counter \(n\in\mathbb Z\) (bounded in practice).

- In null regime, \(n\) performs reversible \(\pm 1\) jumps with no drift.
- Under drive, \(n\) can drift; barriers can make reversal times long (metastable lock-in).

**What P₄ can enable:**
- discrete event detection (“clicks”),
- robustness against small perturbations (coarse state labels),
- barrier-controlled metastability.

## P₅ — Closure / viability-field

**Intuition:** The environment can accumulate protective structure (or constraints) that define “safe” regions — but without planner-like monotone closure.

**Canonical state variable:** a protection field \(S_q\) on a grid.

- \(S_q\) can increase or decrease (build and erode).
- The “safe set” is an observable:
  \[
  K_t := \{q: S_q(t)\ge\tau_S\},
  \]
  which can grow or shrink.

**What P₅ can enable:**
- emergent protected regions,
- coarse “habitat” structures,
- metastable safe domains when maintenance beats decay.

## P₆ — Resource transduction

**Intuition:** The system couples to a resource/chemical potential field. This is a primitive way to break detailed balance without prescribing what structure is “good”.

**Canonical ingredient:** a field \(\mu(x)\) and/or a stored resource variable \(r_i\).

Two minimal implementations:
1) **Affinity-only P₆:** P₆ supplies a work term \(W(z\to z')\) in acceptance ratios for memory updates.
2) **Explicit resource variable:** \(r_i\) evolves via local harvest/leak and couples to other updates.

**What P₆ can enable:**
- non-equilibrium flux,
- sustained maintenance of nontrivial memory patterns,
- coupling of contexts (high vs low \(\mu\)) to directional loops (cycle affinities).

---

## How the primitives split in the null regime

In the Ratchet Playground design:

- P₁, P₂, P₄, P₅ are **reversible channels** in the null regime (detailed balance is enforced).
- P₆ is the only primitive that directly introduces nonconservative affinities / work terms.
- P₃ introduces protocol holonomy; it can create **apparent** irreversibility only when the protocol is external or the phase is hidden (protocol-trap). With phase included (A_AUT), P₃ alone does not yield a sustained arrow-of-time audit.

This ensures “no bias to evolve” unless the user explicitly enables P₆ drive (or imposes an external schedule).

---
