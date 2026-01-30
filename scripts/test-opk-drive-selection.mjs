#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { computeOpkMetrics } from "./opk-metrics.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const outDir = path.resolve(rootDir, ".tmp", "op_coupling");

const wasmDir = path.resolve(rootDir, "apps/web/src/wasm/sim_core");
const wasmJs = pathToFileURL(path.join(wasmDir, "sim_core.js")).href;
const wasmBytes = fs.readFileSync(path.join(wasmDir, "sim_core_bg.wasm"));
const mod = await import(wasmJs);
mod.initSync({ module: wasmBytes });

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function mean(values) {
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function std(values, meanVal) {
  const variance = values.reduce((acc, v) => acc + (v - meanVal) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

const seeds = [1, 2, 3, 4, 5];
const stepsCompare = 1_000_000;
const reportEvery = 100_000;
const extraStepsNull = 2_000_000;

function snapshotMetrics(sim, params) {
  const baseS = sim.base_s_field();
  const metaS = sim.meta_field();
  const opK = sim.op_k_tokens();
  const opOffsets = sim.op_offsets();
  const rCount = sim.op_r_count();
  const budget = sim.op_budget_k();
  return computeOpkMetrics({
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
}

function runVariant(id, overrides, extraSteps = 0) {
  const params = {
    beta: 5.0,
    gridSize: 16,
    metaLayers: 2,
    lS: 10,
    lambdaS: 0.0,
    p3On: 0,
    p6On: 0,
    p6SFactor: 0.0,
    pWrite: 0,
    pNWrite: 0,
    pAWrite: 0,
    pSWrite: 0.01,
    eta: 0,
    etaDrive: 0,
    muHigh: 1.0,
    muLow: 1.0,
    opCouplingOn: 1,
    sCouplingMode: 1,
    opStencil: 1,
    opBudgetK: 16,
    opDriveOnK: 1,
    initRandom: 1,
    repairClockGated: 1,
    clockOn: 0,
    clockK: 8,
    clockFrac: 0,
    ...overrides,
  };
  const rows = [];
  for (const seed of seeds) {
    const sim = new mod.Sim(200, seed);
    sim.set_params(params);
    const startMetrics = snapshotMetrics(sim, params);
    let lastEpExact = sim.ep_exact_total();
    let lastEpOpK = sim.ep_exact_by_move()[9] ?? 0;
    let lastWindowExact = 0;
    let lastWindowOpK = 0;
    for (let t = reportEvery; t <= stepsCompare; t += reportEvery) {
      sim.step(reportEvery);
      const epExact = sim.ep_exact_total();
      const epOpK = sim.ep_exact_by_move()[9] ?? 0;
      lastWindowExact = epExact - lastEpExact;
      lastWindowOpK = epOpK - lastEpOpK;
      lastEpExact = epExact;
      lastEpOpK = epOpK;
    }
    const endMetrics = snapshotMetrics(sim, params);
    if (extraSteps > 0) {
      const extraChunks = Math.ceil(extraSteps / reportEvery);
      for (let i = 0; i < extraChunks; i += 1) {
        sim.step(reportEvery);
        const epExact = sim.ep_exact_total();
        const epOpK = sim.ep_exact_by_move()[9] ?? 0;
        lastWindowExact = epExact - lastEpExact;
        lastWindowOpK = epOpK - lastEpOpK;
        lastEpExact = epExact;
        lastEpOpK = epOpK;
      }
    }
    rows.push({
      id,
      seed,
      sdiffStart: startMetrics.summary.sdiffMean,
      sdiffEnd: endMetrics.summary.sdiffMean,
      hEnd: endMetrics.summary.hMean,
      r2End: endMetrics.summary.r2Mean,
      epExactRateWindowLast: lastWindowExact / reportEvery,
      epOpKRateWindowLast: lastWindowOpK / reportEvery,
    });
  }
  return { params, rows };
}

ensureDir(outDir);
const variants = [
  {
    id: "A_drive_selects",
    overrides: { p6On: 1, etaDrive: 1.0, opDriveOnK: 1, muHigh: 10.0, muLow: 10.0 },
    extraSteps: 0,
  },
  {
    id: "B_drive_no_k",
    overrides: { p6On: 1, etaDrive: 1.0, opDriveOnK: 0, muHigh: 10.0, muLow: 10.0 },
    extraSteps: 0,
  },
  {
    id: "C_null",
    overrides: { p6On: 0, etaDrive: 0.0, opDriveOnK: 0, eta: 0.0 },
    extraSteps: extraStepsNull,
  },
  {
    id: "D_equilibrium",
    overrides: { p6On: 0, etaDrive: 0.0, opDriveOnK: 0, eta: 0.6 },
    extraSteps: extraStepsNull,
  },
];

const rawRows = [];
const summaryRows = [];

for (const variant of variants) {
  const { rows } = runVariant(variant.id, variant.overrides, variant.extraSteps);
  for (const row of rows) {
    rawRows.push(JSON.stringify(row));
  }

  const sdiffEnd = rows.map((r) => r.sdiffEnd);
  const sdiffStart = rows.map((r) => r.sdiffStart);
  const deltaSdiff = rows.map((r) => r.sdiffEnd - r.sdiffStart);
  const epExactWindow = rows.map((r) => r.epExactRateWindowLast);
  const epOpKWindow = rows.map((r) => r.epOpKRateWindowLast);

  summaryRows.push({
    id: variant.id,
    sdiffStartMean: mean(sdiffStart),
    sdiffEndMean: mean(sdiffEnd),
    deltaSdiffMean: mean(deltaSdiff),
    epExactWindowMean: mean(epExactWindow),
    epOpKWindowMean: mean(epOpKWindow),
    sdiffEndStd: std(sdiffEnd, mean(sdiffEnd)),
  });
}

const rawPath = path.join(outDir, "opk_drive_selection_raw.jsonl");
const summaryPath = path.join(outDir, "opk_drive_selection_summary.csv");
fs.writeFileSync(rawPath, rawRows.join("\n"));

const header = [
  "id",
  "sdiffStartMean",
  "sdiffEndMean",
  "deltaSdiffMean",
  "sdiffEndStd",
  "epExactWindowMean",
  "epOpKWindowMean",
];
const lines = [
  header.join(","),
  ...summaryRows.map((row) =>
    [
      row.id,
      row.sdiffStartMean,
      row.sdiffEndMean,
      row.deltaSdiffMean,
      row.sdiffEndStd,
      row.epExactWindowMean,
      row.epOpKWindowMean,
    ].join(","),
  ),
].join("\n");
fs.writeFileSync(summaryPath, `${lines}\n`);

const rowA = summaryRows.find((r) => r.id === "A_drive_selects");
const rowB = summaryRows.find((r) => r.id === "B_drive_no_k");
const rowC = summaryRows.find((r) => r.id === "C_null");

console.log("opk drive selection summary:");
console.log(lines);

assert.ok(rowA.sdiffEndMean <= 0.85 * rowB.sdiffEndMean);
assert.ok(rowA.sdiffEndMean <= 0.85 * rowC.sdiffEndMean);
assert.ok(rowA.epOpKWindowMean > 1e-4);
assert.ok(rowA.epOpKWindowMean >= 2 * rowB.epOpKWindowMean);
assert.ok(Math.abs(rowC.epExactWindowMean) <= 2e-4);
assert.ok(Math.abs(rowC.deltaSdiffMean) <= 0.05 * rowC.sdiffStartMean);
