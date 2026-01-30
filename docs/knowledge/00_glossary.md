# Glossary

This glossary standardizes terms used across the docs.

## Ratchet (general)

A **ratchet** is a mechanism that can produce **persistent directionality** in some coarse-grained quantity (a “pattern”) in a way that is:
- **self-controlled** (bounded; no runaway),
- **self-reinforcing** (feedback increases the likelihood/size of future steps),
- and often **one-way** on relevant timescales (reversals are forbidden or exponentially rare).

In A‑Life-clean setups, “one-way” is typically **metastability** (rare reversals), not hard-coded monotonicity.

## Pattern

A **pattern** is a coarse-grained observable \(P(Z)\) (cluster structure, graph backbone, safe-set region, integer index, etc.) derived from the full state \(Z\).

We distinguish:
- **Strong lock-in:** \(P\) is provably monotone (rare in A‑Life-clean models unless explicitly irreversible).
- **Metastable lock-in:** \(P\) persists for a long time; reversals are exponentially suppressed.

## Fast–slow split

We model the world state as:
\[
Z_t = (X_t, W_t).
\]
- \(X_t\) = fast substrate (particle positions, headings, etc.).
- \(W_t\) = slow variables that store structure/constraints/resources (bonds, budgets, counters, fields).

The primitives typically act by enabling transitions on \(W\) (or altering the operator acting on \(X\)).

## Detailed balance (reversibility)

A Markov process on \(Z\) is **reversible** w.r.t. a stationary distribution \(\pi(Z)\) if:
\[
\pi(z)\,P(z\to z') = \pi(z')\,P(z'\to z)\quad\text{for all }z,z'.
\]
Equivalent condition (Kolmogorov cycle criterion):
- the **cycle affinity** is zero for every directed cycle.

Reversibility implies **no stationary probability currents** (no intrinsic arrow-of-time).

## Cycle affinity

For edge transitions with probabilities/rates \(P(z\to z')\), define edge affinity:
\[
a(z\to z') := \log\frac{P(z\to z')}{P(z'\to z)}.
\]
For a directed cycle \(\gamma\),
\[
\mathcal A(\gamma) := \sum_{e\in\gamma} a(e).
\]
If any \(\mathcal A(\gamma)\neq 0\), the process is nonreversible (directional flux is possible).

## Primitive (P₁–P₆)

A **primitive** is a toggleable *mechanistic* operation (not a global objective) that adds a family of transitions or operator modifications to the substrate.

The six primitives used in the playground are:

- **P₁ Operator-write:** writable couplings/weights that alter effective dynamics.
- **P₂ Feasible-set-write:** writable constraints/capacities (local apparatus; budgets).
- **P₃ Protocol-cycle:** cyclic order-of-operations / time-dependent driving.
- **P₄ Topological/quantized:** integer “click” variables / discrete transitions.
- **P₅ Closure / viability field:** build/erode a protective field; safe sets as observables.
- **P₆ Resource transduction:** non-equilibrium coupling to a resource/chemical potential.

## Null regime (no baked-in directionality)

In the playground, the **null regime** means:
- P₃ = OFF and P₆ = OFF,
- other primitives may be ON,
- the resulting dynamics must satisfy detailed balance with respect to an explicit stationary measure.

This ensures no “bias to evolve” is accidentally hard-coded.

---
