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

const steps = 1_500_000;
const reportEvery = 100_000;
const perturbStep = 750_000;
const seeds = Array.from({ length: 10 }, (_, i) => i + 1);
const mus = [0.2, 0.4, 0.6, 0.8, 1.0, 1.4];
const MOVE_P5_BASE = 7;
const MOVE_P5_META = 8;
const MOVE_CLOCK = 10;

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

function percentile(values, p) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const idx = Math.min(nums.length - 1, Math.floor(p * (nums.length - 1)));
  return nums[idx];
}

function meanAbsDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += Math.abs(a[i] - b[i]);
  }
  return a.length === 0 ? 0 : sum / a.length;
}

function quadrantIndex(idx, g) {
  const x = idx % g;
  const y = Math.floor(idx / g);
  const qx = x < g / 2 ? 0 : 1;
  const qy = y < g / 2 ? 0 : 1;
  return qy * 2 + qx;
}

function logicalBitsFromField(field, g, lS, mask) {
  const sums = [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < field.length; i += 1) {
    if (mask && !mask[i]) continue;
    const q = quadrantIndex(i, g);
    sums[q] += field[i];
    counts[q] += 1;
  }
  const threshold = lS / 2;
  return sums.map((sum, i) => {
    const meanVal = counts[i] > 0 ? sum / counts[i] : 0;
    return meanVal >= threshold ? 1 : 0;
  });
}

function errorRate(bitsA, bitsB) {
  let mismatches = 0;
  for (let i = 0; i < bitsA.length; i += 1) {
    if (bitsA[i] !== bitsB[i]) mismatches += 1;
  }
  return mismatches / bitsA.length;
}

function makeMask(seed, size, frac) {
  let x = seed >>> 0;
  if (x === 0) x = 1;
  const mask = new Array(size);
  for (let i = 0; i < size; i += 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    const r = (x >>> 8) / (1 << 24);
    mask[i] = r < frac;
  }
  return mask;
}

function errF05(baseBits, metaField, g, lS, seed) {
  const trials = 20;
  let acc = 0;
  for (let t = 0; t < trials; t += 1) {
    const mask = makeMask(seed + t * 101, metaField.length, 0.5);
    const bits = logicalBitsFromField(metaField, g, lS, mask);
    acc += errorRate(bits, baseBits);
  }
  return acc / trials;
}

function spearman(xs, ys) {
  const rank = (arr) => {
    const sorted = arr
      .map((v, i) => ({ v, i }))
      .sort((a, b) => a.v - b.v);
    const ranks = Array(arr.length);
    for (let i = 0; i < sorted.length; i += 1) {
      ranks[sorted[i].i] = i + 1;
    }
    return ranks;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const meanRx = mean(rx);
  const meanRy = mean(ry);
  let num = 0;
  let denx = 0;
  let deny = 0;
  for (let i = 0; i < rx.length; i += 1) {
    const dx = rx[i] - meanRx;
    const dy = ry[i] - meanRy;
    num += dx * dy;
    denx += dx * dx;
    deny += dy * dy;
  }
  return num / Math.sqrt(denx * deny);
}

ensureDir(outDir);

const rawPath = path.join(outDir, "clock_code_joint_raw.jsonl");
const summaryPath = path.join(outDir, "clock_code_joint_summary.csv");
const rawLines = [];
const summaryRows = [];

const baseParams = {
  beta: 2.0,
  stepSize: 0.01,
  p3On: 0,
  p6On: 1,
  p6SFactor: 0.0,
  pWrite: 0,
  pNWrite: 0.1,
  pAWrite: 0,
  pSWrite: 0.9,
  muHigh: 1.0,
  muLow: 1.0,
  kappaRep: 1.0,
  r0: 0.25,
  kappaBond: 0.0,
  rStar: 0.22,
  lambdaW: 0.0,
  lW: 4,
  lambdaN: 0.0,
  lN: 6,
  lambdaA: 0.0,
  lA: 6,
  lambdaS: 0.0,
  lS: 20,
  gridSize: 8,
  rPropose: 0.12,
  metaLayers: 2,
  eta: 0.0,
  etaDrive: 1.0,
  clockOn: 1,
  clockK: 8,
  clockFrac: 1.0,
  clockUsesP6: 1,
  repairClockGated: 1,
};

for (const mu of mus) {
  const qs = [];
  const sigmas = [];
  const relVars = [];
  const errs = [];
  const recoveries = [];
  const windowRates = [];
  const epClocks = [];
  const epRepairs = [];
  for (const seed of seeds) {
    const sim = new mod.Sim(50, seed);
    sim.set_params({ ...baseParams, muHigh: mu, muLow: mu });
    let lastEpExact = sim.ep_exact_total();
    let epExactWindow = 0;
    let preSamples = [];
    let baselineMean = null;
    let baselineTarget = null;
    let recoverySteps = null;
    let perturbApplied = false;

    for (let step = reportEvery; step <= steps; step += reportEvery) {
      sim.step(reportEvery);
      const baseS = sim.base_s_field();
      const metaS = sim.meta_field();
      const cells = baseS.length;
      const meta0 = metaS.subarray(0, cells);
      const sdiffBase = meanAbsDiff(baseS, meta0);
      if (!perturbApplied) {
        if (step <= perturbStep) preSamples.push(sdiffBase);
        if (step >= perturbStep) {
          baselineMean = mean(preSamples.slice(-3));
          baselineTarget = Math.max(baselineMean, 0.5);
          sim.apply_perturbation({
            target: "metaS",
            layer: 0,
            frac: 0.3,
            mode: "randomize",
            seed: seed * 1000 + 11,
          });
          perturbApplied = true;
        }
      } else if (recoverySteps === null && baselineTarget !== null) {
        if (sdiffBase <= baselineTarget * 1.1) {
          recoverySteps = step - perturbStep;
        }
      }

      const epExact = sim.ep_exact_total();
      epExactWindow = (epExact - lastEpExact) / reportEvery;
      lastEpExact = epExact;
    }

    const q = Number(sim.clock_q());
    const sigma = sim.ep_exact_total();
    const epByMove = sim.ep_exact_by_move();
    const epClock = epByMove[MOVE_CLOCK] ?? 0;
    const epRepair = (epByMove[MOVE_P5_BASE] ?? 0) + (epByMove[MOVE_P5_META] ?? 0);
    const baseS = sim.base_s_field();
    const metaS = sim.meta_field();
    const cells = baseS.length;
    const meta0 = metaS.subarray(0, cells);
    const baseBits = logicalBitsFromField(baseS, baseParams.gridSize, baseParams.lS);
    const err = errF05(baseBits, meta0, baseParams.gridSize, baseParams.lS, seed + 7000);

    qs.push(q);
    sigmas.push(sigma);
    errs.push(err);
    recoveries.push(recoverySteps ?? Infinity);
    windowRates.push(epExactWindow);
    epClocks.push(epClock);
    epRepairs.push(epRepair);

    rawLines.push(
      JSON.stringify({
        mu,
        seed,
        steps,
        clockQ: q,
        epExactTotal: sigma,
        epExactRateWindow: epExactWindow,
        epClock,
        epRepair,
        errF05: err,
        recoverySteps: Number.isFinite(recoverySteps) ? recoverySteps : null,
      }),
    );
  }

  const meanQ = mean(qs);
  const varQ = variance(qs, meanQ);
  const meanSigma = mean(sigmas);
  const relVar = meanQ !== 0 ? varQ / (meanQ * meanQ) : Infinity;
  const R = relVar * meanSigma / 2;
  const errMed = median(errs);
  const recMed = median(recoveries);
  const recP95 = percentile(recoveries, 0.95);
  const meanWindowRate = mean(windowRates);
  const meanEpClock = mean(epClocks);
  const meanEpRepair = mean(epRepairs);

  summaryRows.push({
    mu,
    meanSigma,
    meanWindowRate,
    meanQ,
    varQ,
    relVar,
    R,
    errMed,
    recMed,
    recP95,
    meanEpClock,
    meanEpRepair,
  });

}

fs.writeFileSync(rawPath, rawLines.join("\n"));
const header = [
  "mu",
  "meanSigma",
  "epExactRateWindowLast",
  "meanQ",
  "varQ",
  "relVar",
  "R",
  "errF05Median",
  "recoveryMedian",
  "recoveryP95",
  "meanEpClock",
  "meanEpRepair",
];
const csvLines = [
  header.join(","),
  ...summaryRows.map((row) =>
    [
      row.mu,
      row.meanSigma,
      row.meanWindowRate,
      row.meanQ,
      row.varQ,
      row.relVar,
      row.R,
      row.errMed,
      row.recMed,
      row.recP95 ?? "",
      row.meanEpClock,
      row.meanEpRepair,
    ].join(","),
  ),
];
fs.writeFileSync(summaryPath, csvLines.join("\n"));

const sigmaMono = summaryRows.reduce((acc, row, i) => {
  if (i === 0) return 0;
  return acc + (row.meanSigma >= summaryRows[i - 1].meanSigma ? 1 : 0);
}, 0);
const relVarMono = summaryRows.reduce((acc, row, i) => {
  if (i === 0) return 0;
  return acc + (row.relVar <= summaryRows[i - 1].relVar ? 1 : 0);
}, 0);
const errMono = summaryRows.reduce((acc, row, i) => {
  if (i === 0) return 0;
  return acc + (row.errMed <= summaryRows[i - 1].errMed ? 1 : 0);
}, 0);
const recMono = summaryRows.reduce((acc, row, i) => {
  if (i === 0) return 0;
  return acc + (row.recMed <= summaryRows[i - 1].recMed ? 1 : 0);
}, 0);

if (sigmaMono < 4) {
  throw new Error(`meanSigma monotonicity failed (count=${sigmaMono})`);
}
if (relVarMono < 4) {
  const eps = summaryRows.map((row) => row.meanSigma);
  const invRelVar = summaryRows.map((row) => 1 / row.relVar);
  const corrPrecision = spearman(eps, invRelVar);
  if (corrPrecision <= 0.7) {
    throw new Error(
      `relVar monotonicity failed (count=${relVarMono}), corr=${corrPrecision.toFixed(3)}`,
    );
  }
}
if (errMono < 4 && recMono < 4) {
  const eps = summaryRows.map((row) => row.meanSigma);
  const invRelVar = summaryRows.map((row) => 1 / row.relVar);
  const invErr = summaryRows.map((row) => 1 / row.errMed);
  const corrPrecision = spearman(eps, invRelVar);
  const corrCode = spearman(eps, invErr);
  if (!(corrPrecision > 0.7 && corrCode > 0.5)) {
    throw new Error(`Spearman correlations failed: precision ${corrPrecision}, code ${corrCode}`);
  }
}

console.log(`Joint sweep complete. Summary saved to ${summaryPath}`);
