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
  const recMean = runs.map((r) => r.recoveryMean ?? 0);
  const recP95 = runs.map((r) => r.recoveryP95 ?? 0);
  const epTotal = runs.map((r) => r.epTotalRate);
  const epClock = runs.map((r) => r.epClockRate);
  const epRepair = runs.map((r) => r.epRepairRate);
  const epOpK = runs.map((r) => r.epOpKRate ?? 0);
  const p5MetaRecover = runs.map((r) => r.p5MetaToRecoverMean ?? 0);
  const p5MetaRecoverP95 = runs.map((r) => r.p5MetaToRecoverP95 ?? 0);
  const opkRecover = runs.map((r) => r.opkToRecoverMean ?? 0);
  const opkRecoverP95 = runs.map((r) => r.opkToRecoverP95 ?? 0);
  const repairRate = runs.map((r) => r.repairRate ?? 0);
  const opkRate = runs.map((r) => r.opkRate ?? 0);
  const p5MetaSuccessMean = runs.map((r) => r.p5MetaToRecoverSuccessMean ?? 0);
  const p5MetaSuccessP95 = runs.map((r) => r.p5MetaToRecoverSuccessP95 ?? 0);
  const p5MetaMissMean = runs.map((r) => r.p5MetaBeforeMissMean ?? 0);
  const p5MetaMissP95 = runs.map((r) => r.p5MetaBeforeMissP95 ?? 0);
  const opkSuccessMean = runs.map((r) => r.opkToRecoverSuccessMean ?? 0);
  const opkSuccessP95 = runs.map((r) => r.opkToRecoverSuccessP95 ?? 0);
  const opkMissMean = runs.map((r) => r.opkBeforeMissMean ?? 0);
  const opkMissP95 = runs.map((r) => r.opkBeforeMissP95 ?? 0);
  const clockSuccessMean = runs.map((r) => r.clockToRecoverSuccessMean ?? 0);
  const clockSuccessP95 = runs.map((r) => r.clockToRecoverSuccessP95 ?? 0);
  const clockMissMean = runs.map((r) => r.clockBeforeMissMean ?? 0);
  const clockMissP95 = runs.map((r) => r.clockBeforeMissP95 ?? 0);
  const recoveriesCount = runs.map((r) => r.recoveriesCount ?? 0);
  const missesCount = runs.map((r) => r.missesCount ?? 0);
  const repairEfficiencyMean = runs.map((r) => r.repairEfficiencySuccessMean ?? 0);
  const repairEfficiencyMedian = runs.map((r) => r.repairEfficiencySuccessMedian ?? 0);

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
    recoveryMean: mean(recMean),
    recoveryP95Mean: mean(recP95),
    epTotalRateMean: mean(epTotal),
    epClockRateMean: mean(epClock),
    epRepairRateMean: mean(epRepair),
    epOpKRateMean: mean(epOpK),
    p5MetaToRecoverMean: mean(p5MetaRecover),
    p5MetaToRecoverP95: mean(p5MetaRecoverP95),
    opkToRecoverMean: mean(opkRecover),
    opkToRecoverP95: mean(opkRecoverP95),
    repairRateMean: mean(repairRate),
    opkRateMean: mean(opkRate),
    p5MetaToRecoverSuccessMean: mean(p5MetaSuccessMean),
    p5MetaToRecoverSuccessP95: mean(p5MetaSuccessP95),
    p5MetaBeforeMissMean: mean(p5MetaMissMean),
    p5MetaBeforeMissP95: mean(p5MetaMissP95),
    opkToRecoverSuccessMean: mean(opkSuccessMean),
    opkToRecoverSuccessP95: mean(opkSuccessP95),
    opkBeforeMissMean: mean(opkMissMean),
    opkBeforeMissP95: mean(opkMissP95),
    clockToRecoverSuccessMean: mean(clockSuccessMean),
    clockToRecoverSuccessP95: mean(clockSuccessP95),
    clockBeforeMissMean: mean(clockMissMean),
    clockBeforeMissP95: mean(clockMissP95),
    recoveriesCountMean: mean(recoveriesCount),
    missesCountMean: mean(missesCount),
    repairEfficiencySuccessMean: mean(repairEfficiencyMean),
    repairEfficiencySuccessMedian: mean(repairEfficiencyMedian),
  };
}

function pickBest(rows) {
  return rows.reduce((best, row) => {
    if (!best) return row;
    if (row.missFracMean < best.missFracMean - 1e-6) return row;
    if (Math.abs(row.missFracMean - best.missFracMean) <= 1e-6) {
      if (row.uptimeTailMean > best.uptimeTailMean + 1e-6) return row;
      if (Math.abs(row.uptimeTailMean - best.uptimeTailMean) <= 1e-6) {
        if (row.epTotalRateMean < best.epTotalRateMean - 1e-6) return row;
      }
    }
    return best;
  }, null);
}

ensureDir(outDir);
await loadWasm();

const presetPath = pickPreset();
const presetRaw = readJson(presetPath);
const baseParams = presetRaw.params ?? presetRaw;
const baseDeadline = presetRaw.deadline ?? 25_000;

const seeds = Array.from({ length: 10 }, (_, i) => i + 1);
const steps = 500_000;
const reportEvery = 5_000;
const eventEvery = 50_000;
const regionType = "quadrant";
const regionIndex = 2;
const errGood = 0.1;
const sdiffGood = 1.0;
const tailWindow = 200_000;

const rawRows = [];
const summaryRows = [];

const conditions = [
  {
    id: "A_legacy",
    params: { ...baseParams, opCouplingOn: 0, sCouplingMode: 0, opDriveOnK: 0 },
  },
  {
    id: "B_dilution_only",
    params: { ...baseParams, opCouplingOn: 1, sCouplingMode: 0, opDriveOnK: 0 },
  },
];

for (const cond of conditions) {
  const { runs } = await runDeadlineEvents({
    presetPath,
    presetParams: cond.params,
    variant: "drift",
    seeds,
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
  for (const r of runs) rawRows.push(JSON.stringify({ condition: cond.id, ...r }));
  summaryRows.push(summarizeRuns(cond.id, runs, { opStencil: "", opBudgetK: "" }));
}

const opConfigs = [];
for (const opStencil of [0, 1]) {
  for (const opBudgetK of [8, 16, 32]) {
    opConfigs.push({ opStencil, opBudgetK });
  }
}

const opNoDriveSummaries = [];
const opDriveSummaries = [];

for (const cfg of opConfigs) {
  const paramsNoDrive = {
    ...baseParams,
    opCouplingOn: 1,
    sCouplingMode: 1,
    opDriveOnK: 0,
    opStencil: cfg.opStencil,
    opBudgetK: cfg.opBudgetK,
  };
  const paramsDrive = {
    ...baseParams,
    opCouplingOn: 1,
    sCouplingMode: 1,
    opDriveOnK: 1,
    opStencil: cfg.opStencil,
    opBudgetK: cfg.opBudgetK,
  };

  const runNoDrive = await runDeadlineEvents({
    presetPath,
    presetParams: paramsNoDrive,
    variant: "drift",
    seeds,
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
  for (const r of runNoDrive.runs) {
    rawRows.push(JSON.stringify({ condition: "C_op_noKdrive", opStencil: cfg.opStencil, opBudgetK: cfg.opBudgetK, ...r }));
  }
  const summaryNoDrive = summarizeRuns(
    `C_op_noKdrive_s${cfg.opStencil}_b${cfg.opBudgetK}`,
    runNoDrive.runs,
    cfg,
  );
  opNoDriveSummaries.push(summaryNoDrive);
  summaryRows.push(summaryNoDrive);

  const runDrive = await runDeadlineEvents({
    presetPath,
    presetParams: paramsDrive,
    variant: "drift",
    seeds,
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
  for (const r of runDrive.runs) {
    rawRows.push(JSON.stringify({ condition: "D_op_withKdrive", opStencil: cfg.opStencil, opBudgetK: cfg.opBudgetK, ...r }));
  }
  const summaryDrive = summarizeRuns(
    `D_op_withKdrive_s${cfg.opStencil}_b${cfg.opBudgetK}`,
    runDrive.runs,
    cfg,
  );
  opDriveSummaries.push(summaryDrive);
  summaryRows.push(summaryDrive);
}

const bestNoDrive = pickBest(opNoDriveSummaries);
const bestDrive = pickBest(opDriveSummaries);
const legacy = summaryRows.find((r) => r.id === "A_legacy");
const dilution = summaryRows.find((r) => r.id === "B_dilution_only");

summaryRows.push({
  id: "BEST_C",
  ...bestNoDrive,
  note: "BEST_C",
});
summaryRows.push({
  id: "BEST_D",
  ...bestDrive,
  note: "BEST_D",
});

const deltaMissLegacyToDilution = dilution.missFracMean - legacy.missFracMean;
const deltaMissLegacyToBestD = bestDrive.missFracMean - legacy.missFracMean;
const attribution =
  deltaMissLegacyToBestD !== 0
    ? deltaMissLegacyToDilution / deltaMissLegacyToBestD
    : 0;
const explained = deltaMissLegacyToBestD !== 0 && attribution >= 0.7;
const line = `DILUTION_ATTRIBUTION: miss(A)->miss(B)=${deltaMissLegacyToDilution.toFixed(4)} miss(A)->miss(bestD)=${deltaMissLegacyToBestD.toFixed(4)} ratio=${attribution.toFixed(2)} explained=${explained}`;
console.log(line);

const summaryPath = path.join(outDir, "deadline_decomp_summary.csv");
const header = [
  "id",
  "opStencil",
  "opBudgetK",
  "missFracMean",
  "missFracStd",
  "deltaMissVsA",
  "uptimeTailMean",
  "uptimeTailStd",
  "errTailMean",
  "errTailStd",
  "sdiffTailMean",
  "sdiffTailStd",
  "recoveryMean",
  "recoveryP95Mean",
  "epTotalRateMean",
  "deltaEpTotalRateVsA",
  "epClockRateMean",
  "epRepairRateMean",
  "deltaRepairRateVsA",
  "epOpKRateMean",
  "p5MetaToRecoverMean",
  "p5MetaToRecoverSuccessMean",
  "p5MetaToRecoverSuccessP95",
  "p5MetaBeforeMissMean",
  "p5MetaBeforeMissP95",
  "deltaP5MetaToRecoverMeanVsA",
  "p5MetaToRecoverP95",
  "opkToRecoverMean",
  "opkToRecoverSuccessMean",
  "opkToRecoverSuccessP95",
  "opkBeforeMissMean",
  "opkBeforeMissP95",
  "opkToRecoverP95",
  "clockToRecoverSuccessMean",
  "clockToRecoverSuccessP95",
  "clockBeforeMissMean",
  "clockBeforeMissP95",
  "recoveriesCountMean",
  "missesCountMean",
  "repairEfficiencySuccessMean",
  "repairEfficiencySuccessMedian",
  "repairRateMean",
  "deltaRepairRateMeanVsA",
  "opkRateMean",
  "note",
];
const deltaFor = (row, key) => {
  if (!legacy) return "";
  const base = legacy[key];
  if (!Number.isFinite(base) || !Number.isFinite(row[key])) return "";
  return row[key] - base;
};
const lines = [
  header.join(","),
  ...summaryRows.map((row) =>
    [
      row.id,
      row.opStencil ?? "",
      row.opBudgetK ?? "",
      row.missFracMean,
      row.missFracStd,
      deltaFor(row, "missFracMean"),
      row.uptimeTailMean,
      row.uptimeTailStd,
      row.errTailMean,
      row.errTailStd,
      row.sdiffTailMean,
      row.sdiffTailStd,
      row.recoveryMean,
      row.recoveryP95Mean,
      row.epTotalRateMean,
      deltaFor(row, "epTotalRateMean"),
      row.epClockRateMean,
      row.epRepairRateMean,
      deltaFor(row, "epRepairRateMean"),
      row.epOpKRateMean,
      row.p5MetaToRecoverMean,
      row.p5MetaToRecoverSuccessMean,
      row.p5MetaToRecoverSuccessP95,
      row.p5MetaBeforeMissMean,
      row.p5MetaBeforeMissP95,
      deltaFor(row, "p5MetaToRecoverMean"),
      row.p5MetaToRecoverP95,
      row.opkToRecoverMean,
      row.opkToRecoverSuccessMean,
      row.opkToRecoverSuccessP95,
      row.opkBeforeMissMean,
      row.opkBeforeMissP95,
      row.opkToRecoverP95,
      row.clockToRecoverSuccessMean,
      row.clockToRecoverSuccessP95,
      row.clockBeforeMissMean,
      row.clockBeforeMissP95,
      row.recoveriesCountMean,
      row.missesCountMean,
      row.repairEfficiencySuccessMean,
      row.repairEfficiencySuccessMedian,
      row.repairRateMean,
      deltaFor(row, "repairRateMean"),
      row.opkRateMean,
      row.note ?? "",
    ].join(","),
  ),
].join("\n");
fs.writeFileSync(summaryPath, `${lines}\n`);

const rawPath = path.join(outDir, "deadline_decomp_raw.jsonl");
fs.writeFileSync(rawPath, rawRows.join("\n"));
