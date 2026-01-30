#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  motifKeyFromTokens,
  motifFeatures,
  buildTopVocab,
  asymmetryScore,
  coarseEPFromCounts,
} from "./opk-motif-utils.mjs";
import { parseOpOffsets } from "./opk-metrics.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const wasmDir = path.resolve(rootDir, "apps/web/src/wasm/sim_core");
const wasmJs = pathToFileURL(path.join(wasmDir, "sim_core.js")).href;
const wasmBytes = fs.readFileSync(path.join(wasmDir, "sim_core_bg.wasm"));
const mod = await import(wasmJs);
mod.initSync({ module: wasmBytes });

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseArgs(argv) {
  const out = {
    outDir: path.resolve(rootDir, ".tmp", "op_motifs"),
    seed: 1,
    stepsMain: 1_000_000,
    burnIn: 200_000,
    topN: 50,
    sampleEvery: null,
    paramsPath: null,
    sets: [],
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--outDir") out.outDir = path.resolve(argv[++i]);
    else if (arg === "--seed") out.seed = Number(argv[++i]);
    else if (arg === "--stepsMain") out.stepsMain = Number(argv[++i]);
    else if (arg === "--burnIn") out.burnIn = Number(argv[++i]);
    else if (arg === "--topN") out.topN = Number(argv[++i]);
    else if (arg === "--sampleEvery") out.sampleEvery = Number(argv[++i]);
    else if (arg === "--params") out.paramsPath = argv[++i];
    else if (arg === "--set") out.sets.push(argv[++i] ?? "");
  }
  return out;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function applySets(target, sets) {
  for (const item of sets) {
    if (!item) continue;
    const [key, raw] = item.split("=");
    if (!key) continue;
    const val = Number(raw);
    if (!Number.isFinite(val)) continue;
    target[key] = val;
  }
}

function mean(values) {
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function entropyFromCounts(counts) {
  const total = Array.from(counts.values()).reduce((acc, v) => acc + v, 0);
  if (total <= 0) return 0;
  let h = 0;
  for (const v of counts.values()) {
    if (v <= 0) continue;
    const p = v / total;
    h += -p * Math.log(p);
  }
  return h;
}

function topMass(counts, topN) {
  const entries = Array.from(counts.values()).sort((a, b) => b - a);
  const total = entries.reduce((acc, v) => acc + v, 0);
  const top = entries.slice(0, topN).reduce((acc, v) => acc + v, 0);
  return total > 0 ? top / total : 0;
}

function computeKeys(tokens, rCount, layers, cells) {
  const keys = new Array(layers);
  for (let iface = 0; iface < layers; iface += 1) {
    const arr = new Array(cells);
    for (let q = 0; q < cells; q += 1) {
      const idx = iface * cells + q;
      arr[q] = motifKeyFromTokens(tokens, idx, rCount);
    }
    keys[iface] = arr;
  }
  return keys;
}

function updateCounts(countMap, key) {
  countMap.set(key, (countMap.get(key) ?? 0) + 1);
}

function updateTransition(countMap, fromKey, toKey) {
  const key = `${fromKey}|${toKey}`;
  countMap.set(key, (countMap.get(key) ?? 0) + 1);
}

const args = parseArgs(process.argv);
ensureDir(args.outDir);

const baseParams = {
  gridSize: 32,
  metaLayers: 2,
  opCouplingOn: 1,
  sCouplingMode: 1,
  opStencil: 1,
  opBudgetK: 16,
  pWrite: 0,
  pNWrite: 0,
  pAWrite: 0,
  pSWrite: 0.5,
  eta: 0.0,
  etaDrive: 0.0,
  p3On: 0,
  p6On: 0,
  opDriveOnK: 0,
  initRandom: 1,
};

const params = args.paramsPath ? { ...baseParams, ...readJson(args.paramsPath) } : { ...baseParams };
applySets(params, args.sets);

const sim = new mod.Sim(200, args.seed);
sim.set_params(params);
sim.step(args.burnIn);

const layers = sim.meta_layers ? sim.meta_layers() : params.metaLayers;
const gridSize = params.gridSize ?? 32;
const cells = gridSize * gridSize;
const tokens = sim.op_k_tokens();
const rCount = sim.op_r_count();
const offsets = parseOpOffsets(sim.op_offsets());

let prevKeys = computeKeys(tokens, rCount, layers, cells);
let epByMove = sim.ep_exact_by_move();
let lastEpOpK = epByMove[9] ?? 0;

const candidateDeltas = [1000, 5000, 20000];
const calibration = [];
let sampleEvery = args.sampleEvery;
if (!sampleEvery) {
  let chosen = null;
  for (const cand of candidateDeltas) {
    sim.step(cand);
    const currentKeys = computeKeys(sim.op_k_tokens(), rCount, layers, cells);
    let changed = 0;
    const total = layers * cells;
    for (let iface = 0; iface < layers; iface += 1) {
      for (let q = 0; q < cells; q += 1) {
        if (currentKeys[iface][q] !== prevKeys[iface][q]) changed += 1;
      }
    }
    const frac = total > 0 ? changed / total : 0;
    calibration.push({ candidate: cand, changeFrac: frac });
    prevKeys = currentKeys;
    if (frac >= 0.02 && frac <= 0.1 && !chosen) {
      chosen = cand;
      break;
    }
  }
  if (!chosen) {
    calibration.sort((a, b) => Math.abs(a.changeFrac - 0.05) - Math.abs(b.changeFrac - 0.05));
    chosen = calibration[0]?.candidate ?? candidateDeltas[0];
  }
  sampleEvery = chosen;
}

const perIfaceCounts = Array.from({ length: layers }, () => new Map());
const perIfaceTrans = Array.from({ length: layers }, () => new Map());
const perIfaceEp = Array.from({ length: layers }, () => new Map());
const pooledCounts = new Map();
const pooledTrans = new Map();
const pooledEp = new Map();

const timeseries = [];
let stepsRemaining = args.stepsMain;
let stepsElapsed = 0;

while (stepsRemaining > 0) {
  const step = Math.min(sampleEvery, stepsRemaining);
  sim.step(step);
  stepsElapsed += step;
  stepsRemaining -= step;

  const currentKeys = computeKeys(sim.op_k_tokens(), rCount, layers, cells);
  let changed = 0;
  const transInterval = new Map();

  for (let iface = 0; iface < layers; iface += 1) {
    for (let q = 0; q < cells; q += 1) {
      const fromKey = prevKeys[iface][q];
      const toKey = currentKeys[iface][q];
      updateCounts(perIfaceCounts[iface], toKey);
      updateCounts(pooledCounts, toKey);
      if (fromKey !== toKey) {
        changed += 1;
        updateTransition(perIfaceTrans[iface], fromKey, toKey);
        updateTransition(pooledTrans, fromKey, toKey);
        updateTransition(transInterval, fromKey, toKey);
      }
    }
  }

  const totalCells = layers * cells;
  const changeFrac = totalCells > 0 ? changed / totalCells : 0;
  epByMove = sim.ep_exact_by_move();
  const epOpK = epByMove[9] ?? 0;
  const epDelta = epOpK - lastEpOpK;
  lastEpOpK = epOpK;
  const epPerChange = changed > 0 ? epDelta / changed : 0;

  if (changed > 0) {
    for (const [key, count] of transInterval.entries()) {
      const epShare = (epDelta * count) / changed;
      updateTransition(pooledEp, key, epShare);
      const [fromKey] = key.split("|");
      const ifaceIdx = perIfaceCounts.findIndex((counts) => counts.has(fromKey));
      if (ifaceIdx >= 0) {
        updateTransition(perIfaceEp[ifaceIdx], key, epShare);
      }
    }
  }

  timeseries.push({
    step: stepsElapsed,
    changeFrac,
    epOpKDelta: epDelta,
    epPerChange,
  });
  prevKeys = currentKeys;
}

const vocabSummary = [];
const topMotifs = [];

const topMasses = [10, 20, 50];
const summaryFor = (label, counts) => {
  const h = entropyFromCounts(counts);
  const vEff = Math.exp(h);
  const total = Array.from(counts.values()).reduce((acc, v) => acc + v, 0);
  const row = {
    scope: label,
    U_exact: counts.size,
    H_vocab: h,
    V_eff: vEff,
    totalCount: total,
  };
  for (const n of topMasses) {
    row[`topMass${n}`] = topMass(counts, n);
  }
  return row;
};

vocabSummary.push(summaryFor("pooled", pooledCounts));
for (let iface = 0; iface < layers; iface += 1) {
  vocabSummary.push(summaryFor(`iface_${iface}`, perIfaceCounts[iface]));
}

const pooledEntries = Array.from(pooledCounts.entries()).sort((a, b) => b[1] - a[1]);
for (const [key, count] of pooledEntries.slice(0, 10)) {
  const tokensVec = key.split(",").map((v) => Number(v));
  const feats = motifFeatures(tokensVec, offsets);
  topMotifs.push({ key, count, frac: count / pooledEntries.reduce((acc, [, v]) => acc + v, 0), feats });
}

const { vocabKeys, keyToId, OTHER_ID } = buildTopVocab(pooledCounts, args.topN);

const aggregateCounts = new Map();
const aggregateEp = new Map();
for (const [key, count] of pooledTrans.entries()) {
  const [fromKey, toKey] = key.split("|");
  const fromId = keyToId.get(fromKey) ?? OTHER_ID;
  const toId = keyToId.get(toKey) ?? OTHER_ID;
  const aggKey = `${fromId}|${toId}`;
  aggregateCounts.set(aggKey, (aggregateCounts.get(aggKey) ?? 0) + count);
}
for (const [key, ep] of pooledEp.entries()) {
  const [fromKey, toKey] = key.split("|");
  const fromId = keyToId.get(fromKey) ?? OTHER_ID;
  const toId = keyToId.get(toKey) ?? OTHER_ID;
  const aggKey = `${fromId}|${toId}`;
  aggregateEp.set(aggKey, (aggregateEp.get(aggKey) ?? 0) + ep);
}

const asym = asymmetryScore(aggregateCounts);
const coarseEP = coarseEPFromCounts(aggregateCounts, 1e-12);

const vocabPath = path.join(args.outDir, "vocab_summary.csv");
const vocabHeader = [
  "scope",
  "U_exact",
  "H_vocab",
  "V_eff",
  "topMass10",
  "topMass20",
  "topMass50",
  "totalCount",
];
const vocabLines = [
  vocabHeader.join(","),
  ...vocabSummary.map((row) =>
    [
      row.scope,
      row.U_exact,
      row.H_vocab,
      row.V_eff,
      row.topMass10,
      row.topMass20,
      row.topMass50,
      row.totalCount,
    ].join(","),
  ),
];
fs.writeFileSync(vocabPath, `${vocabLines.join("\n")}\n`);

const transPath = path.join(args.outDir, "transitions_top.csv");
const transHeader = ["fromId", "toId", "count", "countRev"];
const transLines = [transHeader.join(",")];
const transEntries = Array.from(aggregateCounts.entries()).sort((a, b) => b[1] - a[1]);
for (const [key, count] of transEntries) {
  const [fromId, toId] = key.split("|");
  const revKey = `${toId}|${fromId}`;
  const rev = aggregateCounts.get(revKey) ?? 0;
  transLines.push([fromId, toId, count, rev].join(","));
}
fs.writeFileSync(transPath, `${transLines.join("\n")}\n`);

const epOut = new Map();
const outCounts = new Map();
for (const [key, count] of aggregateCounts.entries()) {
  const [fromId] = key.split("|");
  outCounts.set(fromId, (outCounts.get(fromId) ?? 0) + count);
}
for (const [key, ep] of aggregateEp.entries()) {
  const [fromId] = key.split("|");
  epOut.set(fromId, (epOut.get(fromId) ?? 0) + ep);
}

const epPath = path.join(args.outDir, "motif_ep.csv");
const epHeader = ["motifId", "key", "outCount", "epOut", "epPerOutTransition"];
const epLines = [epHeader.join(",")];
for (const [key, id] of keyToId.entries()) {
  const out = outCounts.get(String(id)) ?? 0;
  const ep = epOut.get(String(id)) ?? 0;
  const per = out > 0 ? ep / out : 0;
  epLines.push([id, key, out, ep, per].join(","));
}
const otherOut = outCounts.get(String(OTHER_ID)) ?? 0;
const otherEp = epOut.get(String(OTHER_ID)) ?? 0;
epLines.push([OTHER_ID, "OTHER", otherOut, otherEp, otherOut > 0 ? otherEp / otherOut : 0].join(","));
fs.writeFileSync(epPath, `${epLines.join("\n")}\n`);

const tsPath = path.join(args.outDir, "timeseries.csv");
const tsHeader = ["step", "changeFrac", "epOpKDelta", "epPerChange"];
const tsLines = [tsHeader.join(",")];
for (const row of timeseries) {
  tsLines.push([row.step, row.changeFrac, row.epOpKDelta, row.epPerChange].join(","));
}
fs.writeFileSync(tsPath, `${tsLines.join("\n")}\n`);

const summary = {
  params,
  seed: args.seed,
  burnIn: args.burnIn,
  stepsMain: args.stepsMain,
  sampleEvery,
  calibration,
  topMotifs,
  asymmetry: asym,
  coarseEP,
  epOpKTotal: lastEpOpK,
};
fs.writeFileSync(path.join(args.outDir, "summary.json"), JSON.stringify(summary, null, 2));
