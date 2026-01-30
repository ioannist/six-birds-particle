export function motifKeyFromTokens(tokens, idx, rCount) {
  const start = idx * rCount;
  const parts = [];
  for (let i = 0; i < rCount; i += 1) {
    parts.push(tokens[start + i]);
  }
  return parts.join(",");
}

export function motifFeatures(tokensVec, offsets) {
  const total = tokensVec.reduce((acc, v) => acc + v, 0);
  if (total <= 0) {
    return { H: 0, R2: 0, dX: 0, dY: 0, m0: 0 };
  }
  let h = 0;
  let r2 = 0;
  let dx = 0;
  let dy = 0;
  let m0 = 0;
  for (let i = 0; i < tokensVec.length; i += 1) {
    const p = tokensVec[i] / total;
    if (p > 0) h += -p * Math.log(p);
    const [ox, oy] = offsets[i];
    r2 += p * (ox * ox + oy * oy);
    dx += p * ox;
    dy += p * oy;
    if (ox === 0 && oy === 0) m0 = p;
  }
  return { H: h, R2: r2, dX: dx, dY: dy, m0 };
}

export function buildTopVocab(countMap, topN) {
  const entries = Array.from(countMap.entries()).sort((a, b) => b[1] - a[1]);
  const vocabKeys = entries.slice(0, topN).map(([key]) => key);
  const keyToId = new Map();
  vocabKeys.forEach((key, idx) => keyToId.set(key, idx));
  return { vocabKeys, keyToId, OTHER_ID: topN };
}

export function asymmetryScore(transCounts) {
  let num = 0;
  let denom = 0;
  for (const [key, count] of transCounts.entries()) {
    const [from, to] = key.split("|");
    if (from === to) continue;
    const revKey = `${to}|${from}`;
    const revCount = transCounts.get(revKey) ?? 0;
    if (from < to) {
      num += Math.abs(count - revCount);
    }
    denom += count;
  }
  return denom > 0 ? num / denom : 0;
}

export function coarseEPFromCounts(transCounts, eps = 1e-12) {
  let acc = 0;
  const seen = new Set();
  for (const [key, count] of transCounts.entries()) {
    const [from, to] = key.split("|");
    if (from === to) continue;
    const revKey = `${to}|${from}`;
    const pairKey = from < to ? key : revKey;
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);
    const c1 = count;
    const c2 = transCounts.get(revKey) ?? 0;
    const diff = c1 - c2;
    if (diff === 0) continue;
    acc += diff * Math.log((c1 + eps) / (c2 + eps));
  }
  return acc;
}
