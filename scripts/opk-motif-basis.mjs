export function binByThresholds(value, t1, t2) {
  if (value <= t1) return 0;
  if (value <= t2) return 1;
  return 2;
}

export function offsetsToDxDy(opOffsets) {
  const rCount = Math.floor(opOffsets.length / 2);
  const dx = new Int8Array(rCount);
  const dy = new Int8Array(rCount);
  for (let i = 0; i < rCount; i += 1) {
    dx[i] = opOffsets[2 * i];
    dy[i] = opOffsets[2 * i + 1];
  }
  return { dx, dy };
}

export function edgeKey(fromIdx, toIdx) {
  return `${fromIdx}->${toIdx}`;
}

export function edgeFamily(fromIdx, toIdx, dx, dy) {
  const ddx = dx[toIdx] - dx[fromIdx];
  const ddy = dy[toIdx] - dy[fromIdx];
  const sx = ddx === 0 ? 0 : ddx > 0 ? 1 : -1;
  const sy = ddy === 0 ? 0 : ddy > 0 ? 1 : -1;
  return `${sx},${sy}`;
}

export function signBin(value, eps = 1e-6) {
  if (value > eps) return 2;
  if (value < -eps) return 0;
  return 1;
}

export function combineBase3(bins) {
  let id = 0;
  let factor = 1;
  for (const b of bins) {
    id += b * factor;
    factor *= 3;
  }
  return id;
}

function index2d(x, y, g) {
  const xx = (x + g) % g;
  const yy = (y + g) % g;
  return yy * g + xx;
}

function lowerUpperFields(baseS, metaS, cells, iface) {
  const upper = metaS.subarray((iface - 1) * cells, iface * cells);
  const lower = iface === 1 ? baseS : metaS.subarray((iface - 2) * cells, (iface - 1) * cells);
  return { lower, upper };
}

export function computeMBaseClasses({ baseS, metaS, gridSize, lS, metaLayers }) {
  const cells = gridSize * gridSize;
  const t1 = lS / 3;
  const t2 = (2 * lS) / 3;
  const classes = new Array(metaLayers);
  for (let iface = 1; iface <= metaLayers; iface += 1) {
    const { lower, upper } = lowerUpperFields(baseS, metaS, cells, iface);
    const arr = new Array(cells);
    for (let q = 0; q < cells; q += 1) {
      const x = q % gridSize;
      const y = Math.floor(q / gridSize);
      const lowerVal = lower[q] ?? 0;
      const upperVal = upper[q] ?? 0;
      const lowerBin = binByThresholds(lowerVal, t1, t2);
      const upperBin = binByThresholds(upperVal, t1, t2);
      const mismatch = signBin(upperVal - lowerVal, 0);
      const rightIdx = index2d(x + 1, y, gridSize);
      const downIdx = index2d(x, y + 1, gridSize);
      const gradX = signBin((lower[rightIdx] ?? 0) - lowerVal, 0);
      const gradY = signBin((lower[downIdx] ?? 0) - lowerVal, 0);
      arr[q] = combineBase3([lowerBin, upperBin, mismatch, gradX, gradY]);
    }
    classes[iface - 1] = arr;
  }
  return classes;
}

function axisBinsForTokensMode(tokens, offset, rCount, offsets, budget, opBinsMode) {
  const denom = budget > 0 ? budget : 1;
  let center = 0;
  let posX = 0;
  let negX = 0;
  let posY = 0;
  let negY = 0;
  for (let i = 0; i < rCount; i += 1) {
    const count = tokens[offset + i] ?? 0;
    const off = offsets[i] ?? [0, 0];
    const dx = off[0];
    const dy = off[1];
    if (dx === 0 && dy === 0) {
      center += count;
    } else if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx >= 0) posX += count;
      else negX += count;
    } else {
      if (dy >= 0) posY += count;
      else negY += count;
    }
  }

  let toBin;
  if (opBinsMode === 1) {
    toBin = (mass) => {
      if (mass <= 0) return 0;
      if (mass <= 3) return 1;
      return 2;
    };
  } else if (opBinsMode === 2) {
    toBin = (mass) => binByThresholds(mass / denom, 0.08, 0.16);
  } else {
    toBin = (mass) => binByThresholds(mass / denom, 1 / 6, 2 / 6);
  }

  return {
    centerBin: toBin(center),
    posXBin: toBin(posX),
    negXBin: toBin(negX),
    posYBin: toBin(posY),
    negYBin: toBin(negY),
  };
}

function dir9MassesForCell(tokens, baseOffset, rCount, offsets, opBudgetK) {
  const masses = new Float64Array(9);
  const denom = Math.max(1, opBudgetK);
  for (let r = 0; r < rCount; r += 1) {
    const count = tokens[baseOffset + r] ?? 0;
    if (count === 0) continue;
    const off = offsets[r] ?? [0, 0];
    const dx = off[0];
    const dy = off[1];
    let idx = 0;
    if (dx === 0 && dy === 0) idx = 0;
    else if (dx > 0 && dy === 0) idx = 1;
    else if (dx < 0 && dy === 0) idx = 2;
    else if (dx === 0 && dy < 0) idx = 3;
    else if (dx === 0 && dy > 0) idx = 4;
    else if (dx > 0 && dy < 0) idx = 5;
    else if (dx < 0 && dy < 0) idx = 6;
    else if (dx > 0 && dy > 0) idx = 7;
    else idx = 8;
    masses[idx] += count / denom;
  }
  return masses;
}

export function computeMOpClasses({
  baseS,
  metaS,
  gridSize,
  lS,
  metaLayers,
  tokens,
  rCount,
  offsets,
  opBudgetK,
  opBinsMode = 2,
}) {
  const cells = gridSize * gridSize;
  const t1 = lS / 3;
  const t2 = (2 * lS) / 3;
  const classes = new Array(metaLayers);
  for (let iface = 1; iface <= metaLayers; iface += 1) {
    const { lower, upper } = lowerUpperFields(baseS, metaS, cells, iface);
    const arr = new Array(cells);
    const tokenBase = (iface - 1) * cells * rCount;
    for (let q = 0; q < cells; q += 1) {
      const lowerVal = lower[q] ?? 0;
      const upperVal = upper[q] ?? 0;
      const mismatch = signBin(upperVal - lowerVal, 0);
      const tokenOffset = tokenBase + q * rCount;
      if (opBinsMode === 0) {
        let bins = { centerBin: 0, posXBin: 0, negXBin: 0, posYBin: 0, negYBin: 0 };
        if (rCount > 0 && tokens.length >= tokenOffset + rCount) {
          bins = axisBinsForTokensMode(
            tokens,
            tokenOffset,
            rCount,
            offsets,
            opBudgetK,
            opBinsMode,
          );
        }
        arr[q] = combineBase3([
          mismatch,
          bins.centerBin,
          bins.posXBin,
          bins.negXBin,
          bins.posYBin,
          bins.negYBin,
        ]);
      } else {
        const masses =
          rCount > 0 && tokens.length >= tokenOffset + rCount
            ? dir9MassesForCell(tokens, tokenOffset, rCount, offsets, opBudgetK)
            : new Float64Array(9);
        let argmax = 0;
        let maxVal = masses[0];
        for (let i = 1; i < masses.length; i += 1) {
          if (masses[i] > maxVal) {
            maxVal = masses[i];
            argmax = i;
          }
        }
        if (opBinsMode === 1) {
          arr[q] = mismatch * 9 + argmax;
        } else {
          let sum = 0;
          for (let i = 0; i < masses.length; i += 1) sum += masses[i];
          let h = 0;
          if (sum > 0) {
            for (let i = 0; i < masses.length; i += 1) {
              const p = masses[i] / sum;
              if (p > 0) h += -p * Math.log(p);
            }
          }
          const hNorm = h / Math.log(9);
          let hBin = 2;
          if (hNorm < 0.33) hBin = 0;
          else if (hNorm < 0.66) hBin = 1;
          arr[q] = mismatch + 3 * (argmax + 9 * hBin);
        }
      }
    }
    classes[iface - 1] = arr;
  }
  return classes;
}

export function mOpStateCount(opBinsMode) {
  if (opBinsMode === 0) return 729;
  if (opBinsMode === 1) return 27;
  return 81;
}

export function coarseEPDecompose(edgeCounts, alpha = 0.5) {
  const perState = new Map();
  const perEdge = new Map();
  let total = 0;
  for (const [key, count] of edgeCounts.entries()) {
    const parts = key.includes("->") ? key.split("->") : key.split("|");
    const i = Number(parts[0]);
    const j = Number(parts[1]);
    if (Number.isNaN(i) || Number.isNaN(j)) continue;
    if (i === j) continue;
    if (i > j) continue;
    const revKey = key.includes("->") ? `${j}->${i}` : `${j}|${i}`;
    const rev = edgeCounts.get(revKey) ?? 0;
    const c1 = count + alpha;
    const c2 = rev + alpha;
    const epPair = (c1 - c2) * Math.log(c1 / c2);
    if (epPair > 0) total += epPair;
    perState.set(String(i), (perState.get(String(i)) ?? 0) + epPair / 2);
    perState.set(String(j), (perState.get(String(j)) ?? 0) + epPair / 2);
    perEdge.set(
      `${i}->${j}`,
      (perEdge.get(`${i}->${j}`) ?? 0) + count * Math.log(c1 / c2),
    );
    perEdge.set(
      `${j}->${i}`,
      (perEdge.get(`${j}->${i}`) ?? 0) + rev * Math.log(c2 / c1),
    );
  }
  return { total, perState, perEdge };
}

export function vocabStats(countMap, topN = 10) {
  const entries = Array.from(countMap.values());
  const total = entries.reduce((acc, v) => acc + v, 0);
  let h = 0;
  if (total > 0) {
    for (const v of entries) {
      const p = v / total;
      if (p > 0) h += -p * Math.log(p);
    }
  }
  const sorted = entries.slice().sort((a, b) => b - a);
  const top = sorted.slice(0, topN).reduce((acc, v) => acc + v, 0);
  return {
    H_vocab: h,
    V_eff: Math.exp(h),
    topMass10: total > 0 ? top / total : 0,
    total,
  };
}

export function asymmetryScore(counts) {
  let numerator = 0;
  let denom = 0;
  for (const [key, c] of counts.entries()) {
    const [from, to] = key.split("|");
    if (from === to) continue;
    const revKey = `${to}|${from}`;
    const rev = counts.get(revKey) ?? 0;
    if (from < to) {
      numerator += Math.abs(c - rev);
    }
    denom += c;
  }
  return denom > 0 ? numerator / denom : 0;
}

export function coarseEPSmoothed(counts, alpha = 0.5) {
  let acc = 0;
  for (const [key, c] of counts.entries()) {
    const [from, to] = key.split("|");
    if (from === to) continue;
    const revKey = `${to}|${from}`;
    const rev = counts.get(revKey) ?? 0;
    if (from < to) {
      const c1 = c + alpha;
      const c2 = rev + alpha;
      acc += (c1 - c2) * Math.log(c1 / c2);
    }
  }
  return 0.5 * acc;
}

export function jsDivergence(countA, countB, eps = 1e-12) {
  const keys = new Set([...countA.keys(), ...countB.keys()]);
  let totalA = 0;
  let totalB = 0;
  for (const v of countA.values()) totalA += v;
  for (const v of countB.values()) totalB += v;
  if (totalA === 0 && totalB === 0) return 0;
  const normA = totalA > 0 ? totalA : 1;
  const normB = totalB > 0 ? totalB : 1;
  let klA = 0;
  let klB = 0;
  for (const key of keys) {
    const p = (countA.get(key) ?? 0) / normA;
    const q = (countB.get(key) ?? 0) / normB;
    const m = 0.5 * (p + q);
    if (p > 0) klA += p * Math.log((p + eps) / (m + eps));
    if (q > 0) klB += q * Math.log((q + eps) / (m + eps));
  }
  return 0.5 * (klA + klB);
}
