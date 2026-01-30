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

function readBestConfigs() {
  const summaryPath = path.resolve(outDir, "deadline_decomp_summary.csv");
  const defaults = {
    bestC: { opStencil: 1, opBudgetK: 32 },
    bestD: { opStencil: 1, opBudgetK: 16 },
  };
  if (!fs.existsSync(summaryPath)) return defaults;
  const lines = fs.readFileSync(summaryPath, "utf8").trim().split("\n");
  const header = lines.shift()?.split(",") ?? [];
  const idx = Object.fromEntries(header.map((k, i) => [k, i]));
  for (const line of lines) {
    const cols = line.split(",");
    const note = cols[idx.note] ?? "";
    if (note === "BEST_C") {
      defaults.bestC = {
        opStencil: Number(cols[idx.opStencil]),
        opBudgetK: Number(cols[idx.opBudgetK]),
      };
    }
    if (note === "BEST_D") {
      defaults.bestD = {
        opStencil: Number(cols[idx.opStencil]),
        opBudgetK: Number(cols[idx.opBudgetK]),
      };
    }
  }
  return defaults;
}

function summarizeRuns(id, runs, meta) {
  const missFrac = runs.map((r) => r.missFrac);
  const uptimeTail = runs.map((r) => r.uptimeTail);
  const errTail = runs.map((r) => r.errTailMean);
  const sdiffTail = runs.map((r) => r.sdiffTailMean);
  const epTotal = runs.map((r) => r.epTotalRate);
  const epRepair = runs.map((r) => r.epRepairRate);
  const epOpK = runs.map((r) => r.epOpKRate ?? 0);
  const repairRate = runs.map((r) => r.repairRate ?? 0);
  const p5MetaSuccess = runs.map((r) => r.p5MetaToRecoverSuccessMean ?? 0);
  const repairEfficiency = runs.map((r) => r.repairEfficiencySuccessMean ?? 0);
  const pSWrite = runs.map((r) => r.pSWrite ?? 0);
  const targetRate = runs.map((r) => r.targetRepairRate ?? 0);
  const achievedRate = runs.map((r) => r.repairRate ?? 0);
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
    repairRateMean: mean(repairRate),
    p5MetaToRecoverSuccessMean: mean(p5MetaSuccess),
    repairEfficiencySuccessMean: mean(repairEfficiency),
    pSWriteMean: mean(pSWrite),
    pSWriteStd: std(pSWrite),
    targetRepairRateMean: mean(targetRate),
    achievedRepairRateMean: mean(achievedRate),
    calibrationOkCount: okCount,
  };
}

ensureDir(outDir);
const mod = await loadWasm();

const presetPath = pickPreset();
const presetRaw = readJson(presetPath);
const baseParams = presetRaw.params ?? presetRaw;
const baseDeadline = presetRaw.deadline ?? 25_000;

const best = readBestConfigs();

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
const calibIterMax = 8;
const tol = 0.05;

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

function measureRepairRate(params, seed, variant) {
  const sim = new mod.Sim(50, seed);
  sim.set_params({ ...applyVariant(params, variant), epDebug: 1 });
  sim.step(calibSteps);
  const counts = sim.ep_q_stats().count;
  return (counts[MOVE_P5_META] ?? 0) / calibSteps;
}

function calibratePSWrite(params, targetRate, seed, variant) {
  let lo = 0.1;
  let hi = 1.0;
  let best = null;
  for (let i = 0; i < calibIterMax; i += 1) {
    const mid = 0.5 * (lo + hi);
    const rate = measureRepairRate({ ...params, pSWrite: mid }, seed, variant);
    const diff = Math.abs(rate - targetRate);
    if (!best || diff < best.diff) {
      best = { pSWrite: mid, rate, diff };
    }
    if (targetRate === 0) break;
    if (diff / targetRate <= tol) {
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

const baseLegacy = { ...baseParams, opCouplingOn: 0, sCouplingMode: 0, opDriveOnK: 0 };

const modes = [
  { id: "A_legacy", params: baseLegacy },
  { id: "B_dilution_only", params: { ...baseParams, opCouplingOn: 1, sCouplingMode: 0, opDriveOnK: 0 } },
  {
    id: "C_candidate",
    params: {
      ...baseParams,
      opCouplingOn: 1,
      sCouplingMode: 1,
      opDriveOnK: 0,
      opStencil: best.bestC.opStencil,
      opBudgetK: best.bestC.opBudgetK,
    },
  },
  {
    id: "D_candidate",
    params: {
      ...baseParams,
      opCouplingOn: 1,
      sCouplingMode: 1,
      opDriveOnK: 1,
      opStencil: best.bestD.opStencil,
      opBudgetK: best.bestD.opBudgetK,
    },
  },
];

const rawRows = [];
const summaryRows = [];

const baselineRates = {};
for (const seed of seeds) {
  const baseRate = measureRepairRate(baseLegacy, seed, "drift");
  baselineRates[seed] = baseRate;
}

for (const mode of modes) {
  const runs = [];
  for (const seed of seeds) {
    const targetRate = baselineRates[seed];
    let calibration = { pSWrite: baseParams.pSWrite ?? 0.1, rate: targetRate, ok: true };
    if (mode.id !== "A_legacy") {
      calibration = calibratePSWrite(mode.params, targetRate, seed, "drift");
    }
    const params = { ...mode.params, pSWrite: calibration.pSWrite };
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
      pSWrite: calibration.pSWrite,
      targetRepairRate: targetRate,
      achievedRepairRate: run.repairRate ?? 0,
      calibrationOk: calibration.ok,
      calibrationRate: calibration.rate,
    };
    rawRows.push(JSON.stringify(row));
    runs.push(row);
  }

  summaryRows.push(
    summarizeRuns(mode.id, runs, {
      opStencil: mode.params.opStencil ?? "",
      opBudgetK: mode.params.opBudgetK ?? "",
      opDriveOnK: mode.params.opDriveOnK ?? "",
    }),
  );
}

const summaryPath = path.join(outDir, "deadline_rate_matched_summary.csv");
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
  "repairRateMean",
  "p5MetaToRecoverSuccessMean",
  "repairEfficiencySuccessMean",
  "pSWriteMean",
  "pSWriteStd",
  "targetRepairRateMean",
  "achievedRepairRateMean",
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
      row.repairRateMean,
      row.p5MetaToRecoverSuccessMean,
      row.repairEfficiencySuccessMean,
      row.pSWriteMean,
      row.pSWriteStd,
      row.targetRepairRateMean,
      row.achievedRepairRateMean,
      row.calibrationOkCount,
    ].join(","),
  ),
].join("\n");

fs.writeFileSync(summaryPath, `${lines}\n`);
fs.writeFileSync(path.join(outDir, "deadline_rate_matched_raw.jsonl"), rawRows.join("\n"));

const baselineMean = mean(Object.values(baselineRates));
const rateOk = summaryRows.every((row) => {
  const diff = Math.abs(row.repairRateMean - baselineMean);
  return baselineMean === 0 ? diff === 0 : diff / baselineMean <= tol;
});
const okCounts = summaryRows.map((row) => `${row.id}:${row.calibrationOkCount}/${seeds.length}`);

console.log(`RATE_MATCH_OK=${rateOk}`);
console.log(`baselineRepairRateMean=${baselineMean.toFixed(6)}`);
console.log(`calibrationOkCounts=${okCounts.join(" ")}`);
for (const row of summaryRows) {
  console.log(`${row.id} repairRateMean=${row.repairRateMean.toFixed(6)} pSWriteMean=${row.pSWriteMean.toFixed(3)}`);
}
