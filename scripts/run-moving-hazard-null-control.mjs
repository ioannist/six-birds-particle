#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { runMovingHazardHomeostasis } from "./run-moving-hazard-homeostasis.mjs";

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.resolve(rootDir, ".tmp", "homeostasis");
fs.mkdirSync(outDir, { recursive: true });

const presetPathCandidates = [
  path.resolve(rootDir, "scripts/params/clock_code/deadline_fidelity_found.json"),
  path.resolve(rootDir, "scripts/params/clock_code/code_deadline_gated_clock.json"),
];
const presetPath = presetPathCandidates.find((p) => fs.existsSync(p)) ?? presetPathCandidates[1];

const baseConfig = {
  presetPath,
  seeds: [1, 2, 3, 4, 5],
  steps: 1_000_000,
  eventEvery: 50_000,
  deadline: 15_000,
  reportEvery: 1_000,
  hazardHoldEvents: 4,
  hazardCount: 8,
  region: "stripe",
  logMotifs: true,
  variants: ["C"],
  writeOutputs: false,
};

const driven = await runMovingHazardHomeostasis({
  ...baseConfig,
});

const nullish = await runMovingHazardHomeostasis({
  ...baseConfig,
  commonOverrides: { p6On: 0, etaDrive: 0, p3On: 0 },
});

const pickSummary = (res) => res.summaryRows.find((row) => row.variant === "C");
const pickRows = (res) => res.rawRows.filter((row) => row.variant === "C");
const drivenRow = pickSummary(driven);
const nullRow = pickSummary(nullish);
const drivenRows = pickRows(driven);
const nullRows = pickRows(nullish);

const header = [
  "condition",
  "missFrac",
  "motifEntropyMean",
  "motifSymmetryGapMean",
  "motifCoarseEPMean",
  "epTotalRate",
  "epRepairMean",
  "epOpKMean",
  "epClockMean",
].join(",");
const lines = [header];

const addLine = (label, row) => {
  const epTotalRate = row ? row.epTotalRateMean : null;
  lines.push(
    [
      label,
      row?.missFrac ?? null,
      row?.motifEntropyMean ?? null,
      row?.motifSymmetryGapMean ?? null,
      row?.motifCoarseEPMean ?? null,
      epTotalRate,
      row?.epRepairMean ?? null,
      row?.epOpKMean ?? null,
      row?.epClockMean ?? null,
    ].join(","),
  );
};

addLine("driven", drivenRow);
addLine("null", nullRow);

const outPath = path.join(outDir, "moving_hazard_null_control.csv");
fs.writeFileSync(outPath, lines.join("\n") + "\n");

const finishingHeader = [
  "condition",
  "epTotalRate",
  "epRepairMean",
  "epRepairPerActionMean",
  "repairActionCountMean",
].join(",");
const finishingLines = [finishingHeader];

const addFinishing = (label, summaryRow, rows) => {
  const repairCounts = rows.map((r) => r.repairCount ?? 0);
  finishingLines.push(
    [
      label,
      summaryRow?.epTotalRateMean ?? null,
      summaryRow?.epRepairMean ?? null,
      summaryRow?.epRepairPerActionMean ?? null,
      mean(repairCounts),
    ].join(","),
  );
};

addFinishing("driven", drivenRow, drivenRows);
addFinishing("null", nullRow, nullRows);

const finishingPath = path.join(outDir, "finishing_null_control_ep_per_action.csv");
fs.writeFileSync(finishingPath, finishingLines.join("\n") + "\n");

const deltaSym = (drivenRow?.motifSymmetryGapMean ?? 0) - (nullRow?.motifSymmetryGapMean ?? 0);
const deltaCoarse = (drivenRow?.motifCoarseEPMean ?? 0) - (nullRow?.motifCoarseEPMean ?? 0);
const deltaEp = (drivenRow?.epTotalRateMean ?? 0) - (nullRow?.epTotalRateMean ?? 0);

console.log(
  `Driven vs Null: ΔsymmetryGap=${deltaSym.toFixed(4)} ΔcoarseEP=${deltaCoarse.toFixed(4)} ΔepTotalRate=${deltaEp.toFixed(4)}`,
);
