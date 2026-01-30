export function parseOpOffsets(opOffsets) {
  const offsets = [];
  for (let i = 0; i + 1 < opOffsets.length; i += 2) {
    offsets.push([opOffsets[i], opOffsets[i + 1]]);
  }
  return offsets;
}

function mean(values) {
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function std(values, meanVal) {
  const variance = values.reduce((acc, v) => acc + (v - meanVal) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function offsetIndex(q, dx, dy, g) {
  const x = q % g;
  const y = Math.floor(q / g);
  const nx = (x + dx + g) % g;
  const ny = (y + dy + g) % g;
  return ny * g + nx;
}

function buildOffsetIndex(offsets) {
  const map = new Map();
  offsets.forEach(([dx, dy], idx) => {
    map.set(`${dx},${dy}`, idx);
  });
  return map;
}

export function computeOpkMetrics({
  gridSize,
  metaLayers,
  rCount,
  opBudgetK,
  opOffsets,
  opKTokens,
  baseS,
  metaS,
  lS,
}) {
  const offsets = parseOpOffsets(opOffsets);
  const cells = gridSize * gridSize;
  const denom = Math.max(1, lS ?? 1);
  const budget = Math.max(1, opBudgetK ?? 1);
  const eps = 1e-9;
  const offsetIndexMap = buildOffsetIndex(offsets);
  const zeroIdx = offsetIndexMap.get("0,0");

  const perInterface = [];

  for (let iface = 0; iface < metaLayers; iface += 1) {
    let m0Sum = 0;
    let hSum = 0;
    let r2Sum = 0;
    let aSum = 0;
    let cohSum = 0;
    let sdiffSum = 0;

    for (let q = 0; q < cells; q += 1) {
      const start = (iface * cells + q) * rCount;
      let h = 0;
      let r2 = 0;
      let pred = 0;

      const kVals = new Array(rCount);
      for (let r = 0; r < rCount; r += 1) {
        const k = opKTokens[start + r] / budget;
        kVals[r] = k;
        const [dx, dy] = offsets[r];
        r2 += k * (dx * dx + dy * dy);
        if (k > 0) h += -k * Math.log(k + eps);
        const qOff = offsetIndex(q, dx, dy, gridSize);
        const lower = iface === 0
          ? baseS[qOff]
          : metaS[(iface - 1) * cells + qOff];
        pred += k * (lower / denom);
      }

      const upper = metaS[iface * cells + q] / denom;
      sdiffSum += Math.abs(upper - pred);
      hSum += h;
      r2Sum += r2;

      if (zeroIdx !== undefined) {
        m0Sum += kVals[zeroIdx] ?? 0;
      }

      let aAcc = 0;
      let pairCount = 0;
      for (let r = 0; r < rCount; r += 1) {
        const [dx, dy] = offsets[r];
        const negIdx = offsetIndexMap.get(`${-dx},${-dy}`);
        if (negIdx === undefined || negIdx <= r) continue;
        aAcc += Math.abs(kVals[r] - kVals[negIdx]);
        pairCount += 1;
      }
      if (pairCount > 0) aSum += aAcc / pairCount;

      const qRight = offsetIndex(q, 1, 0, gridSize);
      const qDown = offsetIndex(q, 0, 1, gridSize);
      let l1Right = 0;
      let l1Down = 0;
      const startRight = (iface * cells + qRight) * rCount;
      const startDown = (iface * cells + qDown) * rCount;
      for (let r = 0; r < rCount; r += 1) {
        l1Right += Math.abs(kVals[r] - opKTokens[startRight + r] / budget);
        l1Down += Math.abs(kVals[r] - opKTokens[startDown + r] / budget);
      }
      cohSum += 0.5 * (l1Right + l1Down);
    }

    const denomCells = cells > 0 ? cells : 1;
    perInterface.push({
      m0: m0Sum / denomCells,
      H: hSum / denomCells,
      R2: r2Sum / denomCells,
      A: aSum / denomCells,
      coh: cohSum / denomCells,
      Sdiff_op: sdiffSum / denomCells,
    });
  }

  const m0Arr = perInterface.map((m) => m.m0);
  const hArr = perInterface.map((m) => m.H);
  const r2Arr = perInterface.map((m) => m.R2);
  const aArr = perInterface.map((m) => m.A);
  const cohArr = perInterface.map((m) => m.coh);
  const sdiffArr = perInterface.map((m) => m.Sdiff_op);

  const m0Mean = mean(m0Arr);
  const hMean = mean(hArr);
  const r2Mean = mean(r2Arr);
  const aMean = mean(aArr);
  const cohMean = mean(cohArr);
  const sdiffMean = mean(sdiffArr);

  return {
    perInterface,
    m0Arr,
    hArr,
    r2Arr,
    aArr,
    cohArr,
    sdiffArr,
    summary: {
      m0Mean,
      m0Std: std(m0Arr, m0Mean),
      hMean,
      hStd: std(hArr, hMean),
      r2Mean,
      r2Std: std(r2Arr, r2Mean),
      aMean,
      aStd: std(aArr, aMean),
      cohMean,
      cohStd: std(cohArr, cohMean),
      sdiffMean,
      sdiffStd: std(sdiffArr, sdiffMean),
    },
  };
}

export function finiteCheck(obj) {
  if (obj === null || obj === undefined) return false;
  if (Array.isArray(obj)) return obj.every((v) => finiteCheck(v));
  if (typeof obj === "number") return Number.isFinite(obj);
  if (typeof obj === "object") {
    return Object.values(obj).every((v) => finiteCheck(v));
  }
  return true;
}

export function computeSpearman(x, y) {
  if (x.length !== y.length || x.length === 0) return 0;
  const rank = (arr) => {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(arr.length);
    let i = 0;
    while (i < sorted.length) {
      let j = i + 1;
      while (j < sorted.length && sorted[j].v === sorted[i].v) j += 1;
      const r = 0.5 * (i + j - 1) + 1;
      for (let k = i; k < j; k += 1) ranks[sorted[k].i] = r;
      i = j;
    }
    return ranks;
  };
  const rx = rank(x);
  const ry = rank(y);
  const meanRx = mean(rx);
  const meanRy = mean(ry);
  let num = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < rx.length; i += 1) {
    const dx = rx[i] - meanRx;
    const dy = ry[i] - meanRy;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  const denom = Math.sqrt(denomX * denomY);
  return denom === 0 ? 0 : num / denom;
}
