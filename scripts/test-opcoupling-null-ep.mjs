#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const outDir = path.resolve(rootDir, ".tmp", "clock_code");

const wasmDir = path.resolve(rootDir, "apps/web/src/wasm/sim_core");
const wasmJs = pathToFileURL(path.join(wasmDir, "sim_core.js")).href;
const wasmBytes = fs.readFileSync(path.join(wasmDir, "sim_core_bg.wasm"));
const mod = await import(wasmJs);
mod.initSync({ module: wasmBytes });

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function mean(values) {
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function std(values, meanVal) {
  const variance = values.reduce((acc, v) => acc + (v - meanVal) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function ciHalfWidth(stdVal, n) {
  const t95 = n > 1 && n < 30 ? 2.776 : 1.96;
  return t95 * stdVal / Math.sqrt(n);
}

function opKChanged(opK, interfaces, cells, rCount, budget) {
  if (opK.length === 0 || rCount === 0) return false;
  const base = Math.floor(budget / rCount);
  const rem = budget % rCount;
  for (let iface = 0; iface < interfaces; iface += 1) {
    for (let q = 0; q < cells; q += 1) {
      const start = (iface * cells + q) * rCount;
      for (let r = 0; r < rCount; r += 1) {
        const expected = r < rem ? base + 1 : base;
        if (opK[start + r] !== expected) {
          return true;
        }
      }
    }
  }
  return false;
}

function runCase({ id, paramsPath, steps, seeds, overrides }) {
  const baseParams = readJson(path.resolve(rootDir, paramsPath));
  const params = { ...baseParams, ...overrides };
  const reportEvery = 1_000_000;
  const results = [];
  for (const seed of seeds) {
    const sim = new mod.Sim(200, seed);
    sim.set_params(params);
    let lastEpExact = sim.ep_exact_total();
    let lastEpNaive = sim.ep_naive_total();
    let lastWindowExact = 0;
    let lastWindowNaive = 0;
    for (let t = reportEvery; t <= steps; t += reportEvery) {
      sim.step(reportEvery);
      const epExact = sim.ep_exact_total();
      const epNaive = sim.ep_naive_total();
      lastWindowExact = epExact - lastEpExact;
      lastWindowNaive = epNaive - lastEpNaive;
      lastEpExact = epExact;
      lastEpNaive = epNaive;
    }
    const opK = sim.op_k_tokens();
    const rCount = sim.op_r_count();
    const budget = sim.op_budget_k();
    const interfaces = sim.op_interfaces();
    const g = params.gridSize ?? 16;
    const cells = g * g;
    const kChanged = opKChanged(opK, interfaces, cells, rCount, budget);
    results.push({
      id,
      seed,
      steps,
      epExactRateWindow: lastWindowExact / reportEvery,
      epNaiveRateWindow: lastWindowNaive / reportEvery,
      epExactRateTotal: lastEpExact / steps,
      epNaiveRateTotal: lastEpNaive / steps,
      kChanged,
    });
  }
  return results;
}

ensureDir(outDir);

const cases = [
  {
    id: "op_null_eta",
    paramsPath: "scripts/params/meta/meta2_null_coupled.json",
    steps: 10_000_000,
    seeds: [1, 2, 3, 4, 5],
    overrides: {
      p3On: 0,
      p6On: 0,
      initRandom: 1,
      opCouplingOn: 1,
      sCouplingMode: 1,
      opBudgetK: 16,
      opStencil: 1,
      eta: 0.6,
      etaDrive: 0,
    },
  },
  {
    id: "op_null_eta0",
    paramsPath: "scripts/params/meta/meta2_null_coupled.json",
    steps: 10_000_000,
    seeds: [1, 2, 3, 4, 5],
    overrides: {
      p3On: 0,
      p6On: 0,
      initRandom: 1,
      opCouplingOn: 1,
      sCouplingMode: 1,
      opBudgetK: 16,
      opStencil: 1,
      eta: 0.0,
      etaDrive: 0,
    },
  },
];

const rawLines = [];
const summaryRows = [];
const caseResults = [];

for (const entry of cases) {
  const results = runCase(entry);
  caseResults.push({ entry, results });
  for (const row of results) {
    rawLines.push(JSON.stringify(row));
  }

  const exactWindowRates = results.map((r) => r.epExactRateWindow);
  const naiveWindowRates = results.map((r) => r.epNaiveRateWindow);
  const meanExact = mean(exactWindowRates);
  const stdExact = std(exactWindowRates, meanExact);
  const ci = ciHalfWidth(stdExact, exactWindowRates.length);
  const changedCount = results.filter((r) => r.kChanged).length;

  summaryRows.push({
    id: entry.id,
    meanExact,
    stdExact,
    ciHalfWidth: ci,
    meanNaive: mean(naiveWindowRates),
    stdNaive: std(naiveWindowRates, mean(naiveWindowRates)),
    kChanged: changedCount,
  });
}

const summaryCsv = [
  "id,meanExact,stdExact,ciHalfWidth,meanNaive,stdNaive,kChanged",
  ...summaryRows.map(
    (row) =>
      `${row.id},${row.meanExact},${row.stdExact},${row.ciHalfWidth},${row.meanNaive},${row.stdNaive},${row.kChanged}`,
  ),
].join("\n");

fs.writeFileSync(path.join(outDir, "op_null_ep_raw.jsonl"), rawLines.join("\n"));
fs.writeFileSync(path.join(outDir, "op_null_ep_summary.csv"), `${summaryCsv}\n`);

console.log("op coupling null EP summary:");
console.log(summaryCsv);

for (const { entry, results } of caseResults) {
  const exactWindowRates = results.map((r) => r.epExactRateWindow);
  const summary = summaryRows.find((row) => row.id === entry.id);
  for (const rate of exactWindowRates) {
    assert.ok(Math.abs(rate) <= 2e-4);
  }
  assert.ok(summary.meanExact - summary.ciHalfWidth <= 0 && summary.meanExact + summary.ciHalfWidth >= 0);
  assert.equal(summary.kChanged, results.length, "opK remained at initialization");
}
