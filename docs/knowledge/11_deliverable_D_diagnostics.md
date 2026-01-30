# Deliverable D — On‑Screen Diagnostics (No Interpretation Baked In)

Diagnostics must measure:
- irreversibility / arrow-of-time (cycle affinity),
- structure / patterns (descriptive),
- persistence (metastability),
without implying “progress” or optimizing anything.

All metrics are designed to be computable online with a sliding window \(T_w\).

---

## D1) Minimal event log

Record accepted events as:
\[
e=(\texttt{type}, \Delta, \text{context}, \Delta E),
\]
where:
- type ∈ {w, a, n, S, x}
- \(\Delta=\pm 1\) for memory variables (w,a,n,S)
- context includes (optional) bins: \(c_\mu\) (H/L), \(c_\phi\) (protocol phase bin), \(c_q\) (grid region)
- \(\Delta E\) is energy difference for accepted moves (useful for debugging)

Motion events (type x) can be tracked via per-frame summaries rather than per-move logs.

---

## D2) Irreversibility diagnostics

### D2.1 Net flux per variable

For each memory variable type \(y\in\{w,a,n,S\}\) in a window:
\[
N_y^+,\ N_y^-.
\]
Define net flux:
\[
J_y := \frac{N_y^+ - N_y^-}{T_w}.
\]

### D2.2 Empirical edge affinity per variable

With pseudocount \(\alpha\) (e.g., 1):
\[
A_y := \log\frac{N_y^+ + \alpha}{N_y^- + \alpha}.
\]

### D2.3 Memory entropy production proxy

\[
\Sigma_{\mathrm{mem}} := \sum_{y} J_y A_y.
\]
- In null regime: \(\Sigma_{\mathrm{mem}}\approx 0\).
- Under P₃/P₆: \(\Sigma_{\mathrm{mem}}\) may become nonzero.

### D2.4 Motif M6 loop affinity estimator

For each \(y\), bin events by high/low \(\mu\) context:

- \(N_H^{y+},N_H^{y-},N_L^{y+},N_L^{y-}\).

Define:
\[
\widehat{\mathcal A}_{M6}(y)
:=\log\frac{(N_H^{y+}+\alpha)(N_L^{y-}+\alpha)}{(N_H^{y-}+\alpha)(N_L^{y+}+\alpha)}.
\]
This directly estimates the two-context loop bias from Deliverable C.

---

## D3) Protocol-cycle diagnostics (P₃)

### D3.1 Pumped displacement per protocol period

Let \(T_\phi\) steps define one protocol period. For cycle \(k\):
\[
D_k := \frac{1}{N}\sum_{i}\mathrm{unwrap}\big(x_i(t_k+T_\phi)-x_i(t_k)\big).
\]
Define pumped current:
\[
J^{\mathrm{pump}}_k := \frac{D_k}{T_\phi}.
\]

### D3.2 Hysteresis loop area (geometric signature)

Pick two observables \(O_1(t),O_2(t)\) sampled across the cycle. Compute polygon area:
\[
\mathcal L_k := \frac12\sum_m (O_1^{(m)}O_2^{(m+1)}-O_1^{(m+1)}O_2^{(m)}).
\]
Nonzero \(\mathcal L_k\) indicates phase-lag / noncommutativity in that observable plane.

---

## D4) Structure descriptors (pattern snapshots)

### D4.1 P₁ bond graph
Choose threshold \(\tau_w\). Define:
\[
G_\tau(t)=\{(i,j): w_{ij}\ge\tau_w\}.
\]
Show:
- edge count, mean degree,
- giant component size,
- number of connected components,
- histogram of \(w\).

Optional: spectral-gap proxy via a few power iterations.

### D4.2 P₂ apparatus
Show:
- mean/variance of \(a\),
- histogram,
- neighbor correlation \(\mathrm{corr}(a_i,\overline a_{\mathcal N(i)})\).

### D4.3 P₄ counters
Show:
- histogram of \(n\),
- mean and mean magnitude,
- flux/affinity \(J_n,A_n\).

### D4.4 P₅ field / safe-set observable
Show:
- heatmap of \(S_q\),
- mean field,
- area fraction above threshold:
  \[
  A_S := \frac{1}{G^2}\#\{q:S_q\ge\tau_S\},
  \]
- connected components and largest component fraction.

### D4.5 P₆ resource (optional explicit variable)
If explicit \(r_i\) is used:
- mean/variance, histogram,
- inequality proxy (Gini).

---

## D5) Persistence / metastability diagnostics

### D5.1 Jaccard stability for set patterns

For any set-valued pattern \(A(t)\), define:
\[
d_J(t;\Delta)=1-\frac{|A(t)\cap A(t-\Delta)|}{|A(t)\cup A(t-\Delta)|+\epsilon}.
\]
Use to display “time since last large change” for:
- bond graph backbone \(G_\tau\),
- safe-set \(K_{\tau_S}\).

### D5.2 Partition stability (if clustering is used)
Compute ARI or VI between cluster labels at \(t\) and \(t-\Delta\).

### D5.3 Reversal event rates
For a scalar observable \(Y(t)\), count crossings of a hysteresis band \([y_{\rm low},y_{\rm high}]\) to quantify “stickiness” without assuming monotonicity.

---

## D6) Null-regime sanity checks (debug mode)

When P₃=OFF and P₆=OFF:
- \(\Sigma_{\mathrm{mem}}\approx 0\),
- \(A_y\approx 0\),
- pumped current \(\|J^{\mathrm{pump}}\|\approx 0\).

Always show energy breakdown:
- \(U_{\rm rep}, U_{\rm bond}, \sum w^2, \sum a^2, \sum n^2, \sum S^2\),
to detect implementation errors.

---
