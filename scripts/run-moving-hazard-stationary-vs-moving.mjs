#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { runMovingHazardHomeostasis } from "./run-moving-hazard-homeostasis.mjs";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.resolve(rootDir, ".tmp", "homeostasis");
fs.mkdirSync(outDir, { recursive: true });

const presetPathCandidates = [
  path.resolve(rootDir, "scripts/params/clock_code/deadline_fidelity_found.json"),
  path.resolve(rootDir, "scripts/params/clock_code/code_deadline_gated_clock.json"),
];
const presetPath = presetPathCandidates.find((p) => fs.existsSync(p)) ?? presetPathCandidates[1];

const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const baseConfig = {
  presetPath,
  seeds,
  steps: 2_000_000,
  eventEvery: 50_000,
  deadline: 15_000,
  reportEvery: 1_000,
  hazardHoldEvents: 4,
  region: "stripe",
  logMotifs: true,
  variants: ["A", "C"],
};

const stationary = await runMovingHazardHomeostasis({
  ...baseConfig,
  hazardCount: 1,
  writeOutputs: false,
});

const moving = await runMovingHazardHomeostasis({
  ...baseConfig,
  hazardCount: 8,
  writeOutputs: false,
});

const pickRows = (res) => res.summaryRows.map((row) => ({ ...row }));

const rows = [];
for (const row of pickRows(stationary)) {
  rows.push({ ...row, scenario: "stationary" });
}
for (const row of pickRows(moving)) {
  rows.push({ ...row, scenario: "moving" });
}

const header = [
  "variant",
  "scenario",
  "missFrac",
  "uptimeTailMean",
  "errTailMean",
  "recoveryP95",
  "epTotalRateMean",
  "epRepairPerActionMean",
  "motifEntropyMean",
  "motifSymmetryGapMean",
  "avgPairwiseJSD",
  "mutualInfoHM",
].join(",");

const lines = [header];
for (const row of rows) {
  lines.push(
    [
      row.variant,
      row.scenario,
      row.missFrac,
      row.uptimeTailMean,
      row.errTailMean,
      row.recoveryP95,
      row.epTotalRateMean,
      row.epRepairPerActionMean,
      row.motifEntropyMean,
      row.motifSymmetryGapMean,
      row.avgPairwiseJSD,
      row.mutualInfoHM,
    ].join(","),
  );
}

const outPath = path.join(outDir, "finishing_stationary_vs_moving.csv");
fs.writeFileSync(outPath, lines.join("\n") + "\n");

const byVariant = new Map();
for (const row of rows) {
  const list = byVariant.get(row.variant) ?? [];
  list.push(row);
  byVariant.set(row.variant, list);
}

for (const [variant, list] of byVariant.entries()) {
  const stationaryRow = list.find((r) => r.scenario === "stationary");
  const movingRow = list.find((r) => r.scenario === "moving");
  if (!stationaryRow || !movingRow) continue;
  const deltaMiss = movingRow.missFrac - stationaryRow.missFrac;
  const deltaJSD = (movingRow.avgPairwiseJSD ?? 0) - (stationaryRow.avgPairwiseJSD ?? 0);
  const deltaMI = (movingRow.mutualInfoHM ?? 0) - (stationaryRow.mutualInfoHM ?? 0);
  const deltaEP = (movingRow.epRepairPerActionMean ?? 0) - (stationaryRow.epRepairPerActionMean ?? 0);
  console.log(
    `${variant} Δ(moving-stationary): miss=${deltaMiss.toFixed(4)} JSD=${deltaJSD.toFixed(4)} MI=${deltaMI.toFixed(4)} epPerAction=${deltaEP.toFixed(6)}`,
  );
}
