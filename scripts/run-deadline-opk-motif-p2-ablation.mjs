#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { mean, std, readJson, parseSeedList } from "./deadline-event-utils.mjs";
import { runDeadlineOpkMotifEvents } from "./run-deadline-opk-motif-events.mjs";
import { coarseEPSmoothed, jsDivergence } from "./opk-motif-basis.mjs";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.resolve(rootDir, ".tmp", "motif_pressure_v3");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function pickPreset() {
  const preferred = path.resolve(rootDir, "scripts/params/op_motifs_selection/selection_base_tuned.json");
  const fallback = path.resolve(rootDir, "scripts/params/clock_code/code_deadline_gated_clock.json");
  if (fs.existsSync(preferred)) return preferred;
  return fallback;
}

function parseCsv(pathname) {
  if (!fs.existsSync(pathname)) return null;
  const raw = fs.readFileSync(pathname, "utf8").trim();
  if (!raw) return null;
  const lines = raw.split(/\r?\n/);
  const header = lines[0].split(",");
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i]) continue;
    const cols = lines[i].split(",");
    const row = {};
    header.forEach((key, idx) => {
      row[key] = cols[idx];
    });
    rows.push(row);
  }
  return rows;
}

function meanStd(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  return {
    mean: nums.length ? mean(nums) : null,
    std: nums.length ? std(nums) : null,
  };
}

function pairsToMap(pairs) {
  const map = new Map();
  for (const [key, count] of pairs ?? []) {
    map.set(String(key), (map.get(String(key)) ?? 0) + count);
  }
  return map;
}

function totalTransitions(counts) {
  let total = 0;
  for (const [key, count] of counts.entries()) {
    const [from, to] = key.split("|");
    if (from === to) continue;
    total += count;
  }
  return total;
}

function pickBestOpBinsMode() {
  const summaryPath = path.join(outDir, "compare_summary.csv");
  const rows = parseCsv(summaryPath);
  if (!rows) return 1;
  let best = { mode: 1, score: -Infinity };
  for (const row of rows) {
    if (!row.opBinsMode) continue;
    if (row.condition !== "B_op_noKdrive" && row.condition !== "C_op_withKdrive") continue;
    const score = Number(row.hazardOp_uniqueStatesMean ?? 0);
    if (Number.isFinite(score) && score > best.score) {
      best = { mode: Number(row.opBinsMode), score };
    }
  }
  return best.mode;
}

function eventRecoveryStats(events, family) {
  const countsSucc = new Map();
  const countsFail = new Map();
  const js = (a, b) => jsDivergence(a, b);
  const epTotalSucc = [];
  const epTotalFail = [];
  const epRepairSucc = [];
  const epRepairFail = [];
  const epOpSucc = [];
  const epOpFail = [];
  const changeSucc = [];
  const changeFail = [];

  for (const event of events) {
    const countsKey = family === "M_base" ? "recBaseHaz_counts" : "recOpHaz_counts";
    const pairs = event[countsKey] ?? [];
    const counts = pairsToMap(pairs);
    const target = event.success ? countsSucc : countsFail;
    for (const [key, val] of counts.entries()) {
      target.set(key, (target.get(key) ?? 0) + val);
    }

    if (family === "M_base") {
      const baseChange = event.rec_baseChangeCount ?? 0;
      const epTotal = event.rec_epTotal ?? 0;
      const epRepair = event.rec_epRepair ?? 0;
      const epTotalPer = baseChange > 0 ? epTotal / baseChange : 0;
      const epRepairPer = baseChange > 0 ? epRepair / baseChange : 0;
      if (event.success) {
        epTotalSucc.push(epTotalPer);
        epRepairSucc.push(epRepairPer);
      } else {
        epTotalFail.push(epTotalPer);
        epRepairFail.push(epRepairPer);
      }
    } else {
      const opChange = event.rec_opChangeCount ?? 0;
      const epOp = event.rec_epOpK ?? 0;
      const epOpPer = opChange > 0 ? epOp / opChange : 0;
      if (event.success) epOpSucc.push(epOpPer);
      else epOpFail.push(epOpPer);
    }

    const changeKey = family === "M_base" ? "rec_baseChange" : "rec_opChange";
    const change = event[changeKey] ?? 0;
    if (event.success) changeSucc.push(change);
    else changeFail.push(change);
  }

  return {
    js_divergence: js(countsSucc, countsFail),
    epTotalPerChange_succ: epTotalSucc.length ? mean(epTotalSucc) : null,
    epTotalPerChange_fail: epTotalFail.length ? mean(epTotalFail) : null,
    epRepairPerChange_succ: epRepairSucc.length ? mean(epRepairSucc) : null,
    epRepairPerChange_fail: epRepairFail.length ? mean(epRepairFail) : null,
    epOpKPerChange_succ: epOpSucc.length ? mean(epOpSucc) : null,
    epOpKPerChange_fail: epOpFail.length ? mean(epOpFail) : null,
    changeFrac_succ: changeSucc.length ? mean(changeSucc) : null,
    changeFrac_fail: changeFail.length ? mean(changeFail) : null,
  };
}

ensureDir(outDir);
const presetPath = pickPreset();
const presetRaw = readJson(presetPath);
const baseParams = presetRaw.params ?? presetRaw;
const deadline = presetRaw.deadline ?? 25_000;
const steps = presetRaw.steps ?? 2_000_000;
const reportEvery = presetRaw.reportEvery ?? 5_000;
const eventEvery = presetRaw.eventEvery ?? 50_000;
const seeds = parseSeedList(process.env.SEEDS ?? "1,2,3,4,5,6,7,8,9,10");

const opBinsMode = pickBestOpBinsMode();

const conditions = [
  { id: "A_legacy", condition: "A", overrides: { opCouplingOn: 0, sCouplingMode: 0 } },
  { id: "B_op_noKdrive", condition: "B", overrides: { opCouplingOn: 1, sCouplingMode: 1, opDriveOnK: 0 } },
  { id: "C_op_withKdrive", condition: "C", overrides: { opCouplingOn: 1, sCouplingMode: 1, opDriveOnK: 1 } },
];

const p2Modes = [
  { id: "p2_off", params: { pAWrite: 0, pNWrite: 0 } },
  { id: "p2_on", params: { pAWrite: 0.03, pNWrite: 0.03 } },
];

const rows = [];
for (const p2 of p2Modes) {
  for (const cond of conditions) {
    const runSummaries = [];
    const allEvents = [];
    const transBaseHaz = new Map();
    const transOpHaz = new Map();

    for (const seed of seeds) {
      const result = await runDeadlineOpkMotifEvents({
        presetPath,
        seed,
        condition: cond.condition,
        outDir,
        steps,
        reportEvery,
        eventEvery,
        deadline,
        regionType: baseParams.repairGateMode === 1 ? "stripe" : "quadrant",
        regionIndex: 2,
        gateSpan: baseParams.repairGateSpan ?? 1,
        corruptFrac: 0.2,
        errGood: 0.1,
        sdiffGood: 1.0,
        tailWindow: 200_000,
        opBinsMode,
        sets: [
          ...Object.entries(cond.overrides).map(([k, v]) => `${k}=${v}`),
          `pAWrite=${p2.params.pAWrite}`,
          `pNWrite=${p2.params.pNWrite}`,
        ],
      });
      runSummaries.push(result.summary);
      allEvents.push(...result.events);
      for (const [key, count] of result.summary.transitionsBaseHazard ?? []) {
        transBaseHaz.set(key, (transBaseHaz.get(key) ?? 0) + count);
      }
      for (const [key, count] of result.summary.transitionsOpHazard ?? []) {
        transOpHaz.set(key, (transOpHaz.get(key) ?? 0) + count);
      }
    }

    const missFrac = meanStd(runSummaries.map((s) => s.missFrac));
    const uptimeTail = meanStd(runSummaries.map((s) => s.uptimeTail));
    const errTail = meanStd(runSummaries.map((s) => s.errTailMean));

    const hazardBaseV = meanStd(runSummaries.map((s) => s.hazardBase_Veff?.mean));
    const hazardOpV = meanStd(runSummaries.map((s) => s.hazardOp_Veff?.mean));
    const hazardOpUnique = meanStd(runSummaries.map((s) => s.uniqueOpHazard));

    const baseTransTotal = totalTransitions(transBaseHaz);
    const opTransTotal = totalTransitions(transOpHaz);
    const baseCoarse = coarseEPSmoothed(transBaseHaz, 0.5);
    const opCoarse = coarseEPSmoothed(transOpHaz, 0.5);

    const basePerTrans = baseTransTotal > 0 ? baseCoarse / baseTransTotal : 0;
    const opPerTrans = opTransTotal > 0 ? opCoarse / opTransTotal : 0;

    const baseStats = eventRecoveryStats(allEvents, "M_base");
    const opStats = eventRecoveryStats(allEvents, "M_op");

    rows.push({
      p2Mode: p2.id,
      condition: cond.id,
      opBinsMode,
      seeds: seeds.length,
      missFracMean: missFrac.mean,
      missFracStd: missFrac.std,
      uptimeTailMean: uptimeTail.mean,
      uptimeTailStd: uptimeTail.std,
      errTailMean: errTail.mean,
      errTailStd: errTail.std,
      hazardBaseVeffMean: hazardBaseV.mean,
      hazardBaseVeffStd: hazardBaseV.std,
      hazardOpVeffMean: hazardOpV.mean,
      hazardOpVeffStd: hazardOpV.std,
      hazardOpUniqueMean: hazardOpUnique.mean,
      hazardOpUniqueStd: hazardOpUnique.std,
      hazardBase_coarseEP_perTrans: basePerTrans,
      hazardOp_coarseEP_perTrans: opPerTrans,
      hazardBase_js_divergence: baseStats.js_divergence,
      hazardOp_js_divergence: opStats.js_divergence,
      hazardBase_epTotalPerChange_succ: baseStats.epTotalPerChange_succ,
      hazardBase_epTotalPerChange_fail: baseStats.epTotalPerChange_fail,
      hazardBase_epRepairPerChange_succ: baseStats.epRepairPerChange_succ,
      hazardBase_epRepairPerChange_fail: baseStats.epRepairPerChange_fail,
      hazardOp_epOpKPerChange_succ: opStats.epOpKPerChange_succ,
      hazardOp_epOpKPerChange_fail: opStats.epOpKPerChange_fail,
      hazardBase_changeFrac_succ: baseStats.changeFrac_succ,
      hazardBase_changeFrac_fail: baseStats.changeFrac_fail,
      hazardOp_changeFrac_succ: opStats.changeFrac_succ,
      hazardOp_changeFrac_fail: opStats.changeFrac_fail,
    });
  }
}

const header = Object.keys(rows[0] ?? {}).join(",");
const lines = [header];
for (const row of rows) {
  lines.push(Object.values(row).join(","));
}
fs.writeFileSync(path.join(outDir, "p2_ablation_summary.csv"), lines.join("\n") + "\n");

console.log(`p2 ablation summary written: ${path.join(outDir, "p2_ablation_summary.csv")}`);
console.log(`opBinsMode used: ${opBinsMode}`);
