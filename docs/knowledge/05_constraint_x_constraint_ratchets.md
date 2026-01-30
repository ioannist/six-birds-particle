# Constraint×Constraint Ratchets (General Pattern)

A **Constraint×Constraint** motif is a structure where a capability is bounded by:
1) a **local sensitivity cap** (per action / per token / per step), and
2) a **global budget cap** (total cost / total steps / total exposure),

often implying a product-like bound:
\[
\text{capability} \;\lesssim\; (\text{global budget})\times(\text{local cap}).
\]

Weakness × Economy is the canonical example in communication systems.

## 1) Abstract template

Let a process reveal information or exert influence over \(L\) steps.

- Local cap:
  \[
  \text{per-step gain } g_t \le \varepsilon.
  \]
- Global budget:
  \[
  L \le B.
  \]
Then total gain is bounded:
\[
\sum_{t=1}^L g_t \le B\varepsilon.
\]

This holds for many notions of gain:
- information gain (KL),
- expected improvement,
- leverage or marginal risk contribution, etc.

## 2) Stabilization vs ratcheting

At fixed constraints, the motif gives **stabilization**:
- local exploits are capped,
- total activity is capped.

A true ratchet (one-way frontier growth) requires the constraints to change across epochs:
- \(B_k\) and/or \(\varepsilon_k\) must increase in a way that remains self-controlled.

In A‑Life-clean settings, such changes must emerge from primitive interactions (e.g., P₂/P₆) and not be scheduled externally.

## 3) Why this motif is common across disciplines (informal)

Many domains separate safety/robustness into:
- “no single action can do too much damage” (local cap),
- “total exposure is limited” (global cap).

Examples (conceptual parallels):
- privacy loss per query + total query budget,
- position-level risk caps + total leverage/capital constraint,
- Lipschitz/robustness bounds + model capacity constraints,
- per-interaction influence caps + total communication bandwidth,
- per-step actuation bounds + total energy budget.

The motif’s value is that it yields simple, checkable inequalities and makes “reward hacking” or “single-shot dominance” structurally difficult.

---
