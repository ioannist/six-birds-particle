# Ratchet Motifs and Asymmetries (Supplement)

This note collects supplemental analysis that may be useful for interpreting results from the playground. It is not required for the core A–D deliverables.

## 1) Stabilization vs ratchet (core distinction)

Many two-term systems produce a stable equilibrium but do not “ratchet”.

- **Stabilization:** a Lyapunov function exists; dynamics converge to a stationary point under fixed constraints.
- **Ratchet:** there exists a coarse variable \(P(Z)\) with persistent directional drift or metastable stepwise growth, typically requiring:
  - a non-equilibrium source (P₃/P₆),
  - a rectification/memory channel (P₁/P₄/P₅ and sometimes P₂),
  - and brakes (boundedness).

Weakness × Economy at fixed \((\lambda,\mu)\) is primarily a stabilization mechanism (within-epoch optimization). It becomes a ratchet only if the constraint regime itself changes across epochs.

## 2) Motif: Expand × Rectify

A canonical motif has two interlocking parts:

- **Expand:** explore/activate new degrees of freedom (e.g., a protocol or noise-driven exploration).
- **Rectify:** convert transient structure into memory (e.g., bonds, counters, barriers).

This often yields self-reinforcement and one-way behavior by default if rectification is monotone or metastably absorbing.

In primitive terms:
- Expand can be driven by P₃ and/or P₆.
- Rectify often uses P₁ (operator-write), P₄ (click variables), P₅ (fields).

## 3) Motif: Constraint × Constraint

Here capability is bounded by:
- a local cap and a global budget (Weakness × Economy is canonical).

At fixed constraints this is self-controlling but typically not open-ended. A “capacity ratchet” requires constraints to change in a self-controlled way.

In primitive terms:
- constraints live naturally in P₂,
- budgets can become dynamical under P₆-type resource coupling,
- protocol effects (P₃) can route effort across contexts.

## 4) A useful asymmetry hypothesis

An observed asymmetry in many designs:

- Expand×Rectify motifs can be **SC+SR+OW** “by default” if rectification creates metastable memory and expand continues to supply variation.
- Constraint×Constraint motifs tend to be **SC by default** (bounded), but **SR/OW** require:
  - a mechanism for constraint/budget adaptation, and/or
  - a non-equilibrium driver that keeps generating exploitable gradients.

This is not a law, but a recurring structural difference:
- Memory writes naturally accumulate if decay is slow.
- Constraint regimes do not expand unless something supplies the additional degrees of freedom (resources, apparatus, protocols).

The Ratchet Playground is designed to test such hypotheses empirically without inserting schedules.

---
