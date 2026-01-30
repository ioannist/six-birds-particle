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
  return 1.96 * stdVal / Math.sqrt(n);
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
    results.push({
      id,
      seed,
      steps,
      epExactRateWindow: lastWindowExact / reportEvery,
      epNaiveRateWindow: lastWindowNaive / reportEvery,
      epExactRateTotal: lastEpExact / steps,
      epNaiveRateTotal: lastEpNaive / steps,
    });
  }
  return results;
}

ensureDir(outDir);

const cases = [
  {
    id: "base_null",
    paramsPath: "scripts/params/base_null_balanced.json",
    steps: 10_000_000,
    seeds: [1, 2, 3, 4, 5],
    overrides: {
      p3On: 0,
      p6On: 0,
      metaLayers: 0,
      eta: 0,
      initRandom: 1,
    },
  },
  {
    id: "meta_null",
    paramsPath: "scripts/params/meta/meta2_null_coupled.json",
    steps: 10_000_000,
    seeds: [1, 2, 3, 4, 5],
    overrides: {
      p3On: 0,
      p6On: 0,
      initRandom: 1,
    },
  },
  {
    id: "p6_drive",
    paramsPath: "scripts/params/meta/meta2_p6_drive_coupled.json",
    steps: 2_000_000,
    seeds: [1, 2, 3],
    overrides: {
      p3On: 0,
      p6On: 1,
    },
  },
];

const rawLines = [];
const summaryRows = [];

for (const entry of cases) {
  const results = runCase(entry);
  for (const row of results) {
    rawLines.push(JSON.stringify(row));
  }

  const exactWindowRates = results.map((r) => r.epExactRateWindow);
  const naiveWindowRates = results.map((r) => r.epNaiveRateWindow);
  const meanExact = mean(exactWindowRates);
  const stdExact = std(exactWindowRates, meanExact);
  const ci = ciHalfWidth(stdExact, exactWindowRates.length);

  summaryRows.push({
    id: entry.id,
    meanExact,
    stdExact,
    ciHalfWidth: ci,
    meanNaive: mean(naiveWindowRates),
    stdNaive: std(naiveWindowRates, mean(naiveWindowRates)),
  });

  if (entry.id !== "p6_drive") {
    for (const rate of exactWindowRates) {
      assert.ok(Math.abs(rate) <= 2e-4);
    }
    assert.ok(meanExact - ci <= 0 && meanExact + ci >= 0);
    assert.ok(ci <= 2e-4);
  } else {
    for (const rate of exactWindowRates) {
      assert.ok(rate > 1e-4);
    }
  }
}

const rawPath = path.join(outDir, "ep_null_tight_raw.jsonl");
const summaryPath = path.join(outDir, "ep_null_tight_summary.csv");
fs.writeFileSync(rawPath, rawLines.join("\n"));

const header = [
  "case",
  "meanExactWindow",
  "stdExactWindow",
  "ciHalfWidth",
  "meanNaiveWindow",
  "stdNaiveWindow",
];
const csvLines = [
  header.join(","),
  ...summaryRows.map((row) =>
    [
      row.id,
      row.meanExact,
      row.stdExact,
      row.ciHalfWidth,
      row.meanNaive,
      row.stdNaive,
    ].join(","),
  ),
];
fs.writeFileSync(summaryPath, csvLines.join("\n"));

console.log("EP null tight summary:");
for (const row of summaryRows) {
  console.log(
    `${row.id} | exact window mean ${row.meanExact.toExponential(3)} ± ${row.ciHalfWidth.toExponential(2)} | naive mean ${row.meanNaive.toExponential(3)}`,
  );
}
