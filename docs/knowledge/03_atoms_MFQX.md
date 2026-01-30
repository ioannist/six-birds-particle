# Optional “Atoms” Vocabulary (M, F, Q, X)

This note captures a compact “atom” vocabulary used in earlier theory building. It is optional for the playground implementation but useful as a conceptual compression.

## Atom M — Monotone memory

A mechanism that stores past events so that reversing them becomes hard.

In strict form: a state variable \(m_t\) with \(m_{t+1}\ge m_t\).  
In A‑Life-clean form: metastable memory where reverse transitions exist but are exponentially suppressed.

Related primitives:
- P₁ (operator memory), P₄ (click indices), P₅ (field persistence), sometimes P₂ (institutionalized constraints).

## Atom F — Flow geometry / noncommutativity

Order-of-operations effects where
\[
K_B K_A \ne K_A K_B.
\]
Cyclic protocols (P₃) generate holonomy/pumped currents when the protocol is external or the phase is hidden; in an autonomous lifted model with phase included, P₃ alone is not a directionality audit.

Related primitives:
- P₃ most directly.

## Atom Q — Quantization / discrete teeth

Discrete states (integers, topological indices) that support “clicks” rather than continuous drift.

Related primitives:
- P₄.

## Atom X — Resource inequality / nonequilibrium affinity

A nonconservative drive that breaks detailed balance, often expressible as a chemical potential difference or “work” term.

Related primitives:
- P₆ (and P₃ only when implemented as an externally driven protocol or hidden clock).

---

## Mapping atoms → primitives (informal)

- P₁: M (operator stored), sometimes X (if maintenance requires drive)
- P₂: M (constraint institutionalization), X (if capacity needs energy), often coupled to Q (thresholding)
- P₃: F
- P₄: Q (+ M when barriers grow)
- P₅: M (field persistence) + X (maintenance vs decay)
- P₆: X (+ M if banking/accumulation becomes metastable)

---
