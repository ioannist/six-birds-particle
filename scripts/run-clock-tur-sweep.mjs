#!/usr/bin/env node
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

const steps = 1_000_000;
const seeds = Array.from({ length: 10 }, (_, i) => i + 1);
const mus = [0.2, 0.4, 0.6, 0.8, 1.0, 1.4];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function mean(values) {
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function variance(values, meanVal) {
  return values.reduce((acc, v) => acc + (v - meanVal) ** 2, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return 0.5 * (sorted[mid - 1] + sorted[mid]);
  }
  return sorted[mid];
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

ensureDir(outDir);

const baseParamsPath = path.resolve(rootDir, "scripts/params/clock_code/clock_tur_sweep_base.json");
const baseParams = readJson(baseParamsPath);

const rawPath = path.join(outDir, "clock_tur_raw.jsonl");
const summaryPath = path.join(outDir, "clock_tur_summary.csv");
const rawLines = [];
const summaryRows = [];

for (const mu of mus) {
  const qs = [];
  const sigmas = [];
  for (const seed of seeds) {
    const sim = new mod.Sim(50, seed);
    sim.set_params({ ...baseParams, muHigh: mu, muLow: mu });
    sim.step(steps);
    const q = Number(sim.clock_q());
    const sigma = sim.ep_exact_total();
    qs.push(q);
    sigmas.push(sigma);
    rawLines.push(
      JSON.stringify({
        mu,
        seed,
        steps,
        clockQ: q,
        epTotal: sigma,
      }),
    );
  }
  const meanQ = mean(qs);
  const varQ = variance(qs, meanQ);
  const meanSigma = mean(sigmas);
  const relVar = meanQ !== 0 ? varQ / (meanQ * meanQ) : Infinity;
  const R = relVar * meanSigma / 2;
  summaryRows.push({ mu, meanQ, varQ, meanSigma, R });
  console.log(
    `mu ${mu.toFixed(2)} | meanQ ${meanQ.toFixed(2)} | varQ ${varQ.toFixed(2)} | meanSigma ${meanSigma.toFixed(4)} | R ${R.toFixed(3)}`,
  );
}

fs.writeFileSync(rawPath, rawLines.join("\n"));
const header = "mu,meanQ,varQ,meanSigma,R";
const csvLines = [
  header,
  ...summaryRows.map((row) =>
    [row.mu, row.meanQ, row.varQ, row.meanSigma, row.R].join(","),
  ),
];
fs.writeFileSync(summaryPath, csvLines.join("\n"));

const qMono = summaryRows.reduce((acc, row, i) => {
  if (i === 0) return 0;
  return acc + (row.meanQ >= summaryRows[i - 1].meanQ ? 1 : 0);
}, 0);
const sigmaMono = summaryRows.reduce((acc, row, i) => {
  if (i === 0) return 0;
  return acc + (row.meanSigma >= summaryRows[i - 1].meanSigma ? 1 : 0);
}, 0);

if (qMono < 4) {
  throw new Error(`meanQ monotonicity failed (count=${qMono})`);
}
if (sigmaMono < 4) {
  throw new Error(`meanSigma monotonicity failed (count=${sigmaMono})`);
}

const Rs = summaryRows.map((row) => row.R);
const medR = median(Rs);
for (const row of summaryRows) {
  if (!(row.R >= 0.6)) {
    throw new Error(`TUR ratio too low for mu=${row.mu}: R=${row.R}`);
  }
}
if (!(medR >= 1.0)) {
  throw new Error(`Median TUR ratio too low: ${medR}`);
}

console.log(`TUR sweep complete. Summary saved to ${summaryPath}`);
