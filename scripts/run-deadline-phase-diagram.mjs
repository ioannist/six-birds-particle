#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { calibrateGateGaps, loadWasm, mean, runDeadlineEvents } from "./deadline-event-utils.mjs";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.resolve(rootDir, ".tmp", "clock_code");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

ensureDir(outDir);
await loadWasm();

const gridSizes = [48];
const gateSpans = [2, 3];
const noiseRates = [0.005, 0.008, 0.01, 0.012, 0.02];
const mus = [1.8, 2.0, 2.2];
const etaDrives = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0];
const extraGridSizes = [64];
const extraNoiseRates = [0.008, 0.01, 0.012];
const extraEtaDrives = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0];

const steps = 1_500_000;
const reportEvery = 1_000;
const eventEvery = 50_000;
const seeds = [1, 2, 3];
const corruptFrac = 0.1;
const tailWindow = 200_000;
const deadlineScale = 1.2;

const rows = [];
let strongCount = 0;

async function evaluateGrid({
  gridSizeList,
  gateSpanList,
  noiseRateList,
  muList,
  etaDriveList,
}) {
  for (const gridSize of gridSizeList) {
    for (const gateSpan of gateSpanList) {
      for (const codeNoiseRate of noiseRateList) {
        for (const mu of muList) {
          for (const etaDrive of etaDriveList) {
          const clockK = gridSize;
          const regionIndex = Math.floor(clockK / 2);
          const baseParams = {
            beta: 2.0,
            stepSize: 0.01,
            p3On: 0,
            p6On: 1,
            p6SFactor: 0.0,
            pWrite: 0,
            pNWrite: 0.05,
            pAWrite: 0,
            pSWrite: 1.0,
            muHigh: mu,
            muLow: mu,
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
            lS: 1,
            gridSize,
            rPropose: 0.12,
            metaLayers: 2,
            eta: 0.0,
            etaDrive,
            codeNoiseRate,
            codeNoiseBatch: 1,
            codeNoiseLayer: 0,
            clockOn: 1,
            clockK,
            clockFrac: 1.0,
            clockUsesP6: 1,
            repairClockGated: 1,
            repairGateMode: 1,
            repairGateSpan: gateSpan,
          };

          const gapDrift = await calibrateGateGaps({
            presetParams: baseParams,
            variant: "drift",
            steps: 300_000,
            reportEvery,
            regionType: "stripe",
            regionIndex,
            gateSpan,
          });
          const gapRandom = await calibrateGateGaps({
            presetParams: baseParams,
            variant: "random",
            steps: 300_000,
            reportEvery,
            regionType: "stripe",
            regionIndex,
            gateSpan,
          });

          const deadline = Math.ceil(deadlineScale * (gapDrift.gapP95 ?? reportEvery));

          const drift = await runDeadlineEvents({
            presetParams: baseParams,
            variant: "drift",
            seeds,
            steps,
            reportEvery,
            eventEvery,
            deadline,
            regionType: "stripe",
            regionIndex,
            gateSpan,
            corruptFrac,
            errGood: 0.1,
            sdiffGood: 1.0,
            tailWindow,
          });
          const random = await runDeadlineEvents({
            presetParams: baseParams,
            variant: "random",
            seeds,
            steps,
            reportEvery,
            eventEvery,
            deadline,
            regionType: "stripe",
            regionIndex,
            gateSpan,
            corruptFrac,
            errGood: 0.1,
            sdiffGood: 1.0,
            tailWindow,
          });

          const driftMiss = mean(drift.runs.map((r) => r.missFrac));
          const randomMiss = mean(random.runs.map((r) => r.missFrac));
          const driftP95 = mean(drift.runs.map((r) => r.recoveryP95 ?? 0));
          const randomP95 = mean(random.runs.map((r) => r.recoveryP95 ?? 0));
          const driftUptimeTail = mean(drift.runs.map((r) => r.uptimeTail));
          const randomUptimeTail = mean(random.runs.map((r) => r.uptimeTail));
          const driftErrTail = mean(drift.runs.map((r) => r.errTailMean));
          const randomErrTail = mean(random.runs.map((r) => r.errTailMean));
          const driftEp = mean(drift.runs.map((r) => r.epTotalRate));
          const randomEp = mean(random.runs.map((r) => r.epTotalRate));
          const driftClock = mean(drift.runs.map((r) => r.epClockRate));
          const randomClock = mean(random.runs.map((r) => r.epClockRate));
          const driftRepair = mean(drift.runs.map((r) => r.epRepairRate));
          const randomRepair = mean(random.runs.map((r) => r.epRepairRate));
          const driftOther = mean(drift.runs.map((r) => r.epOtherRate));
          const randomOther = mean(random.runs.map((r) => r.epOtherRate));

          const sepMiss = randomMiss - driftMiss;
          const sepUptimeTail = driftUptimeTail - randomUptimeTail;
          const sepErrTail = randomErrTail - driftErrTail;
          const sepScore = sepMiss + 0.7 * sepUptimeTail + 0.7 * sepErrTail;
          if (driftMiss <= 0.2 && driftUptimeTail >= 0.7 && sepScore >= 0.5) {
            strongCount += 1;
          }

          rows.push({
            gridSize,
            gateSpan,
            codeNoiseRate,
            deadline,
            mu,
            etaDrive,
            gapP95Drift: gapDrift.gapP95 ?? 0,
            gapP95Random: gapRandom.gapP95 ?? 0,
            driftMiss,
            randomMiss,
            driftP95,
            randomP95,
            driftUptimeTail,
            randomUptimeTail,
            driftErrTail,
            randomErrTail,
            driftEp,
            randomEp,
            driftClock,
            randomClock,
            driftRepair,
            randomRepair,
            driftOther,
            randomOther,
            sepMiss,
            sepUptimeTail,
            sepErrTail,
            sepScore,
          });
          }
        }
      }
    }
  }
}

await evaluateGrid({
  gridSizeList: gridSizes,
  gateSpanList: gateSpans,
  noiseRateList: noiseRates,
  muList: mus,
  etaDriveList: etaDrives,
});

if (strongCount < 10) {
  console.log(
    `Strong separation count ${strongCount} < 10; expanding grid to size 64 with reduced sweep.`,
  );
  await evaluateGrid({
    gridSizeList: extraGridSizes,
    gateSpanList: gateSpans,
    noiseRateList: extraNoiseRates,
    muList: mus,
    etaDriveList: extraEtaDrives,
  });
}

const rawPath = path.join(outDir, "deadline_phase_v3_raw.jsonl");
const csvPath = path.join(outDir, "deadline_phase_v3.csv");
fs.writeFileSync(rawPath, rows.map((r) => JSON.stringify(r)).join("\n"));

const header = [
  "gridSize",
  "gateSpan",
  "codeNoiseRate",
  "deadline",
  "mu",
  "etaDrive",
  "gapP95Drift",
  "gapP95Random",
  "driftMiss",
  "randomMiss",
  "driftP95",
  "randomP95",
  "driftUptimeTail",
  "randomUptimeTail",
  "driftErrTail",
  "randomErrTail",
  "driftEpRate",
  "randomEpRate",
  "driftClockRate",
  "randomClockRate",
  "driftRepairRate",
  "randomRepairRate",
  "driftOtherRate",
  "randomOtherRate",
  "sepMiss",
  "sepUptimeTail",
  "sepErrTail",
  "sepScore",
];
const csvLines = [
  header.join(","),
  ...rows.map((r) =>
    [
      r.gridSize,
      r.gateSpan,
      r.codeNoiseRate,
      r.deadline,
      r.mu,
      r.etaDrive,
      r.gapP95Drift,
      r.gapP95Random,
      r.driftMiss,
      r.randomMiss,
      r.driftP95,
      r.randomP95,
      r.driftUptimeTail,
      r.randomUptimeTail,
      r.driftErrTail,
      r.randomErrTail,
      r.driftEp,
      r.randomEp,
      r.driftClock,
      r.randomClock,
      r.driftRepair,
      r.randomRepair,
      r.driftOther,
      r.randomOther,
      r.sepMiss,
      r.sepUptimeTail,
      r.sepErrTail,
      r.sepScore,
    ].join(","),
  ),
];
fs.writeFileSync(csvPath, csvLines.join("\n"));

console.log(`Phase diagram complete: ${rows.length} points, strong sep ${strongCount}`);
