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
const reportEvery = 100_000;
const perturbStep = 500_000;
const seeds = [1, 2, 3, 4, 5];
const fractions = [0.25, 0.5, 0.75, 1.0];
const MOVE_P5_BASE = 7;
const MOVE_P5_META = 8;
const MOVE_CLOCK = 10;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function mean(values) {
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function meanStd(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (nums.length === 0) return { mean: null, std: null };
  const m = mean(nums);
  const variance = nums.reduce((acc, v) => acc + (v - m) ** 2, 0) / nums.length;
  return { mean: m, std: Math.sqrt(variance) };
}

function percentile(values, p) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const idx = Math.min(nums.length - 1, Math.floor(p * (nums.length - 1)));
  return nums[idx];
}

function makeRng(seed) {
  let x = seed >>> 0;
  if (x === 0) x = 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 8) / (1 << 24);
  };
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

function reconstructibilityErrors(baseBits, metaField, g, lS, seed) {
  const rng = makeRng(seed);
  const errors = {};
  for (const frac of fractions) {
    const trials = 20;
    let acc = 0;
    for (let t = 0; t < trials; t += 1) {
      const mask = new Array(metaField.length);
      for (let i = 0; i < metaField.length; i += 1) {
        mask[i] = rng() < frac;
      }
      const bits = logicalBitsFromField(metaField, g, lS, mask);
      acc += errorRate(bits, baseBits);
    }
    errors[frac] = acc / trials;
  }
  return errors;
}

function runCondition(id, params) {
  const runs = [];
  for (const seed of seeds) {
    const sim = new mod.Sim(50, seed);
    sim.set_params(params);
    const timeSeries = [];
    const preSamples = [];
    let baselineMean = null;
    let baselineTarget = null;
    let perturbApplied = false;
    let recoverySteps = null;

    for (let step = reportEvery; step <= steps; step += reportEvery) {
      sim.step(reportEvery);
      const baseS = sim.base_s_field();
      const metaS = sim.meta_field();
      const cells = baseS.length;
      const meta0 = metaS.subarray(0, cells);
      const meta1 = metaS.subarray(cells, 2 * cells);
      const sdiffBase = meanAbsDiff(baseS, meta0);
      const sdiffMeta = meanAbsDiff(meta0, meta1);
      const epTotal = sim.ep_exact_total();
      const clockQ = Number(sim.clock_q());
      timeSeries.push({ step, sdiffBase, sdiffMeta, epTotal, clockQ });

      if (!perturbApplied) {
        if (step <= perturbStep) {
          preSamples.push(sdiffBase);
        }
        if (step >= perturbStep) {
          const take = preSamples.slice(-3);
          baselineMean = mean(take.length > 0 ? take : preSamples);
          baselineTarget = Math.max(baselineMean, 0.5);
          sim.apply_perturbation({
            target: "metaS",
            layer: 0,
            frac: 0.3,
            mode: "randomize",
            seed: seed * 1000 + 7,
          });
          perturbApplied = true;
        }
      } else if (recoverySteps === null && baselineTarget !== null) {
        if (sdiffBase <= baselineTarget * 1.1) {
          recoverySteps = step - perturbStep;
        }
      }
    }

    const baseS = sim.base_s_field();
    const metaS = sim.meta_field();
    const cells = baseS.length;
    const meta0 = metaS.subarray(0, cells);
    const meta1 = metaS.subarray(cells, 2 * cells);
    const lS = params.lS ?? 1;
    const baseBits = logicalBitsFromField(baseS, params.gridSize, lS);
    const errCurve = reconstructibilityErrors(baseBits, meta0, params.gridSize, lS, seed + 5000);
    const finalSdiffBase = meanAbsDiff(baseS, meta0);
    const finalSdiffMeta = meanAbsDiff(meta0, meta1);
    const epTotal = sim.ep_exact_total();
    const epRate = steps > 0 ? epTotal / steps : 0;
    const epByMove = sim.ep_exact_by_move();
    const epClock = epByMove[MOVE_CLOCK] ?? 0;
    const epRepair = (epByMove[MOVE_P5_BASE] ?? 0) + (epByMove[MOVE_P5_META] ?? 0);
    const clockQ = Number(sim.clock_q());
    const clockDrift = steps > 0 ? clockQ / steps : 0;

    runs.push({
      id,
      seed,
      finalSdiffBase,
      finalSdiffMeta,
      errCurve,
      recoverySteps: recoverySteps ?? Infinity,
      epRate,
      epClock,
      epRepair,
      clockDrift,
      timeSeries,
    });
  }
  return runs;
}

function summarizeRuns(id, runs) {
  const sdiffBase = runs.map((r) => r.finalSdiffBase);
  const sdiffMeta = runs.map((r) => r.finalSdiffMeta);
  const errF = runs.map((r) => r.errCurve[0.5]);
  const recovery = runs.map((r) => r.recoverySteps).filter((v) => Number.isFinite(v));
  const epRate = runs.map((r) => r.epRate);
  const epClock = runs.map((r) => r.epClock);
  const epRepair = runs.map((r) => r.epRepair);
  const clockDrift = runs.map((r) => r.clockDrift);
  const recoveryFrac = recovery.length / runs.length;

  return {
    id,
    sdiffBase: meanStd(sdiffBase),
    sdiffMeta: meanStd(sdiffMeta),
    errF: meanStd(errF),
    recoveryMean: recovery.length > 0 ? mean(recovery) : Infinity,
    recoveryP95: percentile(recovery, 0.95),
    recoveryFrac,
    epRate: meanStd(epRate),
    epClock: meanStd(epClock),
    epRepair: meanStd(epRepair),
    clockDrift: meanStd(clockDrift),
  };
}

ensureDir(outDir);

const presets = [
  {
    id: "code_null",
    file: "scripts/params/clock_code/code_null.json",
  },
  {
    id: "code_p6_drive",
    file: "scripts/params/clock_code/code_p6_drive.json",
  },
  {
    id: "code_p6_clock_gated",
    file: "scripts/params/clock_code/code_p6_clock_gated.json",
  },
];

const rawPath = path.join(outDir, "code_maintenance_raw.jsonl");
const summaryPath = path.join(outDir, "code_maintenance_summary.csv");
const rawLines = [];
const summaries = [];

for (const preset of presets) {
  const params = readJson(path.resolve(rootDir, preset.file));
  const runs = runCondition(preset.id, params);
  for (const run of runs) {
    rawLines.push(
      JSON.stringify({
        id: run.id,
        seed: run.seed,
        finalSdiffBase: run.finalSdiffBase,
        finalSdiffMeta: run.finalSdiffMeta,
        errCurve: run.errCurve,
        recoverySteps: Number.isFinite(run.recoverySteps) ? run.recoverySteps : null,
        epRate: run.epRate,
        clockDrift: run.clockDrift,
        timeSeries: run.timeSeries,
      }),
    );
  }
  const summary = summarizeRuns(preset.id, runs);
  summaries.push(summary);
  console.log(
    `${preset.id} | Sdiff ${summary.sdiffBase.mean?.toFixed(3)} | err(0.5) ${summary.errF.mean?.toFixed(3)} | recovery ${summary.recoveryMean.toFixed(1)} | epRate ${summary.epRate.mean?.toFixed(4)}`,
  );
}

fs.writeFileSync(rawPath, rawLines.join("\n"));
const header = [
  "preset",
  "sdiffBaseMean",
  "sdiffBaseStd",
  "sdiffMetaMean",
  "sdiffMetaStd",
  "errF0p5Mean",
  "errF0p5Std",
  "recoveryStepsMean",
  "recoveryStepsP95",
  "recoverySuccessFrac",
  "epRateMean",
  "epRateStd",
  "epClockMean",
  "epClockStd",
  "epRepairMean",
  "epRepairStd",
  "clockDriftMean",
  "clockDriftStd",
];
const csvLines = [
  header.join(","),
  ...summaries.map((s) =>
    [
      s.id,
      s.sdiffBase.mean ?? "",
      s.sdiffBase.std ?? "",
      s.sdiffMeta.mean ?? "",
      s.sdiffMeta.std ?? "",
      s.errF.mean ?? "",
      s.errF.std ?? "",
      Number.isFinite(s.recoveryMean) ? s.recoveryMean : "",
      s.recoveryP95 ?? "",
      s.recoveryFrac.toFixed(2),
      s.epRate.mean ?? "",
      s.epRate.std ?? "",
      s.epClock.mean ?? "",
      s.epClock.std ?? "",
      s.epRepair.mean ?? "",
      s.epRepair.std ?? "",
      s.clockDrift.mean ?? "",
      s.clockDrift.std ?? "",
    ].join(","),
  ),
];
fs.writeFileSync(summaryPath, csvLines.join("\n"));

console.log(`Code maintenance sweep complete. Summary saved to ${summaryPath}`);
