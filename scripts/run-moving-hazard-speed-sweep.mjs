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

const seeds = [1, 2, 3, 4, 5];
const hazardHoldEventsList = [1, 2, 4, 8, 16];

const baseConfig = {
  presetPath,
  seeds,
  steps: 1_000_000,
  eventEvery: 50_000,
  deadline: 15_000,
  reportEvery: 1_000,
  hazardCount: 8,
  region: "stripe",
  logMotifs: true,
  variants: ["A", "C"],
  writeOutputs: false,
};

const rows = [];
for (const hold of hazardHoldEventsList) {
  const res = await runMovingHazardHomeostasis({
    ...baseConfig,
    hazardHoldEvents: hold,
  });
  for (const row of res.summaryRows) {
    rows.push({
      hazardHoldEvents: hold,
      variant: row.variant,
      missFrac: row.missFrac,
      uptimeTailMean: row.uptimeTailMean,
      recoveryP95: row.recoveryP95,
      epTotalRateMean: row.epTotalRateMean,
      epRepairPerActionMean: row.epRepairPerActionMean,
      avgPairwiseJSD: row.avgPairwiseJSD,
      mutualInfoHM: row.mutualInfoHM,
    });
  }
}

const header = [
  "variant",
  "hazardHoldEvents",
  "missFrac",
  "uptimeTailMean",
  "recoveryP95",
  "epTotalRateMean",
  "epRepairPerActionMean",
  "avgPairwiseJSD",
  "mutualInfoHM",
].join(",");
const lines = [header];
for (const row of rows) {
  lines.push(
    [
      row.variant,
      row.hazardHoldEvents,
      row.missFrac,
      row.uptimeTailMean,
      row.recoveryP95,
      row.epTotalRateMean,
      row.epRepairPerActionMean,
      row.avgPairwiseJSD,
      row.mutualInfoHM,
    ].join(","),
  );
}

const outPath = path.join(outDir, "finishing_speed_sweep.csv");
fs.writeFileSync(outPath, lines.join("\n") + "\n");

const pickBest = (variantRows) => {
  if (!variantRows.length) return null;
  let best = variantRows[0];
  for (const row of variantRows.slice(1)) {
    if (row.missFrac < best.missFrac) {
      best = row;
    } else if (row.missFrac === best.missFrac) {
      if (row.uptimeTailMean > best.uptimeTailMean) {
        best = row;
      } else if (row.uptimeTailMean === best.uptimeTailMean) {
        if (row.epTotalRateMean < best.epTotalRateMean) best = row;
      }
    }
  }
  return best;
};

const rowsA = rows.filter((r) => r.variant === "A");
const rowsC = rows.filter((r) => r.variant === "C");
const bestA = pickBest(rowsA);
const bestC = pickBest(rowsC);

const bestLine = [
  `BEST_SPEED_A=${bestA ? bestA.hazardHoldEvents : "na"}`,
  `BEST_SPEED_C=${bestC ? bestC.hazardHoldEvents : "na"}`,
].join(" ");
console.log(bestLine);
