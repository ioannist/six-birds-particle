#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  loadWasm,
  mean,
  parseSeedList,
  readJson,
  runDeadlineEvents,
} from "./deadline-event-utils.mjs";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.resolve(rootDir, ".tmp", "clock_code");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

ensureDir(outDir);
await loadWasm();

function safeDiv(num, den) {
  return den === 0 ? 0 : num / den;
}

const phasePath = path.join(outDir, "deadline_phase_v3.csv");
if (!fs.existsSync(phasePath)) {
  console.error("Missing phase diagram CSV. Run run-deadline-phase-diagram.mjs first.");
  process.exit(1);
}

const lines = fs.readFileSync(phasePath, "utf8").trim().split("\n");
const header = lines[0].split(",");
const rows = lines.slice(1).map((line) => {
  const parts = line.split(",");
  const row = {};
  header.forEach((h, i) => {
    row[h] = Number(parts[i]);
  });
  return row;
});

rows.sort((a, b) => b.sepScore - a.sepScore);
const top = rows.slice(0, 30);

const steps = 2_000_000;
const reportEvery = 1_000;
const eventEvery = 50_000;
const seeds = Array.from({ length: 10 }, (_, i) => i + 1);
const corruptFrac = 0.1;
const tailWindow = 200_000;

let found = null;
let foundStats = null;
let foundDeadline = null;
let criteriaMet = false;
let bestCandidate = null;
let bestScore = -Infinity;

const candidates = top;

for (const row of candidates) {
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
    muHigh: row.mu,
    muLow: row.mu,
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
    gridSize: row.gridSize,
    rPropose: 0.12,
    metaLayers: 2,
    eta: 0.0,
    etaDrive: row.etaDrive,
    codeNoiseRate: row.codeNoiseRate,
    codeNoiseBatch: 1,
    codeNoiseLayer: 0,
    clockOn: 1,
    clockK: row.gridSize,
    clockFrac: 1.0,
    clockUsesP6: 1,
    repairClockGated: 1,
    repairGateMode: 1,
    repairGateSpan: row.gateSpan,
  };

  const regionIndex = Math.floor(row.gridSize / 2);
  const drift = await runDeadlineEvents({
    presetParams: baseParams,
    variant: "drift",
    seeds,
    steps,
    reportEvery,
    eventEvery,
    deadline: row.deadline,
    regionType: "stripe",
    regionIndex,
    gateSpan: row.gateSpan,
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
    deadline: row.deadline,
    regionType: "stripe",
    regionIndex,
    gateSpan: row.gateSpan,
    corruptFrac,
    errGood: 0.1,
    sdiffGood: 1.0,
    tailWindow,
  });
  const staticCtrl = await runDeadlineEvents({
    presetParams: baseParams,
    variant: "static",
    seeds,
    steps,
    reportEvery,
    eventEvery,
    deadline: row.deadline,
    regionType: "stripe",
    regionIndex,
    gateSpan: row.gateSpan,
    corruptFrac,
    errGood: 0.1,
    sdiffGood: 1.0,
    tailWindow,
  });

  const driftMiss = mean(drift.runs.map((r) => r.missFrac));
  const driftUptimeTail = mean(drift.runs.map((r) => r.uptimeTail));
  const driftErrTail = mean(drift.runs.map((r) => r.errTailMean));
  const randomMiss = mean(random.runs.map((r) => r.missFrac));
  const randomUptimeTail = mean(random.runs.map((r) => r.uptimeTail));
  const randomErrTail = mean(random.runs.map((r) => r.errTailMean));
  const staticMiss = mean(staticCtrl.runs.map((r) => r.missFrac));
  const staticUptimeTail = mean(staticCtrl.runs.map((r) => r.uptimeTail));

  const okDrift = driftMiss <= 0.2 && driftUptimeTail >= 0.8 && driftErrTail <= 0.05;
  const okRandom = randomMiss >= 0.6 || randomUptimeTail <= 0.5 || randomErrTail >= 0.15;
  const okStatic = staticMiss >= 0.8 && staticUptimeTail <= 0.2;

  const sepMiss = randomMiss - driftMiss;
  const sepUptime = driftUptimeTail - randomUptimeTail;
  const sepErr = randomErrTail - driftErrTail;
  const score = sepMiss + 0.7 * sepUptime + 0.7 * sepErr;
  if (score > bestScore) {
    bestScore = score;
    bestCandidate = { params: baseParams, stats: { drift, random, static: staticCtrl }, deadline: row.deadline };
  }

  if (okDrift && okRandom && okStatic) {
    found = baseParams;
    foundStats = { drift, random, static: staticCtrl };
    foundDeadline = row.deadline;
    criteriaMet = true;
    break;
  }
}

if (!found && bestCandidate) {
  found = bestCandidate.params;
  foundStats = bestCandidate.stats;
  foundDeadline = bestCandidate.deadline;
}

const foundPath = path.resolve(rootDir, "scripts/params/clock_code/deadline_fidelity_found.json");
fs.writeFileSync(
  foundPath,
  JSON.stringify(
    {
      params: found,
      deadline: foundDeadline,
      notes: criteriaMet
        ? "Found via run-fidelity-separation-search.mjs"
        : "Best available candidate; strict fidelity criteria not met",
    },
    null,
    2,
  ),
);

const driftPath = path.resolve(rootDir, "scripts/params/clock_code/deadline_fidelity_drift.json");
const randomPath = path.resolve(rootDir, "scripts/params/clock_code/deadline_fidelity_random.json");
const staticPath = path.resolve(rootDir, "scripts/params/clock_code/deadline_fidelity_static.json");

fs.writeFileSync(driftPath, JSON.stringify({ ...found, clockOn: 1, clockUsesP6: 1 }, null, 2));
fs.writeFileSync(randomPath, JSON.stringify({ ...found, clockOn: 1, clockUsesP6: 0 }, null, 2));
fs.writeFileSync(staticPath, JSON.stringify({ ...found, clockOn: 0, clockUsesP6: 1 }, null, 2));

const rawPath = path.join(outDir, "deadline_fidelity_v3_raw.jsonl");
const summaryPath = path.join(outDir, "deadline_fidelity_v3_summary.csv");
const rawLines = [];
for (const [variant, data] of Object.entries(foundStats)) {
  for (const run of data.runs) {
    rawLines.push(JSON.stringify({ variant, ...run }));
  }
}
fs.writeFileSync(rawPath, rawLines.join("\n"));

const summaryLines = [
  "variant,missFrac,uptimeTail,errTailMean,recoveryP95,epTotalRate,epClockRate,epRepairRate,epNoiseRate",
];
for (const [variant, data] of Object.entries(foundStats)) {
  const missFrac = mean(data.runs.map((r) => r.missFrac));
  const uptimeTail = mean(data.runs.map((r) => r.uptimeTail));
  const errTail = mean(data.runs.map((r) => r.errTailMean));
  const recoveryP95 = mean(data.runs.map((r) => r.recoveryP95 ?? 0));
  const epTotalRate = mean(data.runs.map((r) => r.epTotalRate));
  const epClockRate = mean(data.runs.map((r) => r.epClockRate));
  const epRepairRate = mean(data.runs.map((r) => r.epRepairRate));
  const epNoiseRate = mean(data.runs.map((r) => r.epNoiseRate));
  summaryLines.push(
    [variant, missFrac, uptimeTail, errTail, recoveryP95, epTotalRate, epClockRate, epRepairRate, epNoiseRate].join(","),
  );
}
fs.writeFileSync(summaryPath, summaryLines.join("\n"));

const driftStats = foundStats.drift.runs;
const randomStats = foundStats.random.runs;
const driftMiss = mean(driftStats.map((r) => r.missFrac));
const randomMiss = mean(randomStats.map((r) => r.missFrac));
const driftUptime = mean(driftStats.map((r) => r.uptimeTail));
const randomUptime = mean(randomStats.map((r) => r.uptimeTail));
const driftEp = mean(driftStats.map((r) => r.epTotalRate));
const randomEp = mean(randomStats.map((r) => r.epTotalRate));
const driftClock = mean(driftStats.map((r) => r.epClockRate));
const randomClock = mean(randomStats.map((r) => r.epClockRate));
const driftRepair = mean(driftStats.map((r) => r.epRepairRate));
const randomRepair = mean(randomStats.map((r) => r.epRepairRate));
const avoidedMiss = Math.max(1e-6, randomMiss - driftMiss);
const uptimeGain = Math.max(1e-6, driftUptime - randomUptime);
const deltaEP = driftEp - randomEp;
const deltaEPClock = driftClock - randomClock;
const deltaEPRepair = driftRepair - randomRepair;
const driftClockFrac = safeDiv(driftClock, driftEp);
const driftRepairFrac = safeDiv(driftRepair, driftEp);
const randomClockFrac = safeDiv(randomClock, randomEp);
const randomRepairFrac = safeDiv(randomRepair, randomEp);

const effRows = [
  "source,gridSize,gateSpan,codeNoiseRate,deadline,mu,etaDrive,avoidedMiss,uptimeTailGain,deltaEP,deltaEPClock,deltaEPRepair,EP_per_avoided_miss,EPClock_per_avoided_miss,EPRepair_per_avoided_miss,EPClock_per_uptimeTail_gain,driftClockFrac,driftRepairFrac,randomClockFrac,randomRepairFrac",
];
for (const row of top.slice(0, 10)) {
  const avoided = Math.max(1e-6, row.randomMiss - row.driftMiss);
  const uptime = Math.max(1e-6, row.driftUptimeTail - row.randomUptimeTail);
  const delta = row.driftEpRate - row.randomEpRate;
  const deltaClock = row.driftClockRate - row.randomClockRate;
  const deltaRepair = row.driftRepairRate - row.randomRepairRate;
  effRows.push(
    [
      "phaseTop",
      row.gridSize,
      row.gateSpan,
      row.codeNoiseRate,
      row.deadline,
      row.mu,
      row.etaDrive,
      avoided,
      uptime,
      delta,
      deltaClock,
      deltaRepair,
      safeDiv(delta, avoided),
      safeDiv(deltaClock, avoided),
      safeDiv(deltaRepair, avoided),
      safeDiv(deltaClock, uptime),
      safeDiv(row.driftClockRate, row.driftEpRate),
      safeDiv(row.driftRepairRate, row.driftEpRate),
      safeDiv(row.randomClockRate, row.randomEpRate),
      safeDiv(row.randomRepairRate, row.randomEpRate),
    ].join(","),
  );
}
effRows.push(
  [
    "found",
    found.gridSize,
    found.repairGateSpan,
    found.codeNoiseRate,
    foundDeadline,
    found.muHigh,
    found.etaDrive,
    avoidedMiss,
    uptimeGain,
    deltaEP,
    deltaEPClock,
    deltaEPRepair,
    safeDiv(deltaEP, avoidedMiss),
    safeDiv(deltaEPClock, avoidedMiss),
    safeDiv(deltaEPRepair, avoidedMiss),
    safeDiv(deltaEPClock, uptimeGain),
    driftClockFrac,
    driftRepairFrac,
    randomClockFrac,
    randomRepairFrac,
  ].join(","),
);

const effPath = path.join(outDir, "ep_efficiency_v3.csv");
fs.writeFileSync(effPath, effRows.join("\n"));

console.log("Fidelity separation found:");
console.log(foundPath);
console.log("Summary:");
console.log(summaryLines.join("\n"));

if (!criteriaMet) {
  console.error("No fidelity separation config met strict criteria; wrote best candidate.");
  process.exitCode = 1;
}
