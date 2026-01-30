#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { computeOpkMetrics, finiteCheck } from "./opk-metrics.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const outDir = path.resolve(rootDir, ".tmp", "op_coupling");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

const wasmDir = path.resolve(rootDir, "apps/web/src/wasm/sim_core");
const wasmJs = pathToFileURL(path.join(wasmDir, "sim_core.js")).href;
const wasmBytes = fs.readFileSync(path.join(wasmDir, "sim_core_bg.wasm"));
const mod = await import(wasmJs);
mod.initSync({ module: wasmBytes });

const sampleSteps = [0, 200_000, 400_000, 800_000, 1_200_000];

function sampleKInvariants({ opK, rCount, budget, interfaces, cells, rng }) {
  const samples = Math.min(50, interfaces * cells);
  for (let i = 0; i < samples; i += 1) {
    const iface = rng() % interfaces;
    const q = rng() % cells;
    const start = (iface * cells + q) * rCount;
    let sum = 0;
    for (let r = 0; r < rCount; r += 1) sum += opK[start + r];
    if (sum !== budget) return false;
  }
  return true;
}

function makeLCG(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state;
  };
}

function runVariant(variant, overrides) {
  const params = {
    beta: 5.0,
    gridSize: 16,
    metaLayers: 2,
    lS: 10,
    lambdaS: 0,
    p3On: 0,
    p6On: 0,
    pWrite: 0,
    pNWrite: 0,
    pAWrite: 0,
    pSWrite: 1,
    etaDrive: 0,
    opCouplingOn: 1,
    sCouplingMode: 1,
    opStencil: 1,
    opBudgetK: 16,
    initRandom: 1,
    ...overrides,
  };

  const sim = new mod.Sim(200, 1);
  sim.set_params(params);

  const rows = [];
  let lastStep = 0;
  let lastEpExact = sim.ep_exact_total();
  let lastEpOpK = sim.ep_exact_by_move()[9] ?? 0;

  for (const targetStep of sampleSteps) {
    const delta = targetStep - lastStep;
    if (delta > 0) sim.step(delta);
    const epExact = sim.ep_exact_total();
    const epByMove = sim.ep_exact_by_move();
    const epOpK = epByMove[9] ?? 0;
    const window = targetStep - lastStep || 1;
    const epExactRateWindow = (epExact - lastEpExact) / window;
    const epOpKRateWindow = (epOpK - lastEpOpK) / window;

    const baseS = sim.base_s_field();
    const metaS = sim.meta_field();
    const opK = sim.op_k_tokens();
    const opOffsets = sim.op_offsets();
    const rCount = sim.op_r_count();
    const budget = sim.op_budget_k();
    const interfaces = sim.op_interfaces();
    const cells = params.gridSize * params.gridSize;
    const metrics = computeOpkMetrics({
      gridSize: params.gridSize,
      metaLayers: params.metaLayers,
      rCount,
      opBudgetK: budget,
      opOffsets,
      opKTokens: opK,
      baseS,
      metaS,
      lS: params.lS,
    });

    const rng = makeLCG(targetStep + 17);
    const kSampleOk = sampleKInvariants({
      opK,
      rCount,
      budget,
      interfaces,
      cells,
      rng,
    });

    rows.push({
      variant,
      step: targetStep,
      params,
      epExact,
      epExactRateWindow,
      epOpK,
      epOpKRateWindow,
      metrics,
      kSampleOk,
    });

    lastStep = targetStep;
    lastEpExact = epExact;
    lastEpOpK = epOpK;
  }

  return rows;
}

ensureDir(outDir);
const rawRows = [];
const summaryRows = [];

for (const { variant, eta } of [
  { variant: "eta0", eta: 0.0 },
  { variant: "eta06", eta: 0.6 },
]) {
  const rows = runVariant(variant, { eta });
  for (const row of rows) {
    if (!finiteCheck(row.metrics)) {
      throw new Error(`Non-finite metrics for ${variant} at step ${row.step}`);
    }
    rawRows.push({
      variant: row.variant,
      step: row.step,
      epExact: row.epExact,
      epExactRateWindow: row.epExactRateWindow,
      epOpK: row.epOpK,
      epOpKRateWindow: row.epOpKRateWindow,
      kSampleOk: row.kSampleOk,
      metrics: row.metrics,
    });
  }

  const first = rows[0];
  const last = rows[rows.length - 1];
  for (const row of [first, last]) {
    summaryRows.push({
      variant: row.variant,
      step: row.step,
      m0Mean: row.metrics.summary.m0Mean,
      HMean: row.metrics.summary.hMean,
      R2Mean: row.metrics.summary.r2Mean,
      AMean: row.metrics.summary.aMean,
      cohMean: row.metrics.summary.cohMean,
      SdiffMean: row.metrics.summary.sdiffMean,
      epExactRateWindow: row.epExactRateWindow,
      epOpKRateWindow: row.epOpKRateWindow,
      kSampleOk: row.kSampleOk ? 1 : 0,
    });
  }
}

const rawPath = path.join(outDir, "opk_diag_raw.jsonl");
const summaryPath = path.join(outDir, "opk_diag_summary.csv");
fs.writeFileSync(rawPath, rawRows.map((r) => JSON.stringify(r)).join("\n"));

const header = [
  "variant",
  "step",
  "m0Mean",
  "HMean",
  "R2Mean",
  "AMean",
  "cohMean",
  "SdiffMean",
  "epExactRateWindow",
  "epOpKRateWindow",
  "kSampleOk",
];
const lines = [
  header.join(","),
  ...summaryRows.map((row) =>
    [
      row.variant,
      row.step,
      row.m0Mean,
      row.HMean,
      row.R2Mean,
      row.AMean,
      row.cohMean,
      row.SdiffMean,
      row.epExactRateWindow,
      row.epOpKRateWindow,
      row.kSampleOk,
    ].join(","),
  ),
];
fs.writeFileSync(summaryPath, `${lines.join("\n")}\n`);

console.log(`opk diagnostics written to ${summaryPath}`);
