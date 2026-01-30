#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const runner = path.resolve(rootDir, "scripts/run-opk-motif-language.mjs");
const baseOut = path.resolve(rootDir, ".tmp/op_motifs");

const common = [
  "--set",
  "gridSize=32",
  "--set",
  "metaLayers=2",
  "--set",
  "opCouplingOn=1",
  "--set",
  "sCouplingMode=1",
  "--set",
  "opStencil=1",
  "--set",
  "opBudgetK=16",
  "--set",
  "pWrite=0",
  "--set",
  "pNWrite=0",
  "--set",
  "pAWrite=0",
  "--set",
  "pSWrite=0.5",
  "--set",
  "initRandom=1",
];

const regimes = [
  {
    id: "R0_null",
    sets: [
      "--set",
      "p6On=0",
      "--set",
      "p3On=0",
      "--set",
      "eta=0",
      "--set",
      "etaDrive=0",
      "--set",
      "opDriveOnK=0",
    ],
  },
  {
    id: "R1_drive_noK",
    sets: [
      "--set",
      "p6On=1",
      "--set",
      "muHigh=1.0",
      "--set",
      "muLow=1.0",
      "--set",
      "eta=0",
      "--set",
      "etaDrive=0.8",
      "--set",
      "opDriveOnK=0",
    ],
  },
  {
    id: "R2_drive_withK",
    sets: [
      "--set",
      "p6On=1",
      "--set",
      "muHigh=1.0",
      "--set",
      "muLow=1.0",
      "--set",
      "eta=0",
      "--set",
      "etaDrive=0.8",
      "--set",
      "opDriveOnK=1",
    ],
  },
];

for (const regime of regimes) {
  const outDir = path.join(baseOut, regime.id);
  const args = [
    runner,
    "--outDir",
    outDir,
    "--seed",
    "1",
    "--burnIn",
    "200000",
    "--stepsMain",
    "1000000",
    ...common,
    ...regime.sets,
  ];
  const result = spawnSync("node", args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
