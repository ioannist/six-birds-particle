#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { loadWasm, mean, std } from "./deadline-event-utils.mjs";
import { parseOpOffsets, computeSpearman } from "./opk-metrics.mjs";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.resolve(rootDir, ".tmp", "op_coupling");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

class LcgRng {
  constructor(seed) {
    this.state = seed >>> 0;
  }
  next() {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0xffffffff;
  }
  int(max) {
    return Math.floor(this.next() * max);
  }
}

function sampleOffsetIndex(tokens, start, rCount, rng) {
  let total = 0;
  for (let r = 0; r < rCount; r += 1) total += tokens[start + r];
  if (total <= 0) return 0;
  let pick = rng.int(total);
  for (let r = 0; r < rCount; r += 1) {
    pick -= tokens[start + r];
    if (pick < 0) return r;
  }
  return rCount - 1;
}

function computeR2Eff({
  metaLayers,
  rCount,
  opOffsets,
  opKTokens,
  gridSize,
  samples,
  rng,
}) {
  const offsets = parseOpOffsets(opOffsets);
  const cells = gridSize * gridSize;
  const r2Eff = [];
  const hEff = [];

  for (let d = 1; d <= metaLayers; d += 1) {
    let r2Sum = 0;
    const counts = new Map();
    for (let i = 0; i < samples; i += 1) {
      let dx = 0;
      let dy = 0;
      for (let step = 0; step < d; step += 1) {
        const iface = rng.int(d);
        const q = rng.int(cells);
        const start = (iface * cells + q) * rCount;
        const rIdx = sampleOffsetIndex(opKTokens, start, rCount, rng);
        const [ox, oy] = offsets[rIdx];
        dx += ox;
        dy += oy;
      }
      const key = `${dx},${dy}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      r2Sum += dx * dx + dy * dy;
    }
    const r2Mean = samples > 0 ? r2Sum / samples : 0;
    let h = 0;
    for (const count of counts.values()) {
      const p = count / samples;
      if (p > 0) h += -p * Math.log(p);
    }
    r2Eff.push(r2Mean);
    hEff.push(h);
  }

  return { r2Eff, hEff };
}

function tvField(field, g) {
  const cells = g * g;
  let acc = 0;
  for (let q = 0; q < cells; q += 1) {
    const x = q % g;
    const y = Math.floor(q / g);
    const right = y * g + ((x + 1) % g);
    const down = ((y + 1) % g) * g + x;
    acc += Math.abs(field[q] - field[right]) + Math.abs(field[q] - field[down]);
  }
  return acc / cells;
}

function meanArray(arrays, idx) {
  return mean(arrays.map((a) => a[idx]));
}

function stdArray(arrays, idx, meanVal) {
  const variance = arrays.reduce((acc, a) => acc + (a[idx] - meanVal) ** 2, 0) / arrays.length;
  return Math.sqrt(variance);
}

ensureDir(outDir);
const mod = await loadWasm();

const configs = [
  {
    id: "null",
    params: {
      gridSize: 16,
      metaLayers: 4,
      lS: 10,
      lambdaS: 0,
      pWrite: 0,
      pNWrite: 0,
      pAWrite: 0,
      pSWrite: 1,
      opCouplingOn: 1,
      sCouplingMode: 1,
      opStencil: 0,
      opBudgetK: 8,
      initRandom: 1,
      p3On: 0,
      p6On: 0,
      eta: 0.6,
      etaDrive: 0,
      opDriveOnK: 0,
      muHigh: 1.0,
      muLow: -1.0,
    },
  },
  {
    id: "drive",
    params: {
      gridSize: 16,
      metaLayers: 3,
      lS: 10,
      lambdaS: 0,
      pWrite: 0,
      pNWrite: 0,
      pAWrite: 0,
      pSWrite: 1,
      opCouplingOn: 1,
      sCouplingMode: 1,
      opStencil: 0,
      opBudgetK: 8,
      initRandom: 1,
      p3On: 0,
      p6On: 1,
      eta: 0,
      etaDrive: 0.6,
      opDriveOnK: 1,
      muHigh: 1.0,
      muLow: 1.0,
    },
  },
];

const seeds = Array.from({ length: 10 }, (_, i) => i + 1);
const steps = 1_000_000;
const samplesPerDepth = 50_000;

const rawRows = [];
const summaryRows = [];

for (const cfg of configs) {
  const r2ArrAll = [];
  const hArrAll = [];
  const tvArrAll = [];
  const rhoR2Arr = [];
  const rhoTVArr = [];

  for (const seed of seeds) {
    const sim = new mod.Sim(200, seed);
    sim.set_params(cfg.params);
    sim.step(steps);

    const baseS = sim.base_s_field();
    const metaS = sim.meta_field();
    const opK = sim.op_k_tokens();
    const opOffsets = sim.op_offsets();
    const rCount = sim.op_r_count();
    const metaLayers = cfg.params.metaLayers;

    const rng = new LcgRng(seed * 99991);
    const { r2Eff, hEff } = computeR2Eff({
      metaLayers,
      rCount,
      opOffsets,
      opKTokens: opK,
      gridSize: cfg.params.gridSize,
      samples: samplesPerDepth,
      rng,
    });

    const tvByLayer = [];
    const cells = cfg.params.gridSize * cfg.params.gridSize;
    tvByLayer.push(tvField(baseS, cfg.params.gridSize));
    for (let layer = 0; layer < metaLayers; layer += 1) {
      const start = layer * cells;
      const slice = metaS.subarray(start, start + cells);
      tvByLayer.push(tvField(slice, cfg.params.gridSize));
    }

    const depthIdx = r2Eff.map((_, i) => i + 1);
    const layerIdx = tvByLayer.map((_, i) => i);
    const rhoR2 = computeSpearman(depthIdx, r2Eff);
    const rhoTV = computeSpearman(layerIdx, tvByLayer);

    r2ArrAll.push(r2Eff);
    hArrAll.push(hEff);
    tvArrAll.push(tvByLayer);
    rhoR2Arr.push(rhoR2);
    rhoTVArr.push(rhoTV);

    rawRows.push(
      JSON.stringify({
        config: cfg.id,
        seed,
        r2Eff,
        hEff,
        tvByLayer,
        rhoR2,
        rhoTV,
      }),
    );
  }

  const depthCount = r2ArrAll[0]?.length ?? 0;
  const layerCount = tvArrAll[0]?.length ?? 0;
  const r2Mean = [];
  const r2Std = [];
  const hMean = [];
  const hStd = [];
  const tvMean = [];
  const tvStd = [];

  for (let i = 0; i < depthCount; i += 1) {
    const m = meanArray(r2ArrAll, i);
    r2Mean.push(m);
    r2Std.push(stdArray(r2ArrAll, i, m));
    const hm = meanArray(hArrAll, i);
    hMean.push(hm);
    hStd.push(stdArray(hArrAll, i, hm));
  }

  for (let i = 0; i < layerCount; i += 1) {
    const m = meanArray(tvArrAll, i);
    tvMean.push(m);
    tvStd.push(stdArray(tvArrAll, i, m));
  }

  const rhoR2Mean = mean(rhoR2Arr);
  const rhoR2Std = std(rhoR2Arr);
  const rhoTVMean = mean(rhoTVArr);
  const rhoTVStd = std(rhoTVArr);

  const r2Pos = rhoR2Arr.filter((v) => v >= 0.7).length;
  const r2Neg = rhoR2Arr.filter((v) => v <= -0.7).length;
  const tvPos = rhoTVArr.filter((v) => v >= 0.7).length;
  const tvNeg = rhoTVArr.filter((v) => v <= -0.7).length;

  const r2Consistent = Math.max(r2Pos, r2Neg);
  const tvConsistent = Math.max(tvPos, tvNeg);
  const signalFound = r2Consistent >= 7 || tvConsistent >= 7;

  summaryRows.push({
    config: cfg.id,
    metaLayers: cfg.params.metaLayers,
    opStencil: cfg.params.opStencil,
    opBudgetK: cfg.params.opBudgetK,
    r2Mean: JSON.stringify(r2Mean),
    r2Std: JSON.stringify(r2Std),
    hMean: JSON.stringify(hMean),
    hStd: JSON.stringify(hStd),
    tvMean: JSON.stringify(tvMean),
    tvStd: JSON.stringify(tvStd),
    rhoR2Mean,
    rhoR2Std,
    rhoTVMean,
    rhoTVStd,
    r2Consistent,
    tvConsistent,
    signal: signalFound ? "COMPOSED_HIERARCHY_SIGNAL_FOUND" : "NO_COMPOSED_HIERARCHY_SIGNAL_FOUND",
  });
}

const summaryPath = path.join(outDir, "opk_composed_hierarchy_summary.csv");
const header = [
  "config",
  "metaLayers",
  "opStencil",
  "opBudgetK",
  "r2Mean",
  "r2Std",
  "hMean",
  "hStd",
  "tvMean",
  "tvStd",
  "rhoR2Mean",
  "rhoR2Std",
  "rhoTVMean",
  "rhoTVStd",
  "r2Consistent",
  "tvConsistent",
  "signal",
];
const lines = [
  header.join(","),
  ...summaryRows.map((row) =>
    [
      row.config,
      row.metaLayers,
      row.opStencil,
      row.opBudgetK,
      row.r2Mean,
      row.r2Std,
      row.hMean,
      row.hStd,
      row.tvMean,
      row.tvStd,
      row.rhoR2Mean,
      row.rhoR2Std,
      row.rhoTVMean,
      row.rhoTVStd,
      row.r2Consistent,
      row.tvConsistent,
      row.signal,
    ].join(","),
  ),
].join("\n");
fs.writeFileSync(summaryPath, `${lines}\n`);
fs.writeFileSync(path.join(outDir, "opk_composed_hierarchy_raw.jsonl"), rawRows.join("\n"));

for (const row of summaryRows) {
  console.log(`${row.config} ${row.signal} rhoR2=${row.rhoR2Mean.toFixed(3)} rhoTV=${row.rhoTVMean.toFixed(3)}`);
}
