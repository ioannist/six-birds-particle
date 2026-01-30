#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  loadWasm,
  mean,
  std,
  readJson,
  runDeadlineEvents,
} from "./deadline-event-utils.mjs";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.resolve(rootDir, ".tmp", "op_coupling");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function pickPreset() {
  const preferred = path.resolve(rootDir, "scripts/params/clock_code/deadline_fidelity_found.json");
  const fallback = path.resolve(rootDir, "scripts/params/clock_code/code_deadline_gated_clock.json");
  if (fs.existsSync(preferred)) return preferred;
  return fallback;
}

function summarizeRuns(id, runs, meta) {
  const missFrac = runs.map((r) => r.missFrac);
  const uptimeTail = runs.map((r) => r.uptimeTail);
  const errTail = runs.map((r) => r.errTailMean);
  const sdiffTail = runs.map((r) => r.sdiffTailMean);
  const epTotal = runs.map((r) => r.epTotalRate);
  const epRepair = runs.map((r) => r.epRepairRate);
  const epOpK = runs.map((r) => r.epOpKRate ?? 0);
  const epClock = runs.map((r) => r.epClockRate ?? 0);
  const repairRate = runs.map((r) => r.repairRate ?? 0);
  const opkRate = runs.map((r) => r.opkRate ?? 0);
  const p5MetaSuccess = runs.map((r) => r.p5MetaToRecoverSuccessMean ?? 0);
  const repairEfficiency = runs.map((r) => r.repairEfficiencySuccessMean ?? 0);
  const weight = runs.map((r) => r.opKTargetWeight ?? 0);
  const pSWrite = runs.map((r) => r.pSWrite ?? 0);
  const okCount = runs.filter((r) => r.calibrationOk).length;

  return {
    id,
    ...meta,
    missFracMean: mean(missFrac),
    missFracStd: std(missFrac),
    uptimeTailMean: mean(uptimeTail),
    uptimeTailStd: std(uptimeTail),
    errTailMean: mean(errTail),
    errTailStd: std(errTail),
    sdiffTailMean: mean(sdiffTail),
    sdiffTailStd: std(sdiffTail),
    epTotalRateMean: mean(epTotal),
    epRepairRateMean: mean(epRepair),
    epOpKRateMean: mean(epOpK),
    epClockRateMean: mean(epClock),
    repairRateMean: mean(repairRate),
    opkRateMean: mean(opkRate),
    p5MetaToRecoverSuccessMean: mean(p5MetaSuccess),
    repairEfficiencySuccessMean: mean(repairEfficiency),
    opKTargetWeightMean: mean(weight),
    opKTargetWeightStd: std(weight),
    pSWriteMean: mean(pSWrite),
    pSWriteStd: std(pSWrite),
    calibrationOkCount: okCount,
  };
}

function applyVariant(params, variant) {
  const next = { ...params };
  if (variant === "drift") {
    next.clockOn = 1;
    next.clockUsesP6 = 1;
  } else if (variant === "random") {
    next.clockOn = 1;
    next.clockUsesP6 = 0;
  } else {
    next.clockOn = 0;
    next.clockUsesP6 = 1;
  }
  return next;
}

ensureDir(outDir);
const mod = await loadWasm();

const presetPath = pickPreset();
const presetRaw = readJson(presetPath);
const baseParams = presetRaw.params ?? presetRaw;
const baseDeadline = presetRaw.deadline ?? 25_000;
const basePSWrite = baseParams.pSWrite ?? 1.0;

const seeds = Array.from({ length: 10 }, (_, i) => i + 1);
const steps = 500_000;
const reportEvery = 5_000;
const eventEvery = 50_000;
const regionType = "quadrant";
const regionIndex = 2;
const errGood = 0.1;
const sdiffGood = 1.0;
const tailWindow = 200_000;

const MOVE_P5_META = 8;
const calibSteps = 200_000;
const tol = 0.05;

function measureRepairRate(params, seed, variant) {
  const sim = new mod.Sim(50, seed);
  sim.set_params({ ...applyVariant(params, variant), epDebug: 1 });
  sim.step(calibSteps);
  const counts = sim.ep_q_stats().count;
  return (counts[MOVE_P5_META] ?? 0) / calibSteps;
}

function calibrateWeight(params, targetRate, seed) {
  let lo = 0.0;
  let hi = 1.0;
  let best = null;
  for (let i = 0; i < 10; i += 1) {
    const mid = 0.5 * (lo + hi);
    const rate = measureRepairRate({ ...params, opKTargetWeight: mid }, seed, "drift");
    const diff = Math.abs(rate - targetRate);
    if (!best || diff < best.diff) {
      best = { weight: mid, rate, diff };
    }
    if (targetRate > 0 && diff / targetRate <= tol) {
      return { ...best, ok: true };
    }
    if (rate < targetRate) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  const ok = targetRate > 0 && best && best.diff / targetRate <= tol;
  return { ...best, ok };
}

function calibratePSWrite(params, targetRate, seed) {
  let lo = params.pSWrite ?? 0.1;
  let hi = 1.0;
  let best = null;
  for (let i = 0; i < 10; i += 1) {
    const mid = 0.5 * (lo + hi);
    const rate = measureRepairRate({ ...params, pSWrite: mid, opKTargetWeight: 0.0 }, seed, "drift");
    const diff = Math.abs(rate - targetRate);
    if (!best || diff < best.diff) {
      best = { pSWrite: mid, rate, diff };
    }
    if (targetRate > 0 && diff / targetRate <= tol) {
      return { ...best, ok: true };
    }
    if (rate < targetRate) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const ok = targetRate > 0 && best && best.diff / targetRate <= tol;
  return { ...best, ok };
}

const baseLegacy = { ...baseParams, opCouplingOn: 0, sCouplingMode: 0, opDriveOnK: 0, pSWrite: basePSWrite };

const modes = [
  { id: "A_legacy", params: baseLegacy },
  { id: "B_dilution_only", params: { ...baseParams, opCouplingOn: 1, sCouplingMode: 0, opDriveOnK: 0, pSWrite: basePSWrite } },
  { id: "C_op_noKdrive", params: { ...baseParams, opCouplingOn: 1, sCouplingMode: 1, opDriveOnK: 0, pSWrite: basePSWrite } },
  { id: "D_op_withKdrive", params: { ...baseParams, opCouplingOn: 1, sCouplingMode: 1, opDriveOnK: 1, pSWrite: basePSWrite } },
];

const baselineRates = {};
for (const seed of seeds) {
  baselineRates[seed] = measureRepairRate(baseLegacy, seed, "drift");
}

const rawRows = [];
const summaryRows = [];
const paramsSummary = {};

for (const mode of modes) {
  const runs = [];
  for (const seed of seeds) {
    const targetRate = baselineRates[seed];
    let weight = 1.0;
    let pSWrite = basePSWrite;
    let ok = true;
    if (mode.id !== "A_legacy") {
      const calib = calibrateWeight(mode.params, targetRate, seed);
      weight = calib.weight;
      ok = calib.ok;
      if (!ok && weight <= 1e-6) {
        if (basePSWrite < 1.0) {
          const pCalib = calibratePSWrite(mode.params, targetRate, seed);
          pSWrite = pCalib.pSWrite;
          ok = pCalib.ok;
        } else {
          ok = false;
        }
      }
    }
    const params = { ...mode.params, opKTargetWeight: weight, pSWrite };
    const result = await runDeadlineEvents({
      presetPath,
      presetParams: params,
      variant: "drift",
      seeds: [seed],
      steps,
      reportEvery,
      eventEvery,
      deadline: baseDeadline,
      regionType,
      regionIndex,
      gateSpan: null,
      corruptFrac: 0.2,
      errGood,
      sdiffGood,
      tailWindow,
    });
    const run = result.runs[0];
    const row = {
      mode: mode.id,
      seed,
      ...run,
      opKTargetWeight: weight,
      pSWrite,
      targetRepairRate: targetRate,
      achievedRepairRate: run.repairRate ?? 0,
      calibrationOk: ok,
    };
    rawRows.push(JSON.stringify(row));
    runs.push(row);
  }
  const summary = summarizeRuns(mode.id, runs, {
    opStencil: mode.params.opStencil ?? "",
    opBudgetK: mode.params.opBudgetK ?? "",
    opDriveOnK: mode.params.opDriveOnK ?? "",
  });
  summaryRows.push(summary);
  paramsSummary[mode.id] = {
    opKTargetWeightMean: summary.opKTargetWeightMean,
    pSWriteMean: summary.pSWriteMean,
    opStencil: mode.params.opStencil ?? null,
    opBudgetK: mode.params.opBudgetK ?? null,
    opDriveOnK: mode.params.opDriveOnK ?? null,
  };
}

const summaryPath = path.join(outDir, "deadline_rate_matched_v4_summary.csv");
const header = [
  "id",
  "opStencil",
  "opBudgetK",
  "opDriveOnK",
  "missFracMean",
  "missFracStd",
  "uptimeTailMean",
  "uptimeTailStd",
  "errTailMean",
  "errTailStd",
  "sdiffTailMean",
  "sdiffTailStd",
  "epTotalRateMean",
  "epRepairRateMean",
  "epOpKRateMean",
  "epClockRateMean",
  "repairRateMean",
  "opkRateMean",
  "p5MetaToRecoverSuccessMean",
  "repairEfficiencySuccessMean",
  "opKTargetWeightMean",
  "opKTargetWeightStd",
  "pSWriteMean",
  "pSWriteStd",
  "calibrationOkCount",
];
const lines = [
  header.join(","),
  ...summaryRows.map((row) =>
    [
      row.id,
      row.opStencil ?? "",
      row.opBudgetK ?? "",
      row.opDriveOnK ?? "",
      row.missFracMean,
      row.missFracStd,
      row.uptimeTailMean,
      row.uptimeTailStd,
      row.errTailMean,
      row.errTailStd,
      row.sdiffTailMean,
      row.sdiffTailStd,
      row.epTotalRateMean,
      row.epRepairRateMean,
      row.epOpKRateMean,
      row.epClockRateMean,
      row.repairRateMean,
      row.opkRateMean,
      row.p5MetaToRecoverSuccessMean,
      row.repairEfficiencySuccessMean,
      row.opKTargetWeightMean,
      row.opKTargetWeightStd,
      row.pSWriteMean,
      row.pSWriteStd,
      row.calibrationOkCount,
    ].join(","),
  ),
].join("\n");

fs.writeFileSync(summaryPath, `${lines}\n`);
fs.writeFileSync(path.join(outDir, "deadline_rate_matched_v4_raw.jsonl"), rawRows.join("\n"));
fs.writeFileSync(
  path.join(outDir, "deadline_rate_matched_v4_best_params.json"),
  JSON.stringify(paramsSummary, null, 2),
);

const targetMean = mean(Object.values(baselineRates));
const okMean = summaryRows.every((row) => {
  const diff = Math.abs(row.repairRateMean - targetMean);
  return targetMean === 0 ? diff === 0 : diff / targetMean <= tol;
});
const okCounts = summaryRows.map((row) => `${row.id}:${row.calibrationOkCount}/${seeds.length}`);

console.log(`RATE_MATCH_OK=${okMean}`);
console.log(`repairRateTargetMean=${targetMean.toFixed(6)}`);
console.log(`calibrationOkCounts=${okCounts.join(" ")}`);
for (const row of summaryRows) {
  console.log(
    `${row.id} repairRateMean=${row.repairRateMean.toFixed(6)} opKTargetWeightMean=${row.opKTargetWeightMean.toFixed(3)} pSWriteMean=${row.pSWriteMean.toFixed(3)}`,
  );
}
