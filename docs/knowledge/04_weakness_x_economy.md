# Weakness × Economy (Canonical Constraint×Constraint Scaffold)

This note is a self-contained mathematical scaffold for **Weakness × Economy** as a mechanism that produces *safe expressivity* in evolving codes.

It is included here because it provides:
- a clean example of “two constraints + an ambient drive,”
- a tractable inequality \(I^\star \lesssim (B/c_{\min})\,\varepsilon\),
- and a clear separation between **stabilization** at fixed budgets vs **ratcheting capacity** when budgets themselves evolve.

Although the Ratchet Playground does **not** implement global objectives, this scaffold is useful for:
- interpreting P₂-type “feasible-set write” phenomena,
- designing optional “communication toy worlds” inside the app,
- and connecting ratchet theory to established information-theoretic literature.

---

## 1) Setup

- Meanings \(M\in\mathcal M\), with prior \(P(m)\).
- Signals/forms \(S\in\mathcal S\) (or sequences \(S_{1:L}\)).
- Encoder \(\phi(s\mid m)\).
- Decoder \(\psi(m\mid s)\).
- Bayes-optimal decoder:
  \[
  \psi^\star(m\mid s) \propto P(m)\phi(s\mid m).
  \]

### Expressivity / accuracy
Use mutual information:
\[
I(M;S)=\mathbb{E}\Big[\log\frac{P(M\mid S)}{P(M)}\Big].
\]

### Economy (global budget)
A convex cost \(c(s)\ge 0\). Define:
\[
\mathrm{Cost}(\phi)=\mathbb{E}[c(S)].
\]
For sequences, total cost \(C=\sum_{t=1}^L c(S_t)\) and a budget constraint:
\[
\mathbb E[C]\le B.
\]
Assume \(c(s)\ge c_{\min}>0\) for non-null symbols, so the budget bounds expected length:
\[
\mathbb E[L]\le B/c_{\min}.
\]

### Weakness (local anti-leverage)
Define the maximum posterior “yank” from a single form:
\[
\mathrm{Str}(\phi):=\max_{s\in\mathcal S} D_{\mathrm{KL}}\!\big(P(\cdot\mid s)\,\|\,P(\cdot)\big).
\]
Low \(\mathrm{Str}\) means no single token can dominate interpretation.

---

## 2) Free-energy objective (fixed epoch)

A common analysis objective is:
\[
\mathcal F(\phi)= I(M;S) - \lambda\,\mathrm{Cost}(\phi) - \mu\,\mathrm{Str}(\phi),
\qquad \lambda,\mu>0.
\tag{WE-F}
\]

This is a *within-epoch* optimization principle. In many learning dynamics (mirror descent, replicator-like flows), \(\mathcal F\) can act like a Lyapunov function under suitable regularity.

**Important distinction:**
- At fixed \((\lambda,\mu)\) (or fixed budgets), the system can converge to a stable code \(\phi^\star\).  
- That is **stabilization**, not necessarily a “ratchet” in the sense of ever-increasing expressivity.

---

## 3) A key inequality: expressivity is bounded by product of budgets

To make “weakness” local in time, consider sequential signaling \(S_{1:L}\) with per-step weakness cap:
\[
\mathrm{Str}_t := \sup_{s^t} D_{\mathrm{KL}}\!\big(P(M\mid s^t)\,\|\,P(M\mid s^{t-1})\big)\le \varepsilon.
\tag{WE-local}
\]

Then:
\[
I(M;S_{1:L})
=\sum_{t=1}^L I(M;S_t\mid S_{1:t-1})
\le \sum_{t=1}^L \mathrm{Str}_t
\le L\,\varepsilon.
\]
With \(L\le B/c_{\min}\), we get:
\[
\boxed{
I(M;S_{1:L}) \;\le\; \frac{B}{c_{\min}}\,\varepsilon.
}
\tag{WE-bound}
\]

This expresses a canonical “Constraint×Constraint” structure:
- local cap \(\varepsilon\) (weakness),
- global cap \(B\) (economy),
- expressivity bounded by their product.

---

## 4) No-hack lemma (bounded unilateral influence)

Let \(\epsilon:=\mathrm{Str}(\phi)=\max_s D_{\mathrm{KL}}(P(\cdot\mid s)\|P(\cdot))\). Then by Pinsker:
\[
\max_s \mathrm{TV}(P(\cdot\mid s),P(\cdot))
\le \sqrt{\tfrac12\,\epsilon}.
\tag{WE-Pinsker}
\]
So any single-symbol exploit has bounded effect.

This motivates the “anti-leverage” interpretation: weakness suppresses single-token reward hacking.

---

## 5) Existence and stability (fixed budgets)

Under mild compactness / finiteness assumptions (finite alphabets or compact policy classes; convex lower-semicontinuous cost; upper-semicontinuity of mutual information), maximizing (WE-F) admits at least one maximizer \(\phi^\star\).

With suitable learning dynamics on \(\phi\), \(\mathcal F\) can serve as a Lyapunov function:
\[
\dot{\mathcal F}(\phi_t)\ge 0,
\]
so the code improves until it reaches a stationary point.

**Interpretation:** within a fixed constraint regime, Weakness × Economy supports stable, bounded codes.

---

## 6) When does this become a *ratchet*?

A true capacity ratchet means a sequence of epochs \(k\) where the achievable frontier expands:
\[
I_{k+1}^\star \ge I_k^\star \quad \text{(one-way growth)},
\]
and ideally with increasing increments (self-reinforcement).

Define a “capacity budget”:
\[
p_k := \frac{B_k}{c_{\min}}\,\varepsilon_k.
\]
From (WE-bound), \(I_k^\star\lesssim p_k\).

### Key implication
If \(B_k,\varepsilon_k\) are fixed, \(p_k\) is fixed ⇒ \(I_k^\star\) is bounded ⇒ after convergence there is no further growth.

So for a ratchet in expressivity you need **budgets to evolve**:
\[
p_{k+1} > p_k.
\]

In higher-level models, such budget evolution can arise from:
- resource capture (P₆-type coupling),
- protocol changes (P₃),
- or endogenous constraint-writing dynamics (P₂).

In the Ratchet Playground base layer, budgets are not scheduled externally; they would have to emerge as persistent variables (P₂/P₆) under a drive.

---

## 7) Contrast as a corollary of weakness (informal)

Weakness penalizes high leverage. To maintain mutual information under a leverage cap, discrimination must be distributed across patterns, often implying a minimum separation among conditional signal distributions:
\[
\min_{m\neq m'} D_{\mathrm{JS}}\big(\phi(\cdot\mid m)\,\|\,\phi(\cdot\mid m')\big)
\gtrsim \alpha(\mu,\lambda,\text{noise})>0,
\]
in regimes where an optimum exists.

This “contrast floor” is a derived pressure, not a primitive.

---

## 8) Relation to primitives

Weakness × Economy is best viewed as a **P₂-level motif** (feasible-set / constraint structure) rather than a primitive itself:

- “Economy” corresponds to global budgets/costs.
- “Weakness” corresponds to local leverage caps or saturating influence.

In the A‑Life playground:
- we avoid implementing (WE-F) as a global objective;
- we can implement “economy” and “weakness” as **physics** (convex costs, saturating impact) or as **local constraints** stored in \(W\) (P₂).

---
