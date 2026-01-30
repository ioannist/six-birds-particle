#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { mean, std, readJson, parseSeedList } from "./deadline-event-utils.mjs";
import { runDeadlineOpkMotifEvents } from "./run-deadline-opk-motif-events.mjs";
import { coarseEPSmoothed, asymmetryScore, jsDivergence } from "./opk-motif-basis.mjs";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDirState = path.resolve(rootDir, ".tmp", "motif_pressure_v4");
const outDirMove = path.resolve(rootDir, ".tmp", "motif_pressure_v5");
const outDirP5 = path.resolve(rootDir, ".tmp", "motif_pressure_v6");
let outDir = outDirState;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseMoveEdgesCounts(pathname) {
  if (!fs.existsSync(pathname)) return new Map();
  const raw = fs.readFileSync(pathname, "utf8").trim();
  if (!raw) return new Map();
  const lines = raw.split(/\r?\n/);
  const counts = new Map();
  const epSum = new Map();
  const epAbsSum = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const [fromIdx, toIdx, count, epSumVal, epAbsVal] = lines[i].split(",");
    const key = `${fromIdx}->${toIdx}`;
    counts.set(key, (counts.get(key) ?? 0) + Number(count ?? 0));
    epSum.set(key, (epSum.get(key) ?? 0) + Number(epSumVal ?? 0));
    epAbsSum.set(key, (epAbsSum.get(key) ?? 0) + Number(epAbsVal ?? 0));
  }
  return { counts, epSum, epAbsSum };
}

function totalMovesFromCounts(counts) {
  let total = 0;
  for (const count of counts.values()) total += count;
  return total;
}

function topEdgeMass(counts, topN) {
  const total = totalMovesFromCounts(counts);
  if (total === 0) return 0;
  const values = Array.from(counts.values()).sort((a, b) => b - a);
  const topSum = values.slice(0, topN).reduce((acc, v) => acc + v, 0);
  return topSum / total;
}

function symmetryGap(counts) {
  const pairMap = new Map();
  for (const [key, count] of counts.entries()) {
    const [fromStr, toStr] = key.split("->");
    const from = Number(fromStr);
    const to = Number(toStr);
    if (Number.isNaN(from) || Number.isNaN(to) || from === to) continue;
    const a = Math.min(from, to);
    const b = Math.max(from, to);
    const pairKey = `${a}|${b}`;
    const prev = pairMap.get(pairKey) ?? { ab: 0, ba: 0, a, b };
    if (from === a) prev.ab += count;
    else prev.ba += count;
    pairMap.set(pairKey, prev);
  }
  let num = 0;
  let denom = 0;
  for (const pair of pairMap.values()) {
    num += Math.abs(pair.ab - pair.ba);
    denom += pair.ab + pair.ba;
  }
  return denom > 0 ? num / denom : 0;
}

function coarseEPFromCounts(counts, alpha = 0.5) {
  const pairMap = new Map();
  for (const [key, count] of counts.entries()) {
    const [fromStr, toStr] = key.split("->");
    const from = Number(fromStr);
    const to = Number(toStr);
    if (Number.isNaN(from) || Number.isNaN(to) || from === to) continue;
    const a = Math.min(from, to);
    const b = Math.max(from, to);
    const pairKey = `${a}|${b}`;
    const prev = pairMap.get(pairKey) ?? { ab: 0, ba: 0, a, b };
    if (from === a) prev.ab += count;
    else prev.ba += count;
    pairMap.set(pairKey, prev);
  }
  let total = 0;
  for (const pair of pairMap.values()) {
    const nij = pair.ab;
    const nji = pair.ba;
    const c1 = nij + alpha;
    const c2 = nji + alpha;
    total += (nij - nji) * Math.log(c1 / c2);
  }
  return total;
}

function edgeAggKey(condition, key) {
  return `${condition}|${key}`;
}

function parseP5Counts(pathname) {
  if (!fs.existsSync(pathname)) return { counts: new Map(), epSum: new Map(), epAbsSum: new Map() };
  const raw = fs.readFileSync(pathname, "utf8").trim();
  if (!raw) return { counts: new Map(), epSum: new Map(), epAbsSum: new Map() };
  const lines = raw.split(/\r?\n/);
  const counts = new Map();
  const epSum = new Map();
  const epAbsSum = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const [motifId, count, epSumVal, epAbsVal] = lines[i].split(",");
    const key = String(motifId);
    counts.set(key, (counts.get(key) ?? 0) + Number(count ?? 0));
    epSum.set(key, (epSum.get(key) ?? 0) + Number(epSumVal ?? 0));
    epAbsSum.set(key, (epAbsSum.get(key) ?? 0) + Number(epAbsVal ?? 0));
  }
  return { counts, epSum, epAbsSum };
}

function parseP5Transitions(pathname) {
  if (!fs.existsSync(pathname)) return new Map();
  const raw = fs.readFileSync(pathname, "utf8").trim();
  if (!raw) return new Map();
  const lines = raw.split(/\r?\n/);
  const counts = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const [fromMotif, toMotif, count] = lines[i].split(",");
    const key = `${fromMotif}->${toMotif}`;
    counts.set(key, (counts.get(key) ?? 0) + Number(count ?? 0));
  }
  return counts;
}

function entropyFromCountsMap(counts) {
  let total = 0;
  for (const val of counts.values()) total += val;
  if (total === 0) return 0;
  let h = 0;
  for (const val of counts.values()) {
    if (val <= 0) continue;
    const p = val / total;
    h += -p * Math.log(p);
  }
  return h;
}

function topMassFromCounts(counts, topN) {
  const total = totalMovesFromCounts(counts);
  if (total === 0) return 0;
  const values = Array.from(counts.values()).sort((a, b) => b - a);
  const topSum = values.slice(0, topN).reduce((acc, v) => acc + v, 0);
  return topSum / total;
}

async function runMoveEdgesCompare({ presetPath, seeds, eventEvery, deadline }) {
  outDir = outDirMove;
  ensureDir(outDir);

  const conditions = [
    { id: "A", label: "A_legacy", sets: ["opCouplingOn=0", "sCouplingMode=0", "opDriveOnK=0"] },
    { id: "B", label: "B_op_noKdrive", sets: ["opCouplingOn=1", "sCouplingMode=1", "opDriveOnK=0"] },
    { id: "C", label: "C_op_withKdrive", sets: ["opCouplingOn=1", "sCouplingMode=1", "opDriveOnK=1"] },
  ];

  const perCondition = new Map();
  const edgeAgg = new Map();

  for (const cond of conditions) {
    const rows = [];
    for (const seed of seeds) {
      await runDeadlineOpkMotifEvents({
        presetPath,
        seed,
        condition: cond.id,
        outDir,
        motifMode: "move_edges",
        eventEvery,
        deadline,
        sets: cond.sets,
      });

      const seedDir = path.join(outDir, cond.id, `seed_${seed}`);
      const summaryPath = path.join(seedDir, "move_edges_summary.json");
      const summary = readJson(summaryPath);
      const hazCountsPath = path.join(seedDir, "move_edges_counts_hazard.csv");
      const outCountsPath = path.join(seedDir, "move_edges_counts_outside.csv");
      const hazCounts = parseMoveEdgesCounts(hazCountsPath);
      const outCounts = parseMoveEdgesCounts(outCountsPath);

      const totalMovesHazard = summary.totalMovesHazard ?? totalMovesFromCounts(hazCounts.counts);
      const totalMovesOutside = summary.totalMovesOutside ?? totalMovesFromCounts(outCounts.counts);
      const totalEpHazard = summary.totalEpHazard ?? 0;
      const totalEpOutside = summary.totalEpOutside ?? 0;
      const uniqueEdgesHazard = summary.uniqueEdgesHazard ?? hazCounts.counts.size;
      const uniqueEdgesOutside = summary.uniqueEdgesOutside ?? outCounts.counts.size;

      rows.push({
        totalMovesHazard,
        totalMovesOutside,
        totalEpHazard,
        totalEpOutside,
        uniqueEdgesHazard,
        uniqueEdgesOutside,
        epPerMoveHazard: totalMovesHazard > 0 ? totalEpHazard / totalMovesHazard : 0,
        epPerMoveOutside: totalMovesOutside > 0 ? totalEpOutside / totalMovesOutside : 0,
        topEdgeMass10Hazard: topEdgeMass(hazCounts.counts, 10),
        topEdgeMass10Outside: topEdgeMass(outCounts.counts, 10),
        symmetryGapHazard: symmetryGap(hazCounts.counts),
        symmetryGapOutside: symmetryGap(outCounts.counts),
        coarseEPHazard: coarseEPFromCounts(hazCounts.counts, 0.5),
        coarseEPOutside: coarseEPFromCounts(outCounts.counts, 0.5),
      });

      for (const [key, count] of hazCounts.counts.entries()) {
        const aggKey = edgeAggKey(cond.label, key);
        const prev = edgeAgg.get(aggKey) ?? { condition: cond.label, key, countSum: 0, epSum: 0 };
        prev.countSum += count;
        prev.epSum += hazCounts.epSum.get(key) ?? 0;
        edgeAgg.set(aggKey, prev);
      }
    }
    perCondition.set(cond.label, rows);
  }

  const summaryRows = [];
  for (const [condition, rows] of perCondition.entries()) {
    const seedsCount = rows.length;
    const toMetric = (key) => rows.map((r) => r[key]);
    summaryRows.push({
      condition,
      seeds: seedsCount,
      totalMovesHazardMean: mean(toMetric("totalMovesHazard")),
      totalMovesHazardStd: std(toMetric("totalMovesHazard")),
      uniqueEdgesHazardMean: mean(toMetric("uniqueEdgesHazard")),
      uniqueEdgesHazardStd: std(toMetric("uniqueEdgesHazard")),
      totalEpHazardMean: mean(toMetric("totalEpHazard")),
      totalEpHazardStd: std(toMetric("totalEpHazard")),
      epPerMoveHazardMean: mean(toMetric("epPerMoveHazard")),
      topEdgeMass10HazardMean: mean(toMetric("topEdgeMass10Hazard")),
      symmetryGapHazardMean: mean(toMetric("symmetryGapHazard")),
      coarseEPHazardMean: mean(toMetric("coarseEPHazard")),
      totalMovesOutsideMean: mean(toMetric("totalMovesOutside")),
      totalMovesOutsideStd: std(toMetric("totalMovesOutside")),
      uniqueEdgesOutsideMean: mean(toMetric("uniqueEdgesOutside")),
      uniqueEdgesOutsideStd: std(toMetric("uniqueEdgesOutside")),
      totalEpOutsideMean: mean(toMetric("totalEpOutside")),
      totalEpOutsideStd: std(toMetric("totalEpOutside")),
      epPerMoveOutsideMean: mean(toMetric("epPerMoveOutside")),
      topEdgeMass10OutsideMean: mean(toMetric("topEdgeMass10Outside")),
      symmetryGapOutsideMean: mean(toMetric("symmetryGapOutside")),
      coarseEPOutsideMean: mean(toMetric("coarseEPOutside")),
    });
  }

  const summaryHeader = [
    "condition",
    "seeds",
    "totalMovesHazardMean",
    "totalMovesHazardStd",
    "uniqueEdgesHazardMean",
    "uniqueEdgesHazardStd",
    "totalEpHazardMean",
    "totalEpHazardStd",
    "epPerMoveHazardMean",
    "topEdgeMass10HazardMean",
    "symmetryGapHazardMean",
    "coarseEPHazardMean",
    "totalMovesOutsideMean",
    "totalMovesOutsideStd",
    "uniqueEdgesOutsideMean",
    "uniqueEdgesOutsideStd",
    "totalEpOutsideMean",
    "totalEpOutsideStd",
    "epPerMoveOutsideMean",
    "topEdgeMass10OutsideMean",
    "symmetryGapOutsideMean",
    "coarseEPOutsideMean",
  ];
  const summaryLines = [summaryHeader.join(",")];
  for (const row of summaryRows) {
    summaryLines.push(summaryHeader.map((key) => row[key]).join(","));
  }
  fs.writeFileSync(path.join(outDir, "compare_move_edges_summary.csv"), summaryLines.join("\n") + "\n");

  const edgeRows = [];
  for (const entry of edgeAgg.values()) {
    const [fromIdx, toIdx] = entry.key.split("->");
    const seedsCount = perCondition.get(entry.condition)?.length ?? 1;
    edgeRows.push({
      condition: entry.condition,
      fromIdx,
      toIdx,
      countMean: entry.countSum / seedsCount,
      epSumMean: entry.epSum / seedsCount,
    });
  }
  edgeRows.sort((a, b) => b.countMean - a.countMean);
  const topEdges = edgeRows.slice(0, 30);
  const edgeHeader = ["condition", "fromIdx", "toIdx", "countMean", "epSumMean"];
  const edgeLines = [edgeHeader.join(",")];
  for (const row of topEdges) {
    edgeLines.push(edgeHeader.map((key) => row[key]).join(","));
  }
  fs.writeFileSync(path.join(outDir, "top_edges_hazard.csv"), edgeLines.join("\n") + "\n");

  const summaryByCond = new Map(summaryRows.map((row) => [row.condition, row]));
  const bRow = summaryByCond.get("B_op_noKdrive");
  const cRow = summaryByCond.get("C_op_withKdrive");
  const signalOk =
    bRow &&
    cRow &&
    bRow.totalMovesHazardMean >= 5000 &&
    cRow.totalMovesHazardMean >= 5000 &&
    (bRow.symmetryGapHazardMean >= 0.05 ||
      bRow.coarseEPHazardMean >= 50 ||
      cRow.symmetryGapHazardMean >= 0.05 ||
      cRow.coarseEPHazardMean >= 50);

  console.log(signalOk ? "MOVE_EDGE_MOTIF_SIGNAL_OK" : "MOVE_EDGE_MOTIF_SIGNAL_TOO_WEAK");
}

async function runP5ActionsCompare({ presetPath, seeds, eventEvery, deadline }) {
  outDir = outDirP5;
  ensureDir(outDir);

  const conditions = [
    { id: "A", label: "A_legacy", sets: ["opCouplingOn=0", "sCouplingMode=0", "opDriveOnK=0"] },
    { id: "B", label: "B_op_noKdrive", sets: ["opCouplingOn=1", "sCouplingMode=1", "opDriveOnK=0"] },
    { id: "C", label: "C_op_withKdrive", sets: ["opCouplingOn=1", "sCouplingMode=1", "opDriveOnK=1"] },
  ];

  const perCondition = new Map();
  const motifAggHazard = new Map();
  const motifAggOutside = new Map();

  for (const cond of conditions) {
    const rows = [];
    for (const seed of seeds) {
      await runDeadlineOpkMotifEvents({
        presetPath,
        seed,
        condition: cond.id,
        outDir,
        motifMode: "p5_actions",
        eventEvery,
        deadline,
        sets: cond.sets,
      });

      const seedDir = path.join(outDir, cond.id, `seed_${seed}`);
      const summary = readJson(path.join(seedDir, "p5_actions_summary.json"));
      const hazCounts = parseP5Counts(path.join(seedDir, "p5_actions_counts_hazard.csv"));
      const outCounts = parseP5Counts(path.join(seedDir, "p5_actions_counts_outside.csv"));
      const hazTrans = parseP5Transitions(path.join(seedDir, "p5_actions_transitions_hazard.csv"));
      const outTrans = parseP5Transitions(path.join(seedDir, "p5_actions_transitions_outside.csv"));

      const totalMovesHazard = summary.totalMovesHazard ?? totalMovesFromCounts(hazCounts.counts);
      const totalMovesOutside = summary.totalMovesOutside ?? totalMovesFromCounts(outCounts.counts);
      const totalEpHazard = summary.totalEpHazard ?? 0;
      const totalEpOutside = summary.totalEpOutside ?? 0;
      const uniqueMotifsHazard = summary.uniqueMotifsHazard ?? hazCounts.counts.size;
      const uniqueMotifsOutside = summary.uniqueMotifsOutside ?? outCounts.counts.size;
      const epPerMoveHazard = totalMovesHazard > 0 ? totalEpHazard / totalMovesHazard : 0;
      const epPerMoveOutside = totalMovesOutside > 0 ? totalEpOutside / totalMovesOutside : 0;
      const entropyHazard = entropyFromCountsMap(hazCounts.counts);
      const entropyOutside = entropyFromCountsMap(outCounts.counts);
      const topMotifMass10Hazard = topMassFromCounts(hazCounts.counts, 10);
      const topMotifMass10Outside = topMassFromCounts(outCounts.counts, 10);
      const symmetryGapHazard = symmetryGap(hazTrans);
      const symmetryGapOutside = symmetryGap(outTrans);
      const coarseEPHazard = coarseEPFromCounts(hazTrans, 0.5);
      const coarseEPOutside = coarseEPFromCounts(outTrans, 0.5);

      rows.push({
        totalMovesHazard,
        totalMovesOutside,
        totalEpHazard,
        totalEpOutside,
        uniqueMotifsHazard,
        uniqueMotifsOutside,
        epPerMoveHazard,
        epPerMoveOutside,
        entropyHazard,
        entropyOutside,
        topMotifMass10Hazard,
        topMotifMass10Outside,
        symmetryGapHazard,
        symmetryGapOutside,
        coarseEPHazard,
        coarseEPOutside,
      });

      for (const [motifId, count] of hazCounts.counts.entries()) {
        const key = `${cond.label}|${motifId}`;
        const prev = motifAggHazard.get(key) ?? { condition: cond.label, motifId, countSum: 0, epSum: 0 };
        prev.countSum += count;
        prev.epSum += hazCounts.epSum.get(motifId) ?? 0;
        motifAggHazard.set(key, prev);
      }
      for (const [motifId, count] of outCounts.counts.entries()) {
        const key = `${cond.label}|${motifId}`;
        const prev = motifAggOutside.get(key) ?? { condition: cond.label, motifId, countSum: 0, epSum: 0 };
        prev.countSum += count;
        prev.epSum += outCounts.epSum.get(motifId) ?? 0;
        motifAggOutside.set(key, prev);
      }
    }
    perCondition.set(cond.label, rows);
  }

  const summaryRows = [];
  for (const [condition, rows] of perCondition.entries()) {
    const seedsCount = rows.length;
    const toMetric = (key) => rows.map((r) => r[key]);
    summaryRows.push({
      condition,
      seeds: seedsCount,
      totalMovesHazardMean: mean(toMetric("totalMovesHazard")),
      totalMovesHazardStd: std(toMetric("totalMovesHazard")),
      uniqueMotifsHazardMean: mean(toMetric("uniqueMotifsHazard")),
      uniqueMotifsHazardStd: std(toMetric("uniqueMotifsHazard")),
      totalEpHazardMean: mean(toMetric("totalEpHazard")),
      totalEpHazardStd: std(toMetric("totalEpHazard")),
      epPerMoveHazardMean: mean(toMetric("epPerMoveHazard")),
      entropyHazardMean: mean(toMetric("entropyHazard")),
      topMotifMass10HazardMean: mean(toMetric("topMotifMass10Hazard")),
      symmetryGapHazardMean: mean(toMetric("symmetryGapHazard")),
      coarseEPHazardMean: mean(toMetric("coarseEPHazard")),
      totalMovesOutsideMean: mean(toMetric("totalMovesOutside")),
      totalMovesOutsideStd: std(toMetric("totalMovesOutside")),
      uniqueMotifsOutsideMean: mean(toMetric("uniqueMotifsOutside")),
      uniqueMotifsOutsideStd: std(toMetric("uniqueMotifsOutside")),
      totalEpOutsideMean: mean(toMetric("totalEpOutside")),
      totalEpOutsideStd: std(toMetric("totalEpOutside")),
      epPerMoveOutsideMean: mean(toMetric("epPerMoveOutside")),
      entropyOutsideMean: mean(toMetric("entropyOutside")),
      topMotifMass10OutsideMean: mean(toMetric("topMotifMass10Outside")),
      symmetryGapOutsideMean: mean(toMetric("symmetryGapOutside")),
      coarseEPOutsideMean: mean(toMetric("coarseEPOutside")),
    });
  }

  const summaryHeader = [
    "condition",
    "seeds",
    "totalMovesHazardMean",
    "totalMovesHazardStd",
    "uniqueMotifsHazardMean",
    "uniqueMotifsHazardStd",
    "totalEpHazardMean",
    "totalEpHazardStd",
    "epPerMoveHazardMean",
    "entropyHazardMean",
    "topMotifMass10HazardMean",
    "symmetryGapHazardMean",
    "coarseEPHazardMean",
    "totalMovesOutsideMean",
    "totalMovesOutsideStd",
    "uniqueMotifsOutsideMean",
    "uniqueMotifsOutsideStd",
    "totalEpOutsideMean",
    "totalEpOutsideStd",
    "epPerMoveOutsideMean",
    "entropyOutsideMean",
    "topMotifMass10OutsideMean",
    "symmetryGapOutsideMean",
    "coarseEPOutsideMean",
  ];
  const summaryLines = [summaryHeader.join(",")];
  for (const row of summaryRows) {
    summaryLines.push(summaryHeader.map((key) => row[key]).join(","));
  }
  fs.writeFileSync(path.join(outDir, "compare_p5_actions_summary.csv"), summaryLines.join("\n") + "\n");

  const emitTopMotifs = (aggMap, filename) => {
    const rows = [];
    for (const entry of aggMap.values()) {
      const seedsCount = perCondition.get(entry.condition)?.length ?? 1;
      rows.push({
        condition: entry.condition,
        motifId: entry.motifId,
        countMean: entry.countSum / seedsCount,
        epPerMoveMean: entry.countSum > 0 ? entry.epSum / entry.countSum : 0,
      });
    }
    const outRows = [];
    const byCond = new Map();
    for (const row of rows) {
      const list = byCond.get(row.condition) ?? [];
      list.push(row);
      byCond.set(row.condition, list);
    }
    for (const [condition, list] of byCond.entries()) {
      list.sort((a, b) => b.countMean - a.countMean);
      for (const row of list.slice(0, 10)) {
        outRows.push({ ...row, condition });
      }
    }
    const header = ["condition", "motifId", "countMean", "epPerMoveMean"];
    const lines = [header.join(",")];
    for (const row of outRows) {
      lines.push(header.map((key) => row[key]).join(","));
    }
    fs.writeFileSync(path.join(outDir, filename), lines.join("\n") + "\n");
  };

  emitTopMotifs(motifAggHazard, "top_p5_motifs_hazard.csv");
  emitTopMotifs(motifAggOutside, "top_p5_motifs_outside.csv");

  const summaryByCond = new Map(summaryRows.map((row) => [row.condition, row]));
  const bRow = summaryByCond.get("B_op_noKdrive");
  const cRow = summaryByCond.get("C_op_withKdrive");
  let verdict = "P5_ACTION_MOTIF_SIGNAL_TOO_WEAK";
  if (
    !bRow ||
    !cRow ||
    bRow.totalMovesHazardMean < 1000 ||
    cRow.totalMovesHazardMean < 1000
  ) {
    verdict = "P5_ACTIONS_TOO_SPARSE";
  } else if (
    bRow.coarseEPHazardMean >= 50 ||
    bRow.symmetryGapHazardMean >= 0.03 ||
    cRow.coarseEPHazardMean >= 50 ||
    cRow.symmetryGapHazardMean >= 0.03
  ) {
    verdict = "P5_ACTION_MOTIF_SIGNAL_PRESENT";
  }
  console.log(verdict);
}

function pickPreset() {
  const tuned = path.resolve(rootDir, "scripts/params/op_motifs_selection/selection_base_tuned.json");
  const preferred = path.resolve(rootDir, "scripts/params/clock_code/deadline_fidelity_found.json");
  const fallback = path.resolve(rootDir, "scripts/params/clock_code/code_deadline_gated_clock.json");
  if (fs.existsSync(tuned)) return tuned;
  if (fs.existsSync(preferred)) return preferred;
  return fallback;
}

function meanStd(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  return {
    mean: nums.length ? mean(nums) : null,
    std: nums.length ? std(nums) : null,
  };
}

function safeMean(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  return nums.length ? mean(nums) : null;
}

function addPairsToMap(target, pairs) {
  for (const [key, count] of pairs ?? []) {
    target.set(key, (target.get(key) ?? 0) + count);
  }
}

function pairsToMap(pairs) {
  const map = new Map();
  for (const [key, count] of pairs ?? []) {
    map.set(String(key), (map.get(key) ?? 0) + count);
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

function edgesFromCounts(counts, alpha = 0.5) {
  const edges = [];
  for (const [key, c] of counts.entries()) {
    const [i, j] = key.split("|");
    if (i === j) continue;
    const rev = counts.get(`${j}|${i}`) ?? 0;
    const netJ = c - rev;
    const c1 = c + alpha;
    const c2 = rev + alpha;
    const epEdge = (c1 - c2) * Math.log(c1 / c2);
    edges.push({ i, j, count_ij: c, count_ji: rev, netJ, epEdge });
  }
  return edges;
}

function entropyFromCounts(counts) {
  let total = 0;
  for (const v of counts.values()) total += v;
  if (total === 0) return 0;
  let h = 0;
  for (const v of counts.values()) {
    if (v <= 0) continue;
    const p = v / total;
    h += -p * Math.log(p);
  }
  return h;
}

function summarizeTransitions(counts) {
  const totalTrans = totalTransitions(counts);
  const coarseEP = coarseEPSmoothed(counts, 0.5);
  const asym = asymmetryScore(counts);
  const edges = edgesFromCounts(counts, 0.5);
  let topEdgeNetJ = 0;
  let topEdgeEP = 0;
  for (const edge of edges) {
    topEdgeNetJ = Math.max(topEdgeNetJ, Math.abs(edge.netJ));
    topEdgeEP = Math.max(topEdgeEP, Math.abs(edge.epEdge));
  }
  return {
    totalTrans,
    coarseEP,
    coarseEP_perTrans: totalTrans > 0 ? coarseEP / totalTrans : 0,
    asym_perTrans: asym,
    topEdgeNetJ,
    topEdgeEP,
    edges,
  };
}

function parseEdgeCsv(pathname) {
  if (!fs.existsSync(pathname)) return [];
  const raw = fs.readFileSync(pathname, "utf8").trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const header = lines[0].split(",");
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(",");
    const row = {};
    header.forEach((key, idx) => {
      row[key] = cols[idx];
    });
    rows.push(row);
  }
  return rows;
}

function aggregateEdgeRows(rows) {
  const agg = new Map();
  for (const row of rows) {
    const key = [row.condition, row.region, row.family, row.from, row.to].join("|");
    const prev = agg.get(key) ?? {
      condition: row.condition,
      region: row.region,
      family: row.family,
      from: row.from,
      to: row.to,
      count: 0,
      countRev: 0,
      epRepairSum: 0,
      epOpKSum: 0,
      epTotalSum: 0,
    };
    prev.count += Number(row.count ?? 0);
    prev.countRev += Number(row.countRev ?? 0);
    prev.epRepairSum += Number(row.epRepairSum ?? 0);
    prev.epOpKSum += Number(row.epOpKSum ?? 0);
    prev.epTotalSum += Number(row.epTotalSum ?? 0);
    agg.set(key, prev);
  }
  const out = [];
  for (const row of agg.values()) {
    out.push({
      ...row,
      epRepairPerTrans: row.count > 0 ? row.epRepairSum / row.count : 0,
      epOpKPerTrans: row.count > 0 ? row.epOpKSum / row.count : 0,
      epTotalPerTrans: row.count > 0 ? row.epTotalSum / row.count : 0,
    });
  }
  return out;
}

async function tuneDeadline({ presetPath, baseParams, baseDeadline, steps, reportEvery, eventEvery, opBinsMode, gateConditioned, gateCheckEvery }) {
  const targetMin = 0.05;
  const targetMax = 0.7;
  const seeds = [1, 2, 3];
  let deadline = baseDeadline;
  let missMean = null;
  let attempts = 0;
  while (attempts < 6) {
    const misses = [];
    for (const seed of seeds) {
      const result = await runDeadlineOpkMotifEvents({
        presetPath,
        seed,
        condition: "A",
        outDir: path.join(outDir, "tune"),
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
        gateConditioned,
        gateCheckEvery,
        sets: ["opCouplingOn=0", "sCouplingMode=0"],
      });
      misses.push(result.summary.missFrac);
    }
    missMean = mean(misses);
    if (missMean >= targetMin && missMean <= targetMax) break;
    if (missMean < targetMin) {
      deadline = Math.max(1_000, Math.floor(deadline * 0.7));
    } else if (missMean > targetMax) {
      deadline = Math.ceil(deadline * 1.3);
    }
    attempts += 1;
  }
  return { deadline, missMean, attempts };
}

const motifMode = process.argv.includes("--motifMode")
  ? process.argv[process.argv.indexOf("--motifMode") + 1]
  : "state";

const basis = process.argv.includes("--basis")
  ? process.argv[process.argv.indexOf("--basis") + 1]
  : "v2";
const opBinsMode = process.argv.includes("--opBinsMode")
  ? Number(process.argv[process.argv.indexOf("--opBinsMode") + 1])
  : 2;
const gateConditioned = process.argv.includes("--gateConditioned")
  ? Number(process.argv[process.argv.indexOf("--gateConditioned") + 1])
  : 1;
const gateCheckEvery = process.argv.includes("--gateCheckEvery")
  ? Number(process.argv[process.argv.indexOf("--gateCheckEvery") + 1])
  : 5000;

const presetPath = pickPreset();
if (motifMode === "p5_actions") {
  const seeds = parseSeedList(process.env.SEEDS ?? "1,2,3,4,5,6,7,8,9,10");
  const presetRaw = readJson(presetPath);
  await runP5ActionsCompare({
    presetPath,
    seeds,
    eventEvery: presetRaw.eventEvery ?? 50_000,
    deadline: presetRaw.deadline ?? 25_000,
  });
  process.exit(0);
}
if (motifMode === "move_edges") {
  const seeds = parseSeedList(process.env.SEEDS ?? "1,2,3,4,5,6,7,8,9,10");
  const presetRaw = readJson(presetPath);
  await runMoveEdgesCompare({
    presetPath,
    seeds,
    eventEvery: presetRaw.eventEvery ?? 50_000,
    deadline: presetRaw.deadline ?? 25_000,
  });
  process.exit(0);
}

outDir = outDirState;
ensureDir(outDir);
const presetRaw = readJson(presetPath);
const baseParams = presetRaw.params ?? presetRaw;
const baseDeadline = presetRaw.deadline ?? 25_000;
const steps = presetRaw.steps ?? 2_000_000;
const reportEvery = presetRaw.reportEvery ?? 5_000;
const eventEvery = presetRaw.eventEvery ?? 50_000;

const tuned = await tuneDeadline({
  presetPath,
  baseParams,
  baseDeadline,
  steps,
  reportEvery,
  eventEvery,
  opBinsMode,
  gateConditioned,
  gateCheckEvery,
});

const tunedPreset = {
  params: baseParams,
  deadline: tuned.deadline,
  sourcePreset: presetPath,
  notes: `auto-tuned deadline for missFrac band (attempts=${tuned.attempts}, missMean=${tuned.missMean})`,
};
const tunedDir = path.resolve(rootDir, "scripts/params/op_motifs_selection");
ensureDir(tunedDir);
const tunedPath = path.join(tunedDir, "selection_base_tuned.json");
fs.writeFileSync(tunedPath, JSON.stringify(tunedPreset, null, 2));

const seeds = parseSeedList(process.env.SEEDS ?? "1,2,3,4,5,6,7,8,9,10");
const conditions = [
  { id: "A_legacy", condition: "A", overrides: { opCouplingOn: 0, sCouplingMode: 0 } },
  { id: "B_op_noKdrive", condition: "B", overrides: { opCouplingOn: 1, sCouplingMode: 1, opDriveOnK: 0 } },
  { id: "C_op_withKdrive", condition: "C", overrides: { opCouplingOn: 1, sCouplingMode: 1, opDriveOnK: 1 } },
];

const condSummaries = [];
const eventConditionedRows = [];
const edgeRowsBase = [];
const edgeRowsOp = [];

for (const cond of conditions) {
  const runSummaries = [];
  const allEvents = [];
  const transBaseHaz = new Map();
  const transBaseOut = new Map();
  const transOpHaz = new Map();
  const transOpOut = new Map();

  for (const seed of seeds) {
    const result = await runDeadlineOpkMotifEvents({
      presetPath: tunedPath,
      seed,
      condition: cond.condition,
      outDir,
      steps,
      reportEvery,
      eventEvery,
      deadline: tuned.deadline,
      regionType: baseParams.repairGateMode === 1 ? "stripe" : "quadrant",
      regionIndex: 2,
      gateSpan: baseParams.repairGateSpan ?? 1,
      corruptFrac: 0.2,
      errGood: 0.1,
      sdiffGood: 1.0,
      tailWindow: 200_000,
      basis,
      opBinsMode,
      gateConditioned,
      gateCheckEvery,
      sets: Object.entries(cond.overrides).map(([k, v]) => `${k}=${v}`),
    });
    runSummaries.push(result.summary);
    allEvents.push(...result.events);
    addPairsToMap(transBaseHaz, result.summary.transitionsBaseHazard ?? []);
    addPairsToMap(transBaseOut, result.summary.transitionsBaseOutside ?? []);
    addPairsToMap(transOpHaz, result.summary.transitionsOpHazard ?? []);
    addPairsToMap(transOpOut, result.summary.transitionsOpOutside ?? []);

    const baseEdges = parseEdgeCsv(path.join(result.outDir, `transition_edges_Mbase_seed_${seed}.csv`));
    const opEdges = parseEdgeCsv(path.join(result.outDir, `transition_edges_Mop_seed_${seed}.csv`));
    edgeRowsBase.push(...baseEdges);
    edgeRowsOp.push(...opEdges);
  }

  const missFrac = meanStd(runSummaries.map((s) => s.missFrac));
  const uptimeTail = meanStd(runSummaries.map((s) => s.uptimeTail));
  const errTail = meanStd(runSummaries.map((s) => s.errTailMean));
  const epTotalRate = meanStd(runSummaries.map((s) => s.epTotalRate));
  const epRepairRate = meanStd(runSummaries.map((s) => s.epRepairRate));
  const epOpKRate = meanStd(runSummaries.map((s) => s.epOpKRate));
  const epClockRate = meanStd(runSummaries.map((s) => s.epClockRate));
  const repairRate = meanStd(runSummaries.map((s) => s.repairRate));
  const opKRate = meanStd(runSummaries.map((s) => s.opKRate));
  const hazardGateSamples = meanStd(runSummaries.map((s) => s.hazardGateSampleCount));
  const recoverySampleCounts = meanStd(runSummaries.map((s) => s.eventRecoveryWindowSampleCountMean));

  const hazardOpChangeFrac = meanStd(runSummaries.map((s) => s.hazardOpChangeFracMean));
  const hazardOpUnique = meanStd(runSummaries.map((s) => s.hazardOpUniqueStatesVisited));

  const hazardBaseH = meanStd(runSummaries.map((s) => s.hazardBase_H?.mean));
  const hazardBaseV = meanStd(runSummaries.map((s) => s.hazardBase_Veff?.mean));
  const hazardBaseTop = meanStd(runSummaries.map((s) => s.hazardBase_topMass10?.mean));
  const hazardBaseChange = meanStd(runSummaries.map((s) => s.hazardBase_changeFrac?.mean));
  const hazardBaseUnique = meanStd(runSummaries.map((s) => s.uniqueBaseHazard));

  const hazardOpH = meanStd(runSummaries.map((s) => s.hazardOp_H?.mean));
  const hazardOpV = meanStd(runSummaries.map((s) => s.hazardOp_Veff?.mean));
  const hazardOpTop = meanStd(runSummaries.map((s) => s.hazardOp_topMass10?.mean));
  const hazardOpChange = meanStd(runSummaries.map((s) => s.hazardOp_changeFrac?.mean));

  const baseHazTrans = summarizeTransitions(transBaseHaz);
  const baseOutTrans = summarizeTransitions(transBaseOut);
  const opHazTrans = summarizeTransitions(transOpHaz);
  const opOutTrans = summarizeTransitions(transOpOut);

  condSummaries.push({
    condition: cond.id,
    opBinsMode,
    gateConditioned,
    gateCheckEvery,
    seeds: seeds.length,
    missFracMean: missFrac.mean,
    missFracStd: missFrac.std,
    uptimeTailMean: uptimeTail.mean,
    uptimeTailStd: uptimeTail.std,
    errTailMean: errTail.mean,
    errTailStd: errTail.std,
    epTotalRateMean: epTotalRate.mean,
    epTotalRateStd: epTotalRate.std,
    epRepairRateMean: epRepairRate.mean,
    epRepairRateStd: epRepairRate.std,
    epOpKRateMean: epOpKRate.mean,
    epOpKRateStd: epOpKRate.std,
    epClockRateMean: epClockRate.mean,
    epClockRateStd: epClockRate.std,
    repairRateMean: repairRate.mean,
    repairRateStd: repairRate.std,
    opKRateMean: opKRate.mean,
    opKRateStd: opKRate.std,
    hazardGateSampleCountMean: hazardGateSamples.mean,
    hazardGateSampleCountStd: hazardGateSamples.std,
    eventRecoveryWindowSampleCountMean: recoverySampleCounts.mean,
    eventRecoveryWindowSampleCountStd: recoverySampleCounts.std,
    hazardOpUniqueStatesMean: hazardOpUnique.mean,
    hazardOpUniqueStatesStd: hazardOpUnique.std,
    hazardOpChangeFracMean: hazardOpChangeFrac.mean,
    hazardOpChangeFracStd: hazardOpChangeFrac.std,
    hazardBase_HMean: hazardBaseH.mean,
    hazardBase_HStd: hazardBaseH.std,
    hazardBase_VeffMean: hazardBaseV.mean,
    hazardBase_VeffStd: hazardBaseV.std,
    hazardBase_topMass10Mean: hazardBaseTop.mean,
    hazardBase_topMass10Std: hazardBaseTop.std,
    hazardBase_changeFracMean: hazardBaseChange.mean,
    hazardBase_changeFracStd: hazardBaseChange.std,
    hazardBase_uniqueStatesMean: hazardBaseUnique.mean,
    hazardBase_uniqueStatesStd: hazardBaseUnique.std,
    hazardOp_HMean: hazardOpH.mean,
    hazardOp_HStd: hazardOpH.std,
    hazardOp_VeffMean: hazardOpV.mean,
    hazardOp_VeffStd: hazardOpV.std,
    hazardOp_topMass10Mean: hazardOpTop.mean,
    hazardOp_topMass10Std: hazardOpTop.std,
    hazardOp_changeFracSampleMean: hazardOpChange.mean,
    hazardOp_changeFracSampleStd: hazardOpChange.std,
    hazardBase_totalTrans: baseHazTrans.totalTrans,
    hazardBase_coarseEP: baseHazTrans.coarseEP,
    hazardBase_coarseEP_perTrans: baseHazTrans.coarseEP_perTrans,
    hazardBase_asym_perTrans: baseHazTrans.asym_perTrans,
    hazardBase_topEdgeNetJ: baseHazTrans.topEdgeNetJ,
    hazardBase_topEdgeEP: baseHazTrans.topEdgeEP,
    outsideBase_totalTrans: baseOutTrans.totalTrans,
    outsideBase_coarseEP: baseOutTrans.coarseEP,
    outsideBase_coarseEP_perTrans: baseOutTrans.coarseEP_perTrans,
    outsideBase_asym_perTrans: baseOutTrans.asym_perTrans,
    hazardOp_totalTrans: opHazTrans.totalTrans,
    hazardOp_coarseEP: opHazTrans.coarseEP,
    hazardOp_coarseEP_perTrans: opHazTrans.coarseEP_perTrans,
    hazardOp_asym_perTrans: opHazTrans.asym_perTrans,
    hazardOp_topEdgeNetJ: opHazTrans.topEdgeNetJ,
    hazardOp_topEdgeEP: opHazTrans.topEdgeEP,
    outsideOp_totalTrans: opOutTrans.totalTrans,
    outsideOp_coarseEP: opOutTrans.coarseEP,
    outsideOp_coarseEP_perTrans: opOutTrans.coarseEP_perTrans,
    outsideOp_asym_perTrans: opOutTrans.asym_perTrans,
  });

  const windows = [
    { key: "pre", label: "pre" },
    { key: "rec", label: "recovery" },
    { key: "tail", label: "tail" },
  ];

  for (const win of windows) {
    const baseSuccCounts = new Map();
    const baseFailCounts = new Map();
    const opSuccCounts = new Map();
    const opFailCounts = new Map();
    const baseSuccStats = [];
    const baseFailStats = [];
    const opSuccStats = [];
    const opFailStats = [];
    const baseSuccChanges = [];
    const baseFailChanges = [];
    const opSuccChanges = [];
    const opFailChanges = [];
    const baseSuccUnique = [];
    const baseFailUnique = [];
    const opSuccUnique = [];
    const opFailUnique = [];
    const baseSuccCoarse = [];
    const baseFailCoarse = [];
    const opSuccCoarse = [];
    const opFailCoarse = [];
    const baseSuccCoarsePer = [];
    const baseFailCoarsePer = [];
    const opSuccCoarsePer = [];
    const opFailCoarsePer = [];
    const baseSuccAsymPer = [];
    const baseFailAsymPer = [];
    const opSuccAsymPer = [];
    const opFailAsymPer = [];
    const baseSuccEpTotal = [];
    const baseFailEpTotal = [];
    const baseSuccEpRepair = [];
    const baseFailEpRepair = [];
    const opSuccEpOpK = [];
    const opFailEpOpK = [];
    const sampleCounts = [];

    for (const event of allEvents) {
      const baseCountsKey = `${win.key}BaseHaz_counts`;
      const opCountsKey = `${win.key}OpHaz_counts`;
      const baseTransKey = `${win.key}BaseHaz_trans`;
      const opTransKey = `${win.key}OpHaz_trans`;
      const baseCountPairs = event[baseCountsKey] ?? [];
      const opCountPairs = event[opCountsKey] ?? [];
      const baseTransPairs = event[baseTransKey] ?? [];
      const opTransPairs = event[opTransKey] ?? [];
      const baseCounts = pairsToMap(baseCountPairs);
      const opCounts = pairsToMap(opCountPairs);
      const baseTrans = pairsToMap(baseTransPairs);
      const opTrans = pairsToMap(opTransPairs);
      const baseH = entropyFromCounts(baseCounts);
      const opH = entropyFromCounts(opCounts);
      const baseTransTotal = totalTransitions(baseTrans);
      const opTransTotal = totalTransitions(opTrans);
      const baseCoarse = coarseEPSmoothed(baseTrans, 0.5);
      const opCoarse = coarseEPSmoothed(opTrans, 0.5);
      const baseAsym = asymmetryScore(baseTrans);
      const opAsym = asymmetryScore(opTrans);
      const baseCoarsePer = baseTransTotal > 0 ? baseCoarse / baseTransTotal : 0;
      const opCoarsePer = opTransTotal > 0 ? opCoarse / opTransTotal : 0;

      const baseChangeCount = event[`${win.key}_baseChangeCount`] ?? 0;
      const baseChangeTotal = event[`${win.key}_baseChangeTotal`] ?? 0;
      const opChangeCount = event[`${win.key}_opChangeCount`] ?? 0;
      const opChangeTotal = event[`${win.key}_opChangeTotal`] ?? 0;
      const baseChangeFrac = baseChangeTotal > 0 ? baseChangeCount / baseChangeTotal : 0;
      const opChangeFrac = opChangeTotal > 0 ? opChangeCount / opChangeTotal : 0;

      const epTotal = event[`${win.key}_epTotal`] ?? 0;
      const epRepair = event[`${win.key}_epRepair`] ?? 0;
      const epOpK = event[`${win.key}_epOpK`] ?? 0;

      const baseEpTotalPer = baseChangeCount > 0 ? epTotal / baseChangeCount : 0;
      const baseEpRepairPer = baseChangeCount > 0 ? epRepair / baseChangeCount : 0;
      const opEpOpKPer = opChangeCount > 0 ? epOpK / opChangeCount : 0;

      const targetBaseCounts = event.success ? baseSuccCounts : baseFailCounts;
      const targetOpCounts = event.success ? opSuccCounts : opFailCounts;
      for (const [key, count] of baseCounts.entries()) {
        targetBaseCounts.set(key, (targetBaseCounts.get(key) ?? 0) + count);
      }
      for (const [key, count] of opCounts.entries()) {
        targetOpCounts.set(key, (targetOpCounts.get(key) ?? 0) + count);
      }

      if (event.success) {
        baseSuccStats.push(baseH);
        opSuccStats.push(opH);
        baseSuccChanges.push(baseChangeFrac);
        opSuccChanges.push(opChangeFrac);
        baseSuccUnique.push(baseCounts.size);
        opSuccUnique.push(opCounts.size);
        baseSuccCoarse.push(baseCoarse);
        opSuccCoarse.push(opCoarse);
        baseSuccCoarsePer.push(baseCoarsePer);
        opSuccCoarsePer.push(opCoarsePer);
        baseSuccAsymPer.push(baseAsym);
        opSuccAsymPer.push(opAsym);
        baseSuccEpTotal.push(baseEpTotalPer);
        baseSuccEpRepair.push(baseEpRepairPer);
        opSuccEpOpK.push(opEpOpKPer);
      } else {
        baseFailStats.push(baseH);
        opFailStats.push(opH);
        baseFailChanges.push(baseChangeFrac);
        opFailChanges.push(opChangeFrac);
        baseFailUnique.push(baseCounts.size);
        opFailUnique.push(opCounts.size);
        baseFailCoarse.push(baseCoarse);
        opFailCoarse.push(opCoarse);
        baseFailCoarsePer.push(baseCoarsePer);
        opFailCoarsePer.push(opCoarsePer);
        baseFailAsymPer.push(baseAsym);
        opFailAsymPer.push(opAsym);
        baseFailEpTotal.push(baseEpTotalPer);
        baseFailEpRepair.push(baseEpRepairPer);
        opFailEpOpK.push(opEpOpKPer);
      }

      if (win.key === "rec") {
        sampleCounts.push(event.rec_samples ?? 0);
      }
    }

    const baseJs = jsDivergence(baseSuccCounts, baseFailCounts);
    const opJs = jsDivergence(opSuccCounts, opFailCounts);
    const recoverySampleMean = sampleCounts.length ? mean(sampleCounts) : 0;

    eventConditionedRows.push({
      condition: cond.id,
      opBinsMode,
      region: "hazard",
      family: "M_base",
      window: win.label,
      H_succ: safeMean(baseSuccStats),
      H_fail: safeMean(baseFailStats),
      H_delta: safeMean(baseSuccStats) - safeMean(baseFailStats),
      js_divergence: baseJs,
      coarseEP_succ: safeMean(baseSuccCoarse),
      coarseEP_fail: safeMean(baseFailCoarse),
      coarseEP_perTrans_succ: safeMean(baseSuccCoarsePer),
      coarseEP_perTrans_fail: safeMean(baseFailCoarsePer),
      asym_perTrans_succ: safeMean(baseSuccAsymPer),
      asym_perTrans_fail: safeMean(baseFailAsymPer),
      changeFrac_succ: safeMean(baseSuccChanges),
      changeFrac_fail: safeMean(baseFailChanges),
      uniqueStatesVisited_succ: safeMean(baseSuccUnique),
      uniqueStatesVisited_fail: safeMean(baseFailUnique),
      epTotalPerChange_succ: safeMean(baseSuccEpTotal),
      epTotalPerChange_fail: safeMean(baseFailEpTotal),
      epRepairPerChange_succ: safeMean(baseSuccEpRepair),
      epRepairPerChange_fail: safeMean(baseFailEpRepair),
      epOpKPerChange_succ: null,
      epOpKPerChange_fail: null,
      recoverySampleCountMean: recoverySampleMean,
    });

    eventConditionedRows.push({
      condition: cond.id,
      opBinsMode,
      region: "hazard",
      family: "M_op",
      window: win.label,
      H_succ: safeMean(opSuccStats),
      H_fail: safeMean(opFailStats),
      H_delta: safeMean(opSuccStats) - safeMean(opFailStats),
      js_divergence: opJs,
      coarseEP_succ: safeMean(opSuccCoarse),
      coarseEP_fail: safeMean(opFailCoarse),
      coarseEP_perTrans_succ: safeMean(opSuccCoarsePer),
      coarseEP_perTrans_fail: safeMean(opFailCoarsePer),
      asym_perTrans_succ: safeMean(opSuccAsymPer),
      asym_perTrans_fail: safeMean(opFailAsymPer),
      changeFrac_succ: safeMean(opSuccChanges),
      changeFrac_fail: safeMean(opFailChanges),
      uniqueStatesVisited_succ: safeMean(opSuccUnique),
      uniqueStatesVisited_fail: safeMean(opFailUnique),
      epTotalPerChange_succ: null,
      epTotalPerChange_fail: null,
      epRepairPerChange_succ: null,
      epRepairPerChange_fail: null,
      epOpKPerChange_succ: safeMean(opSuccEpOpK),
      epOpKPerChange_fail: safeMean(opFailEpOpK),
      recoverySampleCountMean: recoverySampleMean,
    });
  }
}

ensureDir(outDir);
const condHeader = Object.keys(condSummaries[0] ?? {}).join(",");
const condLines = [condHeader];
for (const row of condSummaries) {
  condLines.push(Object.values(row).join(","));
}
fs.writeFileSync(path.join(outDir, "compare_summary.csv"), condLines.join("\n") + "\n");

const eventHeader = Object.keys(eventConditionedRows[0] ?? {}).join(",");
const eventLines = [eventHeader];
for (const row of eventConditionedRows) {
  eventLines.push(Object.values(row).join(","));
}
fs.writeFileSync(path.join(outDir, "event_conditioned_summary.csv"), eventLines.join("\n") + "\n");

const edgeHeader =
  "condition,seed,region,family,from,to,count,countRev,epRepairSum,epOpKSum,epTotalSum,epRepairPerTrans,epOpKPerTrans,epTotalPerTrans";
const baseAllLines = [edgeHeader];
for (const row of edgeRowsBase) {
  baseAllLines.push(
    [
      row.condition,
      row.seed,
      row.region,
      row.family,
      row.from,
      row.to,
      row.count,
      row.countRev,
      row.epRepairSum,
      row.epOpKSum,
      row.epTotalSum,
      row.epRepairPerTrans,
      row.epOpKPerTrans,
      row.epTotalPerTrans,
    ].join(","),
  );
}
fs.writeFileSync(path.join(outDir, "transition_edges_Mbase_all.csv"), baseAllLines.join("\n") + "\n");

const opAllLines = [edgeHeader];
for (const row of edgeRowsOp) {
  opAllLines.push(
    [
      row.condition,
      row.seed,
      row.region,
      row.family,
      row.from,
      row.to,
      row.count,
      row.countRev,
      row.epRepairSum,
      row.epOpKSum,
      row.epTotalSum,
      row.epRepairPerTrans,
      row.epOpKPerTrans,
      row.epTotalPerTrans,
    ].join(","),
  );
}
fs.writeFileSync(path.join(outDir, "transition_edges_Mop_all.csv"), opAllLines.join("\n") + "\n");

const baseAgg = aggregateEdgeRows(edgeRowsBase);
const opAgg = aggregateEdgeRows(edgeRowsOp);
const baseTop = baseAgg.slice().sort((a, b) => b.count - a.count).slice(0, 50);
const opTop = opAgg.slice().sort((a, b) => b.count - a.count).slice(0, 50);
const topHeader =
  "condition,region,family,from,to,count,countRev,epRepairSum,epOpKSum,epTotalSum,epRepairPerTrans,epOpKPerTrans,epTotalPerTrans";
const baseTopLines = [topHeader];
for (const row of baseTop) {
  baseTopLines.push(
    [
      row.condition,
      row.region,
      row.family,
      row.from,
      row.to,
      row.count,
      row.countRev,
      row.epRepairSum,
      row.epOpKSum,
      row.epTotalSum,
      row.epRepairPerTrans,
      row.epOpKPerTrans,
      row.epTotalPerTrans,
    ].join(","),
  );
}
fs.writeFileSync(path.join(outDir, "transition_edges_Mbase_top.csv"), baseTopLines.join("\n") + "\n");

const opTopLines = [topHeader];
for (const row of opTop) {
  opTopLines.push(
    [
      row.condition,
      row.region,
      row.family,
      row.from,
      row.to,
      row.count,
      row.countRev,
      row.epRepairSum,
      row.epOpKSum,
      row.epTotalSum,
      row.epRepairPerTrans,
      row.epOpKPerTrans,
      row.epTotalPerTrans,
    ].join(","),
  );
}
fs.writeFileSync(path.join(outDir, "transition_edges_Mop_top.csv"), opTopLines.join("\n") + "\n");

console.log(`tuned deadline: ${tuned.deadline} (missFracMean=${tuned.missMean})`);
console.log(`compare summary written: ${path.join(outDir, "compare_summary.csv")}`);
console.log(`event-conditioned written: ${path.join(outDir, "event_conditioned_summary.csv")}`);

const rowA = condSummaries.find((row) => row.condition === "A_legacy");
const rowB = condSummaries.find((row) => row.condition === "B_op_noKdrive");
const rowC = condSummaries.find((row) => row.condition === "C_op_withKdrive");
const ok =
  (rowB?.hazardOpUniqueStatesMean ?? 0) >= 10 &&
  (rowB?.eventRecoveryWindowSampleCountMean ?? 0) >= 1 &&
  (rowB?.hazardOpChangeFracMean ?? 0) >= 0.01 &&
  (rowC?.hazardOpUniqueStatesMean ?? 0) >= 10 &&
  (rowC?.eventRecoveryWindowSampleCountMean ?? 0) >= 1 &&
  (rowC?.hazardOpChangeFracMean ?? 0) >= 0.01;

if (ok) console.log("MOTIF_SIGNAL_PLAUSIBLE");
else console.log("MOTIF_INSTRUMENTATION_TOO_SPARSE");
