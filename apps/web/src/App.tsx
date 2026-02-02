console.log("[DEBUG] App.tsx start");
import React, { useCallback, useEffect, useRef, useState } from "react";
import { SimWorkerClient } from "./sim/workerClient";
import {
  addSnapshot,
  attachToWindow,
  exportRun,
  setCaptureEverySteps,
  startRun,
} from "./sim/runCache";
import { SNAPSHOT_VERSION } from "./sim/workerMessages";
import type { Diagnostics, EnergyBreakdown, SimParams, SimSnapshot } from "./sim/workerMessages";
import { PRESET_CATALOG, type PresetEntry } from "./sim/presetCatalog";
import {
  drawEvidenceOverlays,
  type EvidenceEnv,
  type EvidenceOverlayTarget,
  drawLifeHud,
  type LifeHudState,
  drawInjuryMapOverlay,
} from "./overlays/evidenceOverlays";
console.log("[DEBUG] imports done");

const SETTINGS_KEY = "six-birds-settings";

interface SavedSettings {
  n: number;
  seed: number;
  bondThreshold: number;
  bondsMode: "live" | "chart" | "off";
  graphStatsMode: "auto" | "ondemand" | "off";
  stackMaxLayers: number;
  historyCap: number;
  recordEverySteps: number;
  p1Enabled: boolean;
  p2Enabled: boolean;
  p3Enabled: boolean;
  p4Enabled: boolean;
  p5Enabled: boolean;
  p6Enabled: boolean;
  safeThreshold: number;
  colorSource: "none" | "p4" | "p2";
  overlayChannel: "none" | "baseS" | "metaS" | "metaN" | "metaA" | "metaW";
  presetId: string;
  evidenceOverlaysOn: boolean;
  injuryMapOn: boolean;
  lifeHudOn: boolean;
}

function loadSettings(): Partial<SavedSettings> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // ignore parse errors
  }
  return {};
}

function saveSettings(settings: SavedSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage errors
  }
}

function clearSettings(): void {
  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch {
    // ignore
  }
}

// Create worker as module-level singleton to avoid React StrictMode double-creation
let sharedClient: SimWorkerClient | null = null;
function getClient(): SimWorkerClient {
  if (!sharedClient) {
    sharedClient = new SimWorkerClient();
  }
  return sharedClient;
}

function drawFrame(
  canvas: HTMLCanvasElement,
  positions: Float32Array,
  bonds: Uint32Array,
  counters?: Int16Array | Uint16Array,
  field?: ArrayLike<number>,
  fieldMax?: number
) {
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const size = Math.min(canvas.clientWidth, canvas.clientHeight);
  const px = Math.max(1, Math.floor(size * dpr));
  if (canvas.width !== px || canvas.height !== px) {
    canvas.width = px;
    canvas.height = px;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Bonds (P1) underlay: draw exactly the bonds returned by the simulation.
  ctx.lineWidth = Math.max(1, Math.floor(1 * dpr));
  ctx.strokeStyle = "rgba(160, 190, 255, 0.22)";
  ctx.beginPath();
  for (let k = 0; k < bonds.length; k += 2) {
    const i = bonds[k]!;
    const j = bonds[k + 1]!;
    let dx = positions[2 * i]! - positions[2 * j]!;
    let dy = positions[2 * i + 1]! - positions[2 * j + 1]!;
    let shiftX = 0;
    let shiftY = 0;
    if (dx > 0.5) {
      dx -= 1.0;
      shiftX = 1;
    } else if (dx < -0.5) {
      dx += 1.0;
      shiftX = -1;
    }
    if (dy > 0.5) {
      dy -= 1.0;
      shiftY = 1;
    } else if (dy < -0.5) {
      dy += 1.0;
      shiftY = -1;
    }
    const xi = positions[2 * i]!;
    const yi = positions[2 * i + 1]!;
    const xj = positions[2 * j]!;
    const yj = positions[2 * j + 1]!;
    // Draw the shortest wrapped segment (may extend outside canvas).
    ctx.moveTo(xi * canvas.width, yi * canvas.height);
    ctx.lineTo((xj + shiftX) * canvas.width, (yj + shiftY) * canvas.height);
    // If wrapped, also draw the complementary segment on the opposite side.
    if (shiftX !== 0 || shiftY !== 0) {
      ctx.moveTo((xi - shiftX) * canvas.width, (yi - shiftY) * canvas.height);
      ctx.lineTo(xj * canvas.width, yj * canvas.height);
    }
  }
  ctx.stroke();

  if (field && field.length > 0) {
    const g = Math.round(Math.sqrt(field.length));
    if (g * g === field.length) {
      const max = Math.max(1, fieldMax ?? 1);
      const cellW = canvas.width / g;
      const cellH = canvas.height / g;
      for (let y = 0; y < g; y++) {
        for (let x = 0; x < g; x++) {
          const idx = y * g + x;
          const v = field[idx] ?? 0;
          if (v === 0) continue;
          const t = Math.min(1, v / max);
          ctx.fillStyle = `rgba(120, 200, 120, ${0.08 + 0.22 * t})`;
          ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
        }
      }
    }
  }

  const r = Math.max(2, Math.floor(2 * dpr));
  let maxAbs = 0;
  if (counters && counters.length > 0) {
    for (let i = 0; i < counters.length; i++) {
      const v = Math.abs(Number(counters[i]!));
      if (v > maxAbs) maxAbs = v;
    }
  }
  const hasCounters = counters && counters.length * 2 === positions.length && maxAbs > 0;
  const negColor = [90, 160, 255];
  const zeroColor = [210, 225, 255];
  const posColor = [255, 150, 100];
  const overlayIsUnsigned = counters instanceof Uint16Array;

  for (let i = 0; i < positions.length; i += 2) {
    const x = positions[i] * canvas.width;
    const y = positions[i + 1] * canvas.height;
    if (hasCounters && counters) {
      const n = Number(counters[i / 2]!);
      const t = Math.max(-1, Math.min(1, n / maxAbs));
      let rC = zeroColor[0]!;
      let gC = zeroColor[1]!;
      let bC = zeroColor[2]!;
      if (overlayIsUnsigned || t >= 0) {
        const k = Math.abs(t);
        rC = Math.round(zeroColor[0]! * (1 - k) + posColor[0]! * k);
        gC = Math.round(zeroColor[1]! * (1 - k) + posColor[1]! * k);
        bC = Math.round(zeroColor[2]! * (1 - k) + posColor[2]! * k);
      } else if (t < 0) {
        const k = -t;
        rC = Math.round(zeroColor[0]! * (1 - k) + negColor[0]! * k);
        gC = Math.round(zeroColor[1]! * (1 - k) + negColor[1]! * k);
        bC = Math.round(zeroColor[2]! * (1 - k) + negColor[2]! * k);
      }
      ctx.fillStyle = `rgba(${rC}, ${gC}, ${bC}, 0.9)`;
    } else {
      ctx.fillStyle = "rgba(106, 169, 255, 0.85)";
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function normalizeUnsignedField(source: Uint16Array, denom: number): Float32Array {
  const d = Math.max(1, denom);
  const out = new Float32Array(source.length);
  for (let i = 0; i < source.length; i++) {
    out[i] = source[i]! / d;
  }
  return out;
}

function normalizeSignedField(source: Int16Array, denom: number): Float32Array {
  const d = Math.max(1, denom);
  const out = new Float32Array(source.length);
  for (let i = 0; i < source.length; i++) {
    out[i] = (source[i]! + d) / (2 * d);
  }
  return out;
}

function metaWEdgesToCells(source: Uint8Array, grid: number): Float32Array {
  const cells = grid * grid;
  const out = new Float32Array(cells);
  for (let y = 0; y < grid; y++) {
    const upY = (y + grid - 1) % grid;
    for (let x = 0; x < grid; x++) {
      const leftX = (x + grid - 1) % grid;
      const q = y * grid + x;
      const left = y * grid + leftX;
      const up = upY * grid + x;
      const h0 = source[q] ?? 0;
      const h1 = source[left] ?? 0;
      const v0 = source[cells + q] ?? 0;
      const v1 = source[cells + up] ?? 0;
      out[q] = (h0 + h1 + v0 + v1) / 4;
    }
  }
  return out;
}

function drawFieldHeatmap(
  canvas: HTMLCanvasElement,
  field: Uint8Array,
  grid: number,
  maxValue: number
) {
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, w, h);
  const cells = grid * grid;
  if (grid <= 0 || field.length < cells) return;
  const max = Math.max(1, maxValue);
  const cellW = w / grid;
  const cellH = h / grid;
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const idx = y * grid + x;
      const v = field[idx] ?? 0;
      if (v === 0) continue;
      const t = Math.min(1, v / max);
      ctx.fillStyle = `rgba(120, 200, 120, ${0.08 + 0.4 * t})`;
      ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
    }
  }
}

function drawFieldAbsDiffHeatmap(
  canvas: HTMLCanvasElement,
  fieldA: Uint8Array,
  fieldB: Uint8Array,
  grid: number,
  maxValue: number
) {
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, w, h);
  const cells = grid * grid;
  if (grid <= 0 || fieldA.length < cells || fieldB.length < cells) return;
  const max = Math.max(1, maxValue);
  const cellW = w / grid;
  const cellH = h / grid;
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const idx = y * grid + x;
      const v = Math.abs((fieldA[idx] ?? 0) - (fieldB[idx] ?? 0));
      if (v === 0) continue;
      const t = Math.min(1, v / max);
      ctx.fillStyle = `rgba(255, 140, 120, ${0.08 + 0.5 * t})`;
      ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
    }
  }
}

function meanAbsDiff(fieldA: Uint8Array, fieldB: Uint8Array, cells: number): number {
  const count = Math.min(cells, fieldA.length, fieldB.length);
  if (count <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum += Math.abs((fieldA[i] ?? 0) - (fieldB[i] ?? 0));
  }
  return sum / count;
}

function computeBadCellMask(
  baseField: Uint8Array,
  metaField: Uint8Array,
  cells: number,
  tau: number
): { count: number; indices: Uint32Array<ArrayBufferLike> } {
  const badIndices: number[] = [];
  const count = Math.min(cells, baseField.length, metaField.length);
  for (let i = 0; i < count; i++) {
    const diff = Math.abs((baseField[i] ?? 0) - (metaField[i] ?? 0));
    if (diff > tau) {
      badIndices.push(i);
    }
  }
  return { count: badIndices.length, indices: new Uint32Array(badIndices) };
}

type GraphStats = {
  edges: number;
  components: number;
  largest: number;
  sizes: number[];
};

type History = Record<string, number[]>;

type ChartConfig = {
  id: string;
  label: string;
  color: string;
  group: "P1" | "P2" | "P3" | "P4" | "P5" | "System" | "Graph";
  centerZero?: boolean;
  value: (ctx: ChartContext) => number;
};

type ChartContext = {
  diagnostics: Diagnostics;
  energy: EnergyBreakdown;
  stats: GraphStats;
  safeSet: SafeSetStats;
  n: number;
};

type HistogramConfig = {
  id: string;
  label: string;
  color: string;
  group: "P1" | "P2" | "P3" | "P4" | "P5" | "System" | "Graph";
  bins: (ctx: ChartContext) => number[];
};

const CHARTS: ChartConfig[] = [
  {
    id: "jw",
    label: "Jw (flux)",
    color: "rgba(122, 187, 255, 0.85)",
    group: "P1",
    centerZero: true,
    value: (ctx) => ctx.diagnostics.jW,
  },
  {
    id: "aw",
    label: "Aw (affinity)",
    color: "rgba(180, 210, 255, 0.85)",
    group: "P1",
    centerZero: true,
    value: (ctx) => ctx.diagnostics.aW,
  },
  {
    id: "ja",
    label: "Ja (flux)",
    color: "rgba(150, 200, 255, 0.85)",
    group: "P2",
    centerZero: true,
    value: (ctx) => ctx.diagnostics.jA,
  },
  {
    id: "aa",
    label: "Aa (affinity)",
    color: "rgba(190, 220, 255, 0.85)",
    group: "P2",
    centerZero: true,
    value: (ctx) => ctx.diagnostics.aA,
  },
  {
    id: "jn",
    label: "Jn (flux)",
    color: "rgba(140, 220, 200, 0.85)",
    group: "P4",
    centerZero: true,
    value: (ctx) => ctx.diagnostics.jN,
  },
  {
    id: "an",
    label: "An (affinity)",
    color: "rgba(180, 230, 210, 0.85)",
    group: "P4",
    centerZero: true,
    value: (ctx) => ctx.diagnostics.aN,
  },
  {
    id: "js",
    label: "Js (flux)",
    color: "rgba(170, 200, 140, 0.85)",
    group: "P5",
    centerZero: true,
    value: (ctx) => ctx.diagnostics.jS,
  },
  {
    id: "as",
    label: "As (affinity)",
    color: "rgba(200, 220, 160, 0.85)",
    group: "P5",
    centerZero: true,
    value: (ctx) => ctx.diagnostics.aS,
  },
  {
    id: "p3Disp",
    label: "P3 disp",
    color: "rgba(240, 210, 80, 0.85)",
    group: "P3",
    value: (ctx) => ctx.diagnostics.p3DispMag,
  },
  {
    id: "p3Loop",
    label: "P3 loop",
    color: "rgba(240, 190, 60, 0.85)",
    group: "P3",
    centerZero: true,
    value: (ctx) => ctx.diagnostics.p3LoopArea,
  },
  {
    id: "m6w",
    label: "M6 W",
    color: "rgba(255, 130, 130, 0.85)",
    group: "System",
    centerZero: true,
    value: (ctx) => ctx.diagnostics.aM6W,
  },
  {
    id: "m6n",
    label: "M6 N",
    color: "rgba(255, 150, 150, 0.85)",
    group: "System",
    centerZero: true,
    value: (ctx) => ctx.diagnostics.aM6N,
  },
  {
    id: "m6a",
    label: "M6 A",
    color: "rgba(255, 170, 170, 0.85)",
    group: "System",
    centerZero: true,
    value: (ctx) => ctx.diagnostics.aM6A,
  },
  {
    id: "m6s",
    label: "M6 S",
    color: "rgba(255, 190, 190, 0.85)",
    group: "System",
    centerZero: true,
    value: (ctx) => ctx.diagnostics.aM6S,
  },
  {
    id: "safeFrac",
    label: "Safe area",
    color: "rgba(120, 210, 160, 0.85)",
    group: "P5",
    value: (ctx) => ctx.safeSet.fraction,
  },
  {
    id: "safeLargest",
    label: "Safe largest",
    color: "rgba(160, 230, 120, 0.85)",
    group: "P5",
    value: (ctx) => ctx.safeSet.largestFrac,
  },
  {
    id: "safeCount",
    label: "Safe components",
    color: "rgba(200, 220, 120, 0.85)",
    group: "P5",
    value: (ctx) => ctx.safeSet.components,
  },
  {
    id: "sigma",
    label: "Sigma (mem)",
    color: "rgba(255, 203, 120, 0.85)",
    group: "System",
    centerZero: true,
    value: (ctx) => ctx.diagnostics.sigmaMem,
  },
  {
    id: "edges",
    label: "Edges",
    color: "rgba(140, 245, 200, 0.85)",
    group: "Graph",
    value: (ctx) => ctx.stats.edges,
  },
  {
    id: "largest",
    label: "Largest frac",
    color: "rgba(255, 160, 160, 0.85)",
    group: "Graph",
    value: (ctx) => ctx.stats.largest / ctx.n,
  },
  {
    id: "energy",
    label: "Energy",
    color: "rgba(200, 180, 255, 0.85)",
    group: "System",
    value: (ctx) => ctx.energy.total,
  },
];

const HISTOGRAMS: HistogramConfig[] = [
  {
    id: "wHist",
    label: "Bond weights",
    color: "rgba(120, 170, 255, 0.85)",
    group: "P1",
    bins: (ctx) => Array.from(ctx.diagnostics.wHist),
  },
  {
    id: "compHist",
    label: "Component sizes",
    color: "rgba(255, 180, 140, 0.85)",
    group: "Graph",
    bins: (ctx) => componentSizeHistogram(ctx.stats.sizes, ctx.n, 12),
  },
  {
    id: "sHist",
    label: "Field levels",
    color: "rgba(170, 200, 140, 0.85)",
    group: "P5",
    bins: (ctx) => Array.from(ctx.diagnostics.sHist),
  },
];

type SafeSetStats = {
  fraction: number;
  components: number;
  largestFrac: number;
};

type EpPoint = {
  step: number;
  exact: number;
  naive: number;
};

type StoryScenarioId = "injury_healing";
type StoryPhase = "idle" | "preparing" | "warming" | "recovering" | "done" | "resetting";
type CompareControlId = "no_repair" | "no_eta" | "no_p6";

const EP_WINDOW_STEPS = 20000;
const CERT_STABILITY_K = 5;
const CERT_MIN_STEPS = EP_WINDOW_STEPS;
const CERT_EP_EXACT_RATE_ABS_MAX = 2e-4;
const CERT_SIGMA_MEM_ABS_MAX = 2e-3;
const CERT_M6_ABS_MAX = 2e-3;
const TUR_BLOCK_STEPS = 50000;
const TUR_MIN_BLOCKS = 10;
const TUR_SAMPLES_CAP = 200;
const CERT_CLOCK_NULL_MIN_STEPS = 200000;
const CERT_CLOCK_NULL_DRIFT_ABS_MAX = 5e-4;
const CERT_TUR_MIN_BLOCKS = TUR_MIN_BLOCKS;
const CERT_TUR_R_MIN = 1.0;
const CERT_TUR_MIN_MEANQ = 1e-6;
const OPK_DIFF_MAX = 0.25;
const OPK_VIEW_MAX_CELLS = 65536;
const OPK_PAYLOAD_EVERY_STEPS = 20000;
const MAINT_EVERY_STEPS = 50000;
const MAINT_TRIALS = 8;
const MAINT_ERR_FRAC = 0.5;
const MAINT_SERIES_CAP = 240;
/** Threshold for "bad cell" in maintenance overlay: |base - meta0| > tau */
const MAINT_BAD_CELL_TAU = 3;
const INJURY_MASK_EVERY_STEPS = 10000;
const INJURY_MASK_MAX_CELLS = 65536;
const SSTACK_STATS_EVERY_STEPS = 20000;
const MOVE_P5_BASE = 7;
const MOVE_P5_META = 8;
const MOVE_CLOCK = 10;
const DEFAULT_HISTORY_CAP = 400;
const DEFAULT_STACK_MAX_LAYERS = 4;
const META_ALIGN_SERIES_CAP = 400;
const DEFAULT_PRESET_ID = "base_null_balanced";
const STORY_SCENARIOS = {
  injury_healing: {
    presetId: "showcase_all6_injury_healing",
    n: 200,
    seed: 1,
    warmupSteps: 100000,
    perturbMode: "randomize",
    recoverySteps: 300000,
    autoPause: true,
    forceSStackMode: "diff_base",
  },
} as const;
const STORY_SCENARIO_META = {
  injury_healing: {
    label: "Injury → Healing",
    presetId: "showcase_all6_injury_healing",
    description: [
      "We inject damage into Meta0, then watch mismatch shrink under drive.",
      "Watch the Injury Map shrink and the Life HUD trend flip to healing.",
    ],
    recommendedCompareControl: "no_repair" as CompareControlId,
  },
} as const;
const STORY_STATUS_IDLE = "Story: idle";
const AB_STEP_CHUNK = 5000;
const COMPARE_CONTROL_LABELS: Record<CompareControlId, string> = {
  no_repair: "No repair (P5 off)",
  no_eta: "No coupling (η=0)",
  no_p6: "No P6",
};

function pushHistory(series: number[], value: number, cap: number) {
  series.push(value);
  // cap <= 0 means unlimited
  if (cap > 0) {
    while (series.length > cap) series.shift();
  }
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function variance(values: number[], meanValue: number): number {
  if (values.length === 0) return 0;
  let acc = 0;
  for (const v of values) {
    const d = v - meanValue;
    acc += d * d;
  }
  return acc / values.length;
}

function formatTURValue(value: number): string {
  if (!Number.isFinite(value)) return "inf";
  const abs = Math.abs(value);
  if (abs >= 1e4 || (abs > 0 && abs < 1e-3)) {
    return value.toExponential(3);
  }
  return value.toFixed(3);
}

function parseOpOffsets(offsets: Int8Array): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < offsets.length; i += 2) {
    out.push([offsets[i] ?? 0, offsets[i + 1] ?? 0]);
  }
  return out;
}

function opkOffsetIndex(q: number, dx: number, dy: number, grid: number): number {
  const x = q % grid;
  const y = Math.floor(q / grid);
  const nx = (x + dx + grid) % grid;
  const ny = (y + dy + grid) % grid;
  return ny * grid + nx;
}

function computeOpkBudgetBadCells(
  tokens: Uint8Array,
  interfaces: number,
  cells: number,
  rCount: number,
  budgetK: number
): number {
  if (interfaces <= 0 || cells <= 0 || rCount <= 0) return 0;
  let bad = 0;
  for (let iface = 0; iface < interfaces; iface += 1) {
    const ifaceOffset = iface * cells * rCount;
    for (let q = 0; q < cells; q += 1) {
      const start = ifaceOffset + q * rCount;
      let sum = 0;
      for (let r = 0; r < rCount; r += 1) sum += tokens[start + r] ?? 0;
      if (sum !== budgetK) bad += 1;
    }
  }
  return bad;
}

function computeOpkSdiffMean({
  tokens,
  offsets,
  grid,
  interfaces,
  rCount,
  budgetK,
  baseS,
  metaS,
  lS,
}: {
  tokens: Uint8Array;
  offsets: Array<[number, number]>;
  grid: number;
  interfaces: number;
  rCount: number;
  budgetK: number;
  baseS: Uint8Array;
  metaS: Uint8Array;
  lS: number;
}): number {
  const cells = grid * grid;
  if (cells === 0 || interfaces === 0 || rCount === 0) return 0;
  const denom = Math.max(1, lS);
  const budget = Math.max(1, budgetK);
  let total = 0;
  for (let iface = 0; iface < interfaces; iface += 1) {
    let sdiffSum = 0;
    const ifaceOffset = iface * cells;
    const lowerOffset = iface === 0 ? -1 : (iface - 1) * cells;
    for (let q = 0; q < cells; q += 1) {
      const start = (ifaceOffset + q) * rCount;
      let pred = 0;
      for (let r = 0; r < rCount; r += 1) {
        const k = (tokens[start + r] ?? 0) / budget;
        const [dx, dy] = offsets[r] ?? [0, 0];
        const qOff = opkOffsetIndex(q, dx, dy, grid);
        const lower =
          iface === 0 ? baseS[qOff] ?? 0 : metaS[lowerOffset + qOff] ?? 0;
        pred += k * (lower / denom);
      }
      const upper = metaS[ifaceOffset + q] ?? 0;
      sdiffSum += Math.abs(upper / denom - pred);
    }
    total += sdiffSum / cells;
  }
  return total / interfaces;
}

function buildOpkTokenMap(
  tokens: Uint8Array,
  interfaceIdx: number,
  rIdx: number,
  cells: number,
  rCount: number
): Uint8Array {
  const out = new Uint8Array(cells);
  const ifaceOffset = interfaceIdx * cells * rCount;
  for (let q = 0; q < cells; q += 1) {
    out[q] = tokens[ifaceOffset + q * rCount + rIdx] ?? 0;
  }
  return out;
}

function buildOpkTotalMap(
  tokens: Uint8Array,
  interfaceIdx: number,
  cells: number,
  rCount: number
): Uint8Array {
  const out = new Uint8Array(cells);
  const ifaceOffset = interfaceIdx * cells * rCount;
  for (let q = 0; q < cells; q += 1) {
    const start = ifaceOffset + q * rCount;
    let sum = 0;
    for (let r = 0; r < rCount; r += 1) sum += tokens[start + r] ?? 0;
    out[q] = Math.min(255, sum);
  }
  return out;
}

function buildOpkMismatchMap({
  tokens,
  offsets,
  grid,
  interfaceIdx,
  rCount,
  budgetK,
  baseS,
  metaS,
  lS,
  diffMax,
}: {
  tokens: Uint8Array;
  offsets: Array<[number, number]>;
  grid: number;
  interfaceIdx: number;
  rCount: number;
  budgetK: number;
  baseS: Uint8Array;
  metaS: Uint8Array;
  lS: number;
  diffMax: number;
}): Uint8Array {
  const cells = grid * grid;
  const out = new Uint8Array(cells);
  if (cells === 0 || rCount === 0) return out;
  const denom = Math.max(1, lS);
  const budget = Math.max(1, budgetK);
  const ifaceOffset = interfaceIdx * cells;
  const lowerOffset = interfaceIdx === 0 ? -1 : (interfaceIdx - 1) * cells;
  const scale = diffMax > 0 ? 255 / diffMax : 0;
  for (let q = 0; q < cells; q += 1) {
    const start = (ifaceOffset + q) * rCount;
    let pred = 0;
    for (let r = 0; r < rCount; r += 1) {
      const k = (tokens[start + r] ?? 0) / budget;
      const [dx, dy] = offsets[r] ?? [0, 0];
      const qOff = opkOffsetIndex(q, dx, dy, grid);
      const lower =
        interfaceIdx === 0 ? baseS[qOff] ?? 0 : metaS[lowerOffset + qOff] ?? 0;
      pred += k * (lower / denom);
    }
    const upper = metaS[ifaceOffset + q] ?? 0;
    const diff = Math.abs(upper / denom - pred);
    out[q] = Math.max(0, Math.min(255, Math.round(diff * scale)));
  }
  return out;
}

function quadrantIndex(idx: number, g: number): number {
  const x = idx % g;
  const y = Math.floor(idx / g);
  const qx = x < g / 2 ? 0 : 1;
  const qy = y < g / 2 ? 0 : 1;
  return qy * 2 + qx;
}

function logicalBitsFromField(
  field: Uint8Array,
  g: number,
  lS: number,
  mask?: Uint8Array
): number[] {
  const sums = [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < field.length; i += 1) {
    if (mask && mask[i] === 0) continue;
    const q = quadrantIndex(i, g);
    sums[q] += field[i] ?? 0;
    counts[q] += 1;
  }
  const threshold = lS / 2;
  return sums.map((sum, i) => {
    const meanVal = counts[i] > 0 ? sum / counts[i] : 0;
    return meanVal >= threshold ? 1 : 0;
  });
}

function errorRate(bitsA: number[], bitsB: number[]): number {
  let mismatches = 0;
  const len = Math.min(bitsA.length, bitsB.length);
  if (len === 0) return 0;
  for (let i = 0; i < len; i += 1) {
    if (bitsA[i] !== bitsB[i]) mismatches += 1;
  }
  return mismatches / len;
}

function makeRng(seed: number) {
  let x = seed >>> 0;
  if (x === 0) x = 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 8) / (1 << 24);
  };
}

function computeErrF05(
  baseS: Uint8Array,
  meta0: Uint8Array,
  grid: number,
  lS: number,
  trials: number,
  frac: number,
  seed: number
): number {
  if (baseS.length === 0 || meta0.length === 0 || grid <= 0 || trials <= 0) return 0;
  const baseBits = logicalBitsFromField(baseS, grid, lS);
  const rng = makeRng(seed);
  let acc = 0;
  const mask = new Uint8Array(meta0.length);
  for (let t = 0; t < trials; t += 1) {
    for (let i = 0; i < meta0.length; i += 1) {
      mask[i] = rng() < frac ? 1 : 0;
    }
    const bits = logicalBitsFromField(meta0, grid, lS, mask);
    acc += errorRate(bits, baseBits);
  }
  return acc / trials;
}

function drawSparkline(
  canvas: HTMLCanvasElement,
  series: number[],
  color: string,
  options: { centerZero?: boolean } = {}
) {
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h - 1);
  ctx.lineTo(w, h - 1);
  ctx.stroke();

  if (series.length < 2) {
    return;
  }

  let min = Infinity;
  let max = -Infinity;
  for (const v of series) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (options.centerZero) {
    const abs = Math.max(Math.abs(min), Math.abs(max), 1e-6);
    min = -abs;
    max = abs;
  }
  if (Math.abs(max - min) < 1e-9) {
    max = min + 1e-6;
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, Math.floor(1 * dpr));
  ctx.beginPath();
  const count = series.length;
  const cols = Math.max(1, w);
  const samples = Math.min(count, cols);
  ctx.beginPath();
  if (count <= cols) {
    for (let i = 0; i < count; i++) {
      const t = series[i]!;
      const x = (i / Math.max(1, count - 1)) * (w - 1);
      const y = h - 1 - ((t - min) / (max - min)) * (h - 2);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
  } else {
    for (let s = 0; s < samples; s++) {
      const start = Math.floor((s * count) / samples);
      const end = Math.max(start + 1, Math.floor(((s + 1) * count) / samples));
      let sum = 0;
      for (let i = start; i < end; i++) {
        sum += series[i]!;
      }
      const avg = sum / (end - start);
      const x = (s / Math.max(1, samples - 1)) * (w - 1);
      const y = h - 1 - ((avg - min) / (max - min)) * (h - 2);
      if (s === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
  }
  ctx.stroke();

  if (options.centerZero && min < 0 && max > 0) {
    const y0 = h - 1 - ((0 - min) / (max - min)) * (h - 2);
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y0);
    ctx.lineTo(w, y0);
    ctx.stroke();
  }
}

function drawHistogram(canvas: HTMLCanvasElement, bins: number[], color: string) {
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, w, h);
  if (bins.length === 0) return;

  let max = 0;
  for (const v of bins) {
    if (v > max) max = v;
  }
  if (max <= 0) return;

  const barW = w / bins.length;
  ctx.fillStyle = color;
  for (let i = 0; i < bins.length; i++) {
    const v = bins[i]!;
    const barH = (v / max) * (h - 2);
    const x = i * barW;
    const y = h - 1 - barH;
    ctx.fillRect(x + 0.5, y, Math.max(1, barW - 1), barH);
  }
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h - 1);
  ctx.lineTo(w, h - 1);
  ctx.stroke();
}

function componentSizeHistogram(sizes: number[], n: number, bins: number): number[] {
  const out = new Array(bins).fill(0);
  if (n <= 0 || bins <= 0) return out;
  for (const size of sizes) {
    const frac = size / n;
    const idx = Math.min(bins - 1, Math.floor(frac * bins));
    out[idx] += 1;
  }
  return out;
}

function computeSafeSetStats(field: Uint8Array, threshold: number): SafeSetStats {
  const total = field.length;
  if (total === 0) {
    return { fraction: 0, components: 0, largestFrac: 0 };
  }
  const g = Math.round(Math.sqrt(total));
  if (g * g !== total) {
    return { fraction: 0, components: 0, largestFrac: 0 };
  }
  const visited = new Uint8Array(total);
  let safeCount = 0;
  let components = 0;
  let largest = 0;

  const queueX = new Int16Array(total);
  const queueY = new Int16Array(total);

  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < g && y < g;

  for (let y = 0; y < g; y++) {
    for (let x = 0; x < g; x++) {
      const idx = y * g + x;
      if (field[idx]! < threshold) continue;
      safeCount += 1;
      if (visited[idx]) continue;
      components += 1;
      let head = 0;
      let tail = 0;
      queueX[tail] = x;
      queueY[tail] = y;
      tail += 1;
      visited[idx] = 1;
      let compSize = 0;
      while (head < tail) {
        const cx = queueX[head]!;
        const cy = queueY[head]!;
        head += 1;
        compSize += 1;
        const neighbors = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (!inBounds(nx, ny)) continue;
          const nidx = ny * g + nx;
          if (visited[nidx]) continue;
          if (field[nidx]! < threshold) continue;
          visited[nidx] = 1;
          queueX[tail] = nx;
          queueY[tail] = ny;
          tail += 1;
        }
      }
      if (compSize > largest) {
        largest = compSize;
      }
    }
  }

  return {
    fraction: safeCount / total,
    components,
    largestFrac: total > 0 ? largest / total : 0,
  };
}

function computeGraphStats(n: number, bonds: Uint32Array): GraphStats {
  const parent = new Int32Array(n);
  const size = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    parent[i] = i;
    size[i] = 1;
  }

  const find = (x: number): number => {
    let p = parent[x]!;
    if (p !== x) {
      parent[x] = find(p);
    }
    return parent[x]!;
  };

  const union = (a: number, b: number) => {
    let ra = find(a);
    let rb = find(b);
    if (ra === rb) return;
    if (size[ra]! < size[rb]!) {
      [ra, rb] = [rb, ra];
    }
    parent[rb] = ra;
    size[ra] += size[rb]!;
  };

  for (let k = 0; k < bonds.length; k += 2) {
    union(bonds[k]!, bonds[k + 1]!);
  }

  let components = 0;
  let largest = 0;
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) {
    if (parent[i] === i) {
      components += 1;
      const s = size[i]!;
      sizes.push(s);
      if (s > largest) {
        largest = s;
      }
    }
  }

  return { edges: bonds.length / 2, components, largest, sizes };
}

const DEFAULT_PARAMS: SimParams = {
  beta: 1.0,
  stepSize: 0.01,
  p3On: 0,
  p6On: 0,
  etaDrive: 0,
  p6SFactor: 1,
  pWrite: 0.1,
  pNWrite: 0.05,
  pAWrite: 0.05,
  pSWrite: 0.05,
  muHigh: 0.6,
  muLow: -0.6,
  kappaRep: 500.0,
  r0: 0.25,
  kappaBond: 1.2,
  rStar: 0.22,
  lambdaW: 0.3,
  lW: 4,
  lambdaN: 0.5,
  lN: 6,
  lambdaA: 0.5,
  lA: 6,
  lambdaS: 0.5,
  lS: 6,
  gridSize: 16,
  rPropose: 0.12,
  metaLayers: 0,
  eta: 0.0,
  clockOn: 0,
  clockK: 8,
  clockFrac: 0,
  clockUsesP6: 0,
  repairClockGated: 0,
  repairGateMode: 0,
  repairGateSpan: 0,
  codeNoiseRate: 0,
  codeNoiseBatch: 0,
  codeNoiseLayer: 0,
  opCouplingOn: 0,
  sCouplingMode: 0,
  opStencil: 0,
  opBudgetK: 8,
  opKTargetWeight: 1.0,
  opDriveOnK: 0,
};

export default function App() {
  console.log("[DEBUG] App() render start");
  // Load saved settings once on mount
  const [savedSettings] = useState(() => loadSettings());

  const [n, setN] = useState(savedSettings.n ?? 200);
  const [seed, setSeed] = useState(savedSettings.seed ?? 1);
  const [bondThreshold, setBondThreshold] = useState(savedSettings.bondThreshold ?? 3);
  const [showHelp, setShowHelp] = useState(false);
  const [energy, setEnergy] = useState<EnergyBreakdown | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [graphStats, setGraphStats] = useState<GraphStats | null>(null);
  const [graphStatsN, setGraphStatsN] = useState<number | null>(null);
  const [bondsMode, setBondsMode] = useState<"live" | "chart" | "off">(savedSettings.bondsMode ?? "live");
  const [graphStatsMode, setGraphStatsMode] = useState<"auto" | "ondemand" | "off">(savedSettings.graphStatsMode ?? "auto");
  const [stackMaxLayers, setStackMaxLayers] = useState(savedSettings.stackMaxLayers ?? DEFAULT_STACK_MAX_LAYERS);
  const [historyCap, setHistoryCap] = useState(savedSettings.historyCap ?? DEFAULT_HISTORY_CAP);
  const [recordEverySteps, setRecordEverySteps] = useState(savedSettings.recordEverySteps ?? 2000);
  const [totalSteps, setTotalSteps] = useState(0);
  const [epExactTotal, setEpExactTotal] = useState<number | null>(null);
  const [epNaiveTotal, setEpNaiveTotal] = useState<number | null>(null);
  const [epExactRate, setEpExactRate] = useState<number | null>(null);
  const [epNaiveRate, setEpNaiveRate] = useState<number | null>(null);
  const [clockDebug, setClockDebug] = useState<null | { state: number; q: number; fwd: number; bwd: number }>(null);
  const [turStats, setTurStats] = useState<null | {
    blocks: number;
    meanQ: number;
    varQ: number;
    meanSigma: number;
    R: number;
  }>(null);
  const [opkMeta, setOpkMeta] = useState<null | {
    enabled: boolean;
    budgetK: number;
    interfaces: number;
    rCount: number;
    stencilId: number;
    computedAtSteps?: number;
  }>(null);
  const [opkStats, setOpkStats] = useState<null | {
    sdiffMean: number;
    budgetOk: boolean;
    badCells: number;
    budgetK: number;
    interfaces: number;
    rCount: number;
    stencilId: number;
  }>(null);
  const [maintStats, setMaintStats] = useState<null | {
    errF0_5: number | null;
    sdiffBase: number | null;
    epRepairRate: number | null;
    epClockRate: number | null;
    noiseExpectedEdits: number | null;
    lastPerturbStep: number | null;
    recoverySteps: number | null;
  }>(null);
  const [lifeHud, setLifeHud] = useState<LifeHudState | null>(null);
  const [storyScenarioId, setStoryScenarioId] = useState<StoryScenarioId>("injury_healing");
  const [storyPhase, setStoryPhase] = useState<StoryPhase>("idle");
  const [storyStatus, setStoryStatus] = useState<string>(STORY_STATUS_IDLE);
  const [compareOn, setCompareOn] = useState(false);
  const [compareControl, setCompareControl] = useState<CompareControlId>("no_repair");
  const [compareReady, setCompareReady] = useState(false);
  const [sStackMode, setSStackMode] = useState<"layers" | "diff_base" | "diff_meta">("layers");
  const [sStackDiffIndex, setSStackDiffIndex] = useState(0);
  const [sStackMetaStart, setSStackMetaStart] = useState(0);
  const [opkInterfaceIdx, setOpkInterfaceIdx] = useState(0);
  const [opkOffsetIdx, setOpkOffsetIdx] = useState(0);
  const [opkViewMode, setOpkViewMode] = useState<"tokens" | "total" | "mismatch">("tokens");
  const [opkHistAll, setOpkHistAll] = useState(false);
  const [opkPayloadVersion, setOpkPayloadVersion] = useState(0);
  const [opkViewVersion, setOpkViewVersion] = useState(0);
  const [opkViewStatus, setOpkViewStatus] = useState<"ok" | "waiting" | "mismatch">("waiting");
  const [layerSafeStats, setLayerSafeStats] = useState<
    Array<{ id: string; label: string; stats: SafeSetStats }>
  >([]);
  const [sStackDiffMean, setSStackDiffMean] = useState<number | null>(null);
  const [metaAlign, setMetaAlign] = useState<null | {
    sdiffBase: number;
    sdiffMeta: number;
    wdiffMeta: number;
  }>(null);
  const [metaAlignBaseline, setMetaAlignBaseline] = useState<null | {
    step: number;
    eta: number;
    sdiffBase: number;
    sdiffMeta: number;
    wdiffMeta: number;
  }>(null);
  const [certPassed, setCertPassed] = useState({
    epNull: false,
    sigmaNull: false,
    m6Null: false,
    clockNull: false,
    tur: false,
    opkBudget: false,
    codeMaint: false,
  });
  const [p1Enabled, setP1Enabled] = useState(savedSettings.p1Enabled ?? true);
  const [p2Enabled, setP2Enabled] = useState(savedSettings.p2Enabled ?? true);
  const [p4Enabled, setP4Enabled] = useState(savedSettings.p4Enabled ?? true);
  const [p5Enabled, setP5Enabled] = useState(savedSettings.p5Enabled ?? true);
  const [p3Enabled, setP3Enabled] = useState(savedSettings.p3Enabled ?? false);
  const [p6Enabled, setP6Enabled] = useState(savedSettings.p6Enabled ?? false);
  const [safeThreshold, setSafeThreshold] = useState(savedSettings.safeThreshold ?? 3);
  const [colorSource, setColorSource] = useState<"none" | "p4" | "p2">(savedSettings.colorSource ?? "p4");
  const [overlayChannel, setOverlayChannel] = useState<
    "none" | "baseS" | "metaS" | "metaN" | "metaA" | "metaW"
  >(savedSettings.overlayChannel ?? "none");
  const [evidenceOverlaysOn, setEvidenceOverlaysOn] = useState(
    savedSettings.evidenceOverlaysOn ?? true
  );
  const [injuryMapOn, setInjuryMapOn] = useState(savedSettings.injuryMapOn ?? true);
  const [lifeHudOn, setLifeHudOn] = useState(savedSettings.lifeHudOn ?? true);
  const injuryMapOnRef = useRef(injuryMapOn);
  const [overlayLayerIndex, setOverlayLayerIndex] = useState(0);
  const [status, setStatus] = useState<"idle" | "initializing" | "ready" | "running">("idle");
  const [error, setError] = useState<string | null>(null);
  const [initSlow, setInitSlow] = useState(false);
  const [metaSnapshot, setMetaSnapshot] = useState<{ layers: number; length: number } | null>(null);
  const [paramsDraft, setParamsDraft] = useState<SimParams>(DEFAULT_PARAMS);
  const [paramsApplied, setParamsApplied] = useState<SimParams>(DEFAULT_PARAMS);
  const [presetId, setPresetId] = useState<string>(savedSettings.presetId ?? DEFAULT_PRESET_ID);
  const [expandedPanels, setExpandedPanels] = useState<Record<string, boolean>>({
    motion: false,
    p1: false,
    p2: false,
    p4: false,
    p5: false,
    clock: false,
    opk: false,
    maintenance: false,
    p6: false,
    meta: false,
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const histRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const sStackRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const metaAlignCanvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const bondsCacheRef = useRef<Uint32Array>(new Uint32Array());
  const emptyBondsRef = useRef<Uint32Array>(new Uint32Array());
  const graphStatsRef = useRef<GraphStats | null>(null);
  const lastNRef = useRef<number>(n);
  const lastBondsRefreshStepsRef = useRef<number | null>(null);
  const historyRef = useRef<History>({});
  const chartStepRef = useRef(0);
  const sStackStatsStepRef = useRef(0);
  const epStepCounterRef = useRef(0);
  const epWindowRef = useRef<EpPoint[]>([]);
  const certCountsRef = useRef({
    epNull: 0,
    sigmaNull: 0,
    m6Null: 0,
    clockNull: 0,
    tur: 0,
    opkBudget: 0,
    codeMaint: 0,
  });
  const turRef = useRef({
    lastStep: 0,
    lastQ: 0,
    lastSigma: 0,
    samplesQ: [] as number[],
    samplesSigma: [] as number[],
  });
  const opkCacheRef = useRef({
    tokens: null as Uint8Array | null,
    offsets: null as Int8Array | null,
    offsetPairs: [] as Array<[number, number]>,
  });
  const opkMetaRef = useRef<typeof opkMeta>(null);
  const opkFieldRef = useRef<{
    baseS: Uint8Array<ArrayBufferLike>;
    metaS: Uint8Array<ArrayBufferLike>;
    grid: number;
    lS: number;
    metaLayers: number;
  }>({
    baseS: new Uint8Array(),
    metaS: new Uint8Array(),
    grid: 0,
    lS: 1,
    metaLayers: 0,
  });
  const opkStatsRef = useRef<typeof opkStats>(null);
  const opkCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const opkHistCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maintHistoryRef = useRef({
    err: [] as number[],
    sdiff: [] as number[],
    repair: [] as number[],
    damage: [] as number[],
  });
  const maintForceComputeRef = useRef(false);
  const maintCanvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const lifeHudRef = useRef<LifeHudState | null>(null);
  const injuryMaskStepRef = useRef(0);
  const maintRef = useRef({
    lastStep: 0,
    lastEpRepair: 0,
    lastEpClock: 0,
    lastPerturbStep: null as number | null,
    baselineErr: null as number | null,
    baselineSdiff: null as number | null,
    recoverySteps: null as number | null,
    seed: 1234567,
    // Evidence overlay: bad cells for maintenance cert
    badCells: 0,
    badCellIdx: new Uint32Array(0) as Uint32Array<ArrayBufferLike>,
    badTau: MAINT_BAD_CELL_TAU,
    badCellUpdatedAt: 0,
    errF0_5: null as number | null,
  });
  const storyRef = useRef<{
    scenarioId: StoryScenarioId;
    phase: StoryPhase;
    injuryAt: number;
    endAt: number;
    startedAt: number;
    injuryTriggered: boolean;
    paramsApplied: SimParams | null;
    compareOn: boolean;
  }>({
    scenarioId: "injury_healing",
    phase: "idle",
    injuryAt: 0,
    endAt: 0,
    startedAt: 0,
    injuryTriggered: false,
    paramsApplied: null,
    compareOn: false,
  });
  const storyStatusRef = useRef<string>(STORY_STATUS_IDLE);
  const clientBRef = useRef<SimWorkerClient | null>(null);
  const abDiffARef = useRef<HTMLCanvasElement | null>(null);
  const abDiffBRef = useRef<HTMLCanvasElement | null>(null);
  const abRef = useRef<{
    enabled: boolean;
    readyA: boolean;
    readyB: boolean;
    configuredA: boolean;
    configuredB: boolean;
    inFlight: boolean;
    awaitingA: boolean;
    awaitingB: boolean;
    totalSteps: number;
    injuryTriggered: boolean;
    paramsA: SimParams | null;
    paramsB: SimParams | null;
    badCellsB: number;
    badCellIdxB: Uint32Array<ArrayBufferLike>;
    badCellUpdatedAtB: number;
    forceMaskB: boolean;
  }>({
    enabled: false,
    readyA: false,
    readyB: false,
    configuredA: false,
    configuredB: false,
    inFlight: false,
    awaitingA: false,
    awaitingB: false,
    totalSteps: 0,
    injuryTriggered: false,
    paramsA: null,
    paramsB: null,
    badCellsB: 0,
    badCellIdxB: new Uint32Array(0) as Uint32Array<ArrayBufferLike>,
    badCellUpdatedAtB: 0,
    forceMaskB: false,
  });
  const metaAlignHistoryRef = useRef({
    sdiffBase: [] as number[],
    sdiffMeta: [] as number[],
    wdiffMeta: [] as number[],
  });
  const metaAlignRef = useRef<typeof metaAlign>(null);
  const chartGroups = useRef<Array<ChartConfig["group"]>>(["P1", "P2", "P3", "P4", "P5", "System", "Graph"]);

  const effectiveParams = (base: SimParams): SimParams => ({
    ...base,
    p3On: p3Enabled ? 1 : 0,
    p6On: p6Enabled ? 1 : 0,
    pWrite: p1Enabled ? base.pWrite : 0,
    pAWrite: p2Enabled ? base.pAWrite : 0,
    pNWrite: p4Enabled ? base.pNWrite : 0,
    pSWrite: p5Enabled ? base.pSWrite : 0,
  });

  const metaLayerCount = metaSnapshot?.layers ?? 0;
  const selectedPreset =
    PRESET_CATALOG.find((entry) => entry.id === presetId) ?? PRESET_CATALOG[0] ?? null;
  const storyMeta = STORY_SCENARIO_META[storyScenarioId];
  const storyPresetEntry =
    PRESET_CATALOG.find((entry) => entry.id === storyMeta.presetId) ?? null;

  // Save settings to localStorage when they change
  useEffect(() => {
    saveSettings({
      n,
      seed,
      bondThreshold,
      bondsMode,
      graphStatsMode,
      stackMaxLayers,
      historyCap,
      recordEverySteps,
      p1Enabled,
      p2Enabled,
      p3Enabled,
      p4Enabled,
      p5Enabled,
      p6Enabled,
      safeThreshold,
      colorSource,
      overlayChannel,
      presetId,
      evidenceOverlaysOn,
      injuryMapOn,
      lifeHudOn,
    });
  }, [
    n, seed, bondThreshold, bondsMode, graphStatsMode, stackMaxLayers,
    historyCap, recordEverySteps, p1Enabled, p2Enabled, p3Enabled,
    p4Enabled, p5Enabled, p6Enabled, safeThreshold, colorSource,
    overlayChannel, presetId, evidenceOverlaysOn, injuryMapOn, lifeHudOn,
  ]);

  const handleResetSettings = useCallback(() => {
    clearSettings();
    // Reset all state to defaults instead of reloading the page
    setN(200);
    setSeed(1);
    setBondThreshold(3);
    setBondsMode("live");
    setGraphStatsMode("auto");
    setStackMaxLayers(DEFAULT_STACK_MAX_LAYERS);
    setHistoryCap(DEFAULT_HISTORY_CAP);
    setRecordEverySteps(2000);
    setP1Enabled(true);
    setP2Enabled(true);
    setP3Enabled(false);
    setP4Enabled(true);
    setP5Enabled(true);
    setP6Enabled(false);
    setSafeThreshold(3);
    setColorSource("p4");
    setOverlayChannel("none");
    setEvidenceOverlaysOn(true);
    setInjuryMapOn(true);
    setLifeHudOn(true);
    setPresetId(DEFAULT_PRESET_ID);
    setParamsDraft(DEFAULT_PARAMS);
    setParamsApplied(DEFAULT_PARAMS);
  }, []);
  const resolveBondsEverySteps = (
    mode: "live" | "chart" | "off" = bondsMode,
    steps = recordEverySteps
  ) => {
    if (mode === "off") return 0;
    if (mode === "live") return 1;
    return Math.max(1, Math.floor(steps));
  };
  const bondsEverySteps = resolveBondsEverySteps();
  const bondThresholdRef = useRef(bondThreshold);
  const bondsEveryStepsRef = useRef(bondsEverySteps);

  useEffect(() => {
    bondThresholdRef.current = bondThreshold;
    bondsEveryStepsRef.current = bondsEverySteps;
  }, [bondThreshold, bondsEverySteps]);

  // Use module-level singleton to avoid React StrictMode double-creation
  const client = getClient();

  const buildPresetParams = (entry: PresetEntry) => {
    const nextDraft: SimParams = { ...DEFAULT_PARAMS, ...entry.params };
    const nextP1 = (nextDraft.pWrite ?? 0) > 0;
    const nextP2 = (nextDraft.pAWrite ?? 0) > 0;
    const nextP4 = (nextDraft.pNWrite ?? 0) > 0;
    const nextP5 = (nextDraft.pSWrite ?? 0) > 0;
    const nextP3 = (nextDraft.p3On ?? 0) > 0;
    const nextP6 = (nextDraft.p6On ?? 0) > 0;

    const nextApplied: SimParams = {
      ...nextDraft,
      p3On: nextP3 ? 1 : 0,
      p6On: nextP6 ? 1 : 0,
      pWrite: nextP1 ? nextDraft.pWrite : 0,
      pAWrite: nextP2 ? nextDraft.pAWrite : 0,
      pNWrite: nextP4 ? nextDraft.pNWrite : 0,
      pSWrite: nextP5 ? nextDraft.pSWrite : 0,
    };

    return { nextDraft, nextApplied, nextP1, nextP2, nextP3, nextP4, nextP5, nextP6 };
  };

  const applyCompareControl = (base: SimParams, control: CompareControlId): SimParams => {
    const next: SimParams = { ...base };
    if (control === "no_repair") {
      next.pSWrite = 0;
    } else if (control === "no_eta") {
      next.eta = 0;
    } else if (control === "no_p6") {
      next.p6On = 0;
    }
    return next;
  };

  const applyPreset = (entry: PresetEntry) => {
    const { nextDraft, nextApplied, nextP1, nextP2, nextP3, nextP4, nextP5, nextP6 } =
      buildPresetParams(entry);

    setP1Enabled(nextP1);
    setP2Enabled(nextP2);
    setP4Enabled(nextP4);
    setP5Enabled(nextP5);
    setP3Enabled(nextP3);
    setP6Enabled(nextP6);
    setParamsDraft(nextDraft);
    setParamsApplied(nextApplied);

    return nextApplied;
  };

  const presetInitRef = useRef(false);
  useEffect(() => {
    if (presetInitRef.current) return;
    presetInitRef.current = true;
    if (selectedPreset) {
      applyPreset(selectedPreset);
    }
  }, [selectedPreset]);

  useEffect(() => {
    attachToWindow();
    const offReady = client.onReady(() => {
      const story = storyRef.current;
      if (story.phase === "preparing" || story.phase === "resetting") {
        if (story.compareOn) {
          handleAbReady("A");
          return;
        }
        const scenario = STORY_SCENARIOS[story.scenarioId];
        const paramsForConfig = story.paramsApplied ?? paramsApplied;
        client.send({ type: "config", bondThreshold, params: paramsForConfig, bondsEverySteps });
        if (story.phase === "preparing") {
          story.phase = "warming";
          story.startedAt = 0;
          story.injuryTriggered = false;
          story.injuryAt = scenario.warmupSteps;
          story.endAt = scenario.warmupSteps + scenario.recoverySteps;
          setStoryPhase("warming");
          const nextStatus = `Story: warming 0/${scenario.warmupSteps}`;
          storyStatusRef.current = nextStatus;
          setStoryStatus(nextStatus);
          setStatus("running");
          client.send({ type: "resume" });
        } else {
          story.phase = "idle";
          setStoryPhase("idle");
          storyStatusRef.current = STORY_STATUS_IDLE;
          setStoryStatus(STORY_STATUS_IDLE);
          setStatus("ready");
        }
        return;
      }
      setStatus((s) => (s === "running" ? "running" : "ready"));
    });
    const offErr = client.onError((m) => setError(m));
    const offSnap = client.onSnapshot((s) => {
      let currentEpExactRate: number | null = null;
      let turStatsNow: typeof turStats = null;
      let opkMetaNow: typeof opkMeta = null;
      let epExactByMoveNow: Float64Array | null = null;
      let codeMaintPassNow: boolean | null = null;
      let epExactTotalNow: number | null = null;
      let stepNow: number | null = null;
      let lifeHudNow: LifeHudState | null = null;
      let clockQ: number | null = null;
      let clockFwd: number | null = null;
      let clockBwd: number | null = null;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const overlay =
        colorSource === "p2" ? s.apparatus : colorSource === "p4" ? s.counters : undefined;
      const grid = paramsApplied.gridSize;
      const cells = grid * grid;
      const canUseMeta = s.metaLayers > 0 && overlayLayerIndex >= 0 && overlayLayerIndex < s.metaLayers;
      let overlayField: ArrayLike<number> | undefined;
      let overlayMax: number | undefined;
      if (overlayChannel === "baseS") {
        overlayField = s.baseSField;
        overlayMax = paramsApplied.lS;
      } else if (overlayChannel === "metaS" && canUseMeta) {
        const start = overlayLayerIndex * cells;
        overlayField = s.metaField.subarray(start, start + cells);
        overlayMax = paramsApplied.lS;
      } else if (overlayChannel === "metaA" && canUseMeta) {
        const start = overlayLayerIndex * cells;
        overlayField = normalizeUnsignedField(s.metaAField.subarray(start, start + cells), paramsApplied.lA);
        overlayMax = 1;
      } else if (overlayChannel === "metaN" && canUseMeta) {
        const start = overlayLayerIndex * cells;
        overlayField = normalizeSignedField(s.metaNField.subarray(start, start + cells), paramsApplied.lN);
        overlayMax = 1;
      } else if (overlayChannel === "metaW" && canUseMeta) {
        const edges = 2 * cells;
        const start = overlayLayerIndex * edges;
        const slice = s.metaWEdges.subarray(start, start + edges);
        overlayField = metaWEdgesToCells(slice, grid);
        overlayMax = paramsApplied.lW;
      }
      lastNRef.current = s.n;
      const bondsReceived = s.bonds.length > 0;
      if (bondsReceived) {
        bondsCacheRef.current = s.bonds;
      }
      const bondsForDraw =
        bondsMode === "off"
          ? emptyBondsRef.current
          : s.bonds.length > 0
          ? s.bonds
          : bondsCacheRef.current;
      drawFrame(
        canvas,
        s.positions,
        bondsForDraw,
        overlay,
        overlayField,
        overlayMax
      );
      setEnergy(s.energy);
      setDiagnostics(s.diagnostics);
      let stats: GraphStats | null = graphStatsMode === "off" ? null : graphStatsRef.current;
      if (graphStatsMode === "auto" && s.bonds.length > 0) {
        stats = computeGraphStats(s.n, s.bonds);
        graphStatsRef.current = stats;
        setGraphStats(stats);
        setGraphStatsN(s.n);
      }
      setMetaSnapshot({ layers: s.metaLayers, length: s.metaField.length });
      opkFieldRef.current = {
        baseS: s.baseSField,
        metaS: s.metaField,
        grid: paramsApplied.gridSize,
        lS: paramsApplied.lS,
        metaLayers: s.metaLayers,
      };
      if (s.steps > 0) {
        setTotalSteps((prev) => prev + s.steps);
      }
      const epExtras = s.extras?.ep;
      if (epExtras && typeof epExtras.exactTotal === "number") {
        epExactTotalNow = epExtras.exactTotal;
        setEpExactTotal(epExtras.exactTotal);
        setEpNaiveTotal(typeof epExtras.naiveTotal === "number" ? epExtras.naiveTotal : null);
      }
      if (epExtras?.exactByMove instanceof Float64Array) {
        epExactByMoveNow = epExtras.exactByMove;
      }
      if (s.steps > 0 && epExactTotalNow !== null) {
        epStepCounterRef.current += s.steps;
        stepNow = epStepCounterRef.current;
        const epNaiveTotalNow = typeof epExtras?.naiveTotal === "number" ? epExtras.naiveTotal : 0;
        const points = epWindowRef.current;
        points.push({
          step: stepNow,
          exact: epExactTotalNow,
          naive: epNaiveTotalNow,
        });
        while (points.length > 0 && stepNow - points[0]!.step > EP_WINDOW_STEPS) {
          points.shift();
        }
        let exactRate: number | null = null;
        let naiveRate: number | null = null;
        if (points.length >= 2) {
          const oldest = points[0]!;
          const dt = stepNow - oldest.step;
          if (dt > 0) {
            exactRate = (epExactTotalNow - oldest.exact) / dt;
            if (typeof epNaiveTotalNow === "number") {
              naiveRate = (epNaiveTotalNow - oldest.naive) / dt;
            }
          }
        }
        currentEpExactRate = exactRate;
        setEpExactRate(exactRate);
        setEpNaiveRate(naiveRate);
      }

      if (bondsReceived) {
        const stepMark = stepNow !== null ? stepNow : epStepCounterRef.current;
        lastBondsRefreshStepsRef.current = stepMark;
      }

      const clockExtras = s.extras?.clock;
      if (
        clockExtras &&
        Number.isFinite(clockExtras.state) &&
        Number.isFinite(clockExtras.q) &&
        Number.isFinite(clockExtras.fwd) &&
        Number.isFinite(clockExtras.bwd)
      ) {
        clockQ = Number(clockExtras.q);
        clockFwd = Number(clockExtras.fwd);
        clockBwd = Number(clockExtras.bwd);
        setClockDebug({
          state: Number(clockExtras.state),
          q: clockQ,
          fwd: clockFwd,
          bwd: clockBwd,
        });
      } else {
        setClockDebug(null);
      }

      const opkExtras = s.extras?.opk;
      if (opkExtras) {
        const meta = {
          enabled: opkExtras.enabled ?? false,
          budgetK: opkExtras.budgetK ?? paramsApplied.opBudgetK,
          interfaces: opkExtras.interfaces ?? paramsApplied.metaLayers,
          rCount: opkExtras.rCount ?? 0,
          stencilId: opkExtras.stencilId ?? 0,
          computedAtSteps: opkExtras.computedAtSteps,
        };
        opkMetaNow = meta;
        const prevMeta = opkMetaRef.current;
        const metaChanged =
          !prevMeta ||
          prevMeta.enabled !== meta.enabled ||
          prevMeta.budgetK !== meta.budgetK ||
          prevMeta.interfaces !== meta.interfaces ||
          prevMeta.rCount !== meta.rCount ||
          prevMeta.stencilId !== meta.stencilId ||
          prevMeta.computedAtSteps !== meta.computedAtSteps;
        if (metaChanged) {
          opkMetaRef.current = meta;
          setOpkMeta(meta);
        }
        const cache = opkCacheRef.current;
        if (opkExtras.offsets && opkExtras.offsets.length > 0) {
          cache.offsets = opkExtras.offsets;
          cache.offsetPairs = parseOpOffsets(opkExtras.offsets);
        }
        if (opkExtras.tokens && opkExtras.tokens.length > 0) {
          cache.tokens = opkExtras.tokens;
        }
        if (
          opkExtras.tokens &&
          opkExtras.tokens.length > 0 &&
          opkExtras.offsets &&
          opkExtras.offsets.length > 0
        ) {
          setOpkPayloadVersion((v) => v + 1);
        }
        if (!meta.enabled) {
          opkStatsRef.current = null;
          setOpkStats(null);
        }
      }

      if (stepNow !== null && clockQ !== null && epExactTotalNow !== null) {
        const ref = turRef.current;
        if (ref.lastStep === 0) {
          ref.lastStep = stepNow;
          ref.lastQ = clockQ;
          ref.lastSigma = epExactTotalNow;
        } else if (stepNow - ref.lastStep >= TUR_BLOCK_STEPS) {
          const dq = clockQ - ref.lastQ;
          const ds = epExactTotalNow - ref.lastSigma;
          ref.samplesQ.push(dq);
          ref.samplesSigma.push(ds);
          ref.lastStep = stepNow;
          ref.lastQ = clockQ;
          ref.lastSigma = epExactTotalNow;
          while (ref.samplesQ.length > TUR_SAMPLES_CAP) ref.samplesQ.shift();
          while (ref.samplesSigma.length > TUR_SAMPLES_CAP) ref.samplesSigma.shift();
        }
      }

      const turSamplesQ = turRef.current.samplesQ;
      const turSamplesSigma = turRef.current.samplesSigma;
      if (turSamplesQ.length >= 2 && turSamplesQ.length === turSamplesSigma.length) {
        const meanQ = mean(turSamplesQ);
        const varQ = variance(turSamplesQ, meanQ);
        const meanSigma = mean(turSamplesSigma);
        const R = meanQ !== 0 ? (varQ / (meanQ * meanQ)) * (meanSigma / 2) : Infinity;
        turStatsNow = {
          blocks: turSamplesQ.length,
          meanQ,
          varQ,
          meanSigma,
          R,
        };
        setTurStats(turStatsNow);
      } else {
        turStatsNow = null;
        setTurStats(null);
      }

      if (
        s.metaLayers >= 2 &&
        s.metaField.length >= 2 * cells &&
        s.metaWEdges.length >= 2 * cells * 2
      ) {
        const meta0 = s.metaField.subarray(0, cells);
        const meta1 = s.metaField.subarray(cells, 2 * cells);
        const edges = 2 * cells;
        const metaW0 = s.metaWEdges.subarray(0, edges);
        const metaW1 = s.metaWEdges.subarray(edges, 2 * edges);
        const nextAlign = {
          sdiffBase: meanAbsDiff(s.baseSField, meta0, cells),
          sdiffMeta: meanAbsDiff(meta0, meta1, cells),
          wdiffMeta: meanAbsDiff(metaW0, metaW1, edges),
        };
        const prevAlign = metaAlignRef.current;
        metaAlignRef.current = nextAlign;
        if (
          !prevAlign ||
          prevAlign.sdiffBase !== nextAlign.sdiffBase ||
          prevAlign.sdiffMeta !== nextAlign.sdiffMeta ||
          prevAlign.wdiffMeta !== nextAlign.wdiffMeta
        ) {
          setMetaAlign(nextAlign);
        }
      } else {
        if (metaAlignRef.current !== null) {
          metaAlignRef.current = null;
          setMetaAlign(null);
        }
      }

      sStackStatsStepRef.current += Math.max(0, s.steps);
      let shouldUpdateSStackStats = false;
      if (sStackStatsStepRef.current >= SSTACK_STATS_EVERY_STEPS) {
        sStackStatsStepRef.current =
          sStackStatsStepRef.current % SSTACK_STATS_EVERY_STEPS;
        shouldUpdateSStackStats = true;
      }

      if (s.metaLayers > 0 && cells > 0) {
        const maxMetaPanels = Math.max(0, stackMaxLayers - 1);
        const start = Math.max(0, Math.min(sStackMetaStart, Math.max(0, s.metaLayers - 1)));
        const metaCount = Math.min(s.metaLayers - start, maxMetaPanels);
        const baseField = s.baseSField;
        const getMeta = (idx: number) => {
          const offset = idx * cells;
          if (s.metaField.length < offset + cells) return null;
          return s.metaField.subarray(offset, offset + cells);
        };
        const statsList: Array<{ id: string; label: string; stats: SafeSetStats }> | null =
          shouldUpdateSStackStats ? [] : null;
        const addStats = statsList
          ? (id: string, label: string, field: Uint8Array) => {
              statsList.push({ id, label, stats: computeSafeSetStats(field, safeThreshold) });
            }
          : null;
        let nextDiffMean: number | null = sStackDiffMean;
        if (sStackMode === "layers") {
          const baseCanvas = sStackRefs.current["sstack_base"];
          if (baseCanvas) {
            drawFieldHeatmap(baseCanvas, baseField, grid, paramsApplied.lS);
            // Draw evidence overlays on sStack base canvas
            if (evidenceOverlaysOn) {
              const maint = maintRef.current;
              const evidenceEnv: EvidenceEnv = {
                gridSize: grid,
                totalSteps: totalSteps + (s.steps > 0 ? s.steps : 0),
                certPassed,
                canvasWidth: baseCanvas.width,
                canvasHeight: baseCanvas.height,
                maintenance: {
                  errF0_5: maint.errF0_5,
                  badCells: maint.badCells,
                  tau: maint.badTau,
                  badCellIdx: maint.badCellIdx,
                },
                context: { sStackMode: "layers" },
              };
              drawEvidenceOverlays("sStackBase", baseCanvas, evidenceEnv);
            }
          }
          if (addStats) addStats("sstack_base", "Base", baseField);
          if (shouldUpdateSStackStats) {
            nextDiffMean = null;
          }
          for (let i = 0; i < metaCount; i++) {
            const layerIndex = start + i;
            const metaField = getMeta(layerIndex);
            if (!metaField) continue;
            const id = `sstack_meta_${layerIndex}`;
            const canvas = sStackRefs.current[id];
            if (canvas) {
              drawFieldHeatmap(canvas, metaField, grid, paramsApplied.lS);
              // Draw evidence overlays on meta layer canvas (only for meta0)
              if (evidenceOverlaysOn && layerIndex === 0) {
                const maint = maintRef.current;
                const evidenceEnv: EvidenceEnv = {
                  gridSize: grid,
                  totalSteps: totalSteps + (s.steps > 0 ? s.steps : 0),
                  certPassed,
                  canvasWidth: canvas.width,
                  canvasHeight: canvas.height,
                  maintenance: {
                    errF0_5: maint.errF0_5,
                    badCells: maint.badCells,
                    tau: maint.badTau,
                  },
                  context: { sStackMode: "layers", sStackLayerIndex: layerIndex },
                };
                drawEvidenceOverlays("sStackMeta:0", canvas, evidenceEnv);
              }
            }
            if (addStats) addStats(id, `Meta ${layerIndex}`, metaField);
          }
        } else if (sStackMode === "diff_base") {
          const meta0 = getMeta(0);
          const baseCanvas = sStackRefs.current["sstack_base"];
          if (baseCanvas) {
            drawFieldHeatmap(baseCanvas, baseField, grid, paramsApplied.lS);
            // Draw evidence overlays on sStack base canvas
            if (evidenceOverlaysOn) {
              const maint = maintRef.current;
              const evidenceEnv: EvidenceEnv = {
                gridSize: grid,
                totalSteps: totalSteps + (s.steps > 0 ? s.steps : 0),
                certPassed,
                canvasWidth: baseCanvas.width,
                canvasHeight: baseCanvas.height,
                maintenance: {
                  errF0_5: maint.errF0_5,
                  badCells: maint.badCells,
                  tau: maint.badTau,
                  badCellIdx: maint.badCellIdx,
                },
                context: { sStackMode: "diff_base" },
              };
              drawEvidenceOverlays("sStackBase", baseCanvas, evidenceEnv);
            }
          }
          if (addStats) addStats("sstack_base", "Base", baseField);
          if (meta0) {
            const metaCanvas = sStackRefs.current["sstack_meta_0"];
            if (metaCanvas) {
              drawFieldHeatmap(metaCanvas, meta0, grid, paramsApplied.lS);
              // Draw evidence overlays on meta0 canvas
              if (evidenceOverlaysOn) {
                const maint = maintRef.current;
                const evidenceEnv: EvidenceEnv = {
                  gridSize: grid,
                  totalSteps: totalSteps + (s.steps > 0 ? s.steps : 0),
                  certPassed,
                  canvasWidth: metaCanvas.width,
                  canvasHeight: metaCanvas.height,
                  maintenance: {
                    errF0_5: maint.errF0_5,
                    badCells: maint.badCells,
                    tau: maint.badTau,
                  },
                  context: { sStackMode: "diff_base" },
                };
                drawEvidenceOverlays("sStackMeta:0", metaCanvas, evidenceEnv);
              }
            }
            if (addStats) addStats("sstack_meta_0", "Meta 0", meta0);
            const diffCanvas = sStackRefs.current["sstack_diff_base0"];
            if (diffCanvas) {
              drawFieldAbsDiffHeatmap(diffCanvas, baseField, meta0, grid, paramsApplied.lS);
              // Draw evidence overlays on sStack diff canvas
              if (evidenceOverlaysOn) {
                const maint = maintRef.current;
                const evidenceEnv: EvidenceEnv = {
                  gridSize: grid,
                  totalSteps: totalSteps + (s.steps > 0 ? s.steps : 0),
                  certPassed,
                  canvasWidth: diffCanvas.width,
                  canvasHeight: diffCanvas.height,
                  maintenance: {
                    errF0_5: maint.errF0_5,
                    badCells: maint.badCells,
                    tau: maint.badTau,
                    badCellIdx: maint.badCellIdx,
                  },
                  context: {
                    sStackMode: "diff_base",
                    sStackDiffKind: "base0",
                  },
                };
                drawEvidenceOverlays("sStackDiff", diffCanvas, evidenceEnv);
              }
              if (injuryMapOn) {
                const maint = maintRef.current;
                const damagePct = cells > 0 ? maint.badCells / cells : null;
                const legend = [
                  "Injury map",
                  `τ = ${maint.badTau}`,
                  `bad = ${maint.badCells}${damagePct !== null ? ` (${(damagePct * 100).toFixed(1)}%)` : ""}`,
                  maint.badCellUpdatedAt ? `@${maint.badCellUpdatedAt}` : "",
                ].filter((line) => line !== "");
                drawInjuryMapOverlay(diffCanvas.getContext("2d"), grid, maint.badCellIdx, legend);
              }
            }
            if (shouldUpdateSStackStats) {
              nextDiffMean = meanAbsDiff(baseField, meta0, cells);
            }
          } else if (shouldUpdateSStackStats) {
            nextDiffMean = null;
          }
        } else if (sStackMode === "diff_meta" && s.metaLayers >= 2) {
          const maxPair = Math.max(0, s.metaLayers - 2);
          const k = Math.max(0, Math.min(sStackDiffIndex, maxPair));
          const metaA = getMeta(k);
          const metaB = getMeta(k + 1);
          if (metaA) {
            const canvasA = sStackRefs.current[`sstack_meta_${k}`];
            if (canvasA) {
              drawFieldHeatmap(canvasA, metaA, grid, paramsApplied.lS);
            }
            if (addStats) addStats(`sstack_meta_${k}`, `Meta ${k}`, metaA);
          }
          if (metaB) {
            const canvasB = sStackRefs.current[`sstack_meta_${k + 1}`];
            if (canvasB) {
              drawFieldHeatmap(canvasB, metaB, grid, paramsApplied.lS);
            }
            if (addStats) addStats(`sstack_meta_${k + 1}`, `Meta ${k + 1}`, metaB);
          }
          if (metaA && metaB) {
            const diffCanvas = sStackRefs.current["sstack_diff_meta_pair"];
            if (diffCanvas) {
              drawFieldAbsDiffHeatmap(diffCanvas, metaA, metaB, grid, paramsApplied.lS);
              // Draw evidence overlays on sStack diff canvas
              if (evidenceOverlaysOn) {
                const maint = maintRef.current;
                const evidenceEnv: EvidenceEnv = {
                  gridSize: grid,
                  totalSteps: totalSteps + (s.steps > 0 ? s.steps : 0),
                  certPassed,
                  canvasWidth: diffCanvas.width,
                  canvasHeight: diffCanvas.height,
                  maintenance: {
                    errF0_5: maint.errF0_5,
                    badCells: maint.badCells,
                    tau: maint.badTau,
                    badCellIdx: maint.badCellIdx,
                  },
                  context: {
                    sStackMode: "diff_meta",
                    sStackDiffKind: "metaPair",
                  },
                };
                drawEvidenceOverlays("sStackDiff", diffCanvas, evidenceEnv);
              }
            }
            if (shouldUpdateSStackStats) {
              nextDiffMean = meanAbsDiff(metaA, metaB, cells);
            }
          } else if (shouldUpdateSStackStats) {
            nextDiffMean = null;
          }
        }
        if (statsList) {
          setLayerSafeStats(statsList);
        }
        if (shouldUpdateSStackStats) {
          setSStackDiffMean(nextDiffMean ?? null);
        }
      } else if (layerSafeStats.length > 0 || sStackDiffMean !== null) {
        setLayerSafeStats([]);
        setSStackDiffMean(null);
      }

      const storyRuntime = storyRef.current;
      if (!storyRuntime.compareOn && (storyRuntime.phase === "warming" || storyRuntime.phase === "recovering")) {
        const scenario = STORY_SCENARIOS[storyRuntime.scenarioId];
        const stepsNow = epStepCounterRef.current;
        if (storyRuntime.phase === "warming") {
          const nextStatus = `Story: warming ${stepsNow}/${scenario.warmupSteps}`;
          updateStoryStatus(nextStatus);
          if (!storyRuntime.injuryTriggered && stepsNow >= storyRuntime.injuryAt) {
            storyRuntime.injuryTriggered = true;
            storyRuntime.phase = "recovering";
            setStoryPhase("recovering");
            updateStoryStatus(`Story: injury triggered @ ${stepsNow}`);
            triggerPerturb(scenario.perturbMode);
          }
        } else if (storyRuntime.phase === "recovering") {
          const progress = Math.max(0, stepsNow - storyRuntime.injuryAt);
          updateStoryStatus(`Story: recovering ${progress}/${scenario.recoverySteps}`);
          if (stepsNow >= storyRuntime.endAt) {
            if (scenario.autoPause) {
              client.send({ type: "pause" });
              setStatus("ready");
            }
            storyRuntime.phase = "done";
            setStoryPhase("done");
            updateStoryStatus("Story: complete");
          }
        }
      }

      const maintStepNow = epStepCounterRef.current;
      const forceMaint = maintForceComputeRef.current;
      if (
        epExactByMoveNow &&
        (forceMaint || (maintStepNow > 0 && maintStepNow - maintRef.current.lastStep >= MAINT_EVERY_STEPS))
      ) {
        if (forceMaint) {
          maintForceComputeRef.current = false;
        }
        const maint = maintRef.current;
        const windowSteps = Math.max(0, maintStepNow - maint.lastStep);
        const epRepairTotal =
          (epExactByMoveNow[MOVE_P5_BASE] ?? 0) + (epExactByMoveNow[MOVE_P5_META] ?? 0);
        const epClockTotal = epExactByMoveNow[MOVE_CLOCK] ?? 0;
        const epRepairRate =
          maint.lastStep > 0 && windowSteps > 0 ? (epRepairTotal - maint.lastEpRepair) / windowSteps : null;
        const epClockRate =
          maint.lastStep > 0 && windowSteps > 0 ? (epClockTotal - maint.lastEpClock) / windowSteps : null;
        const noiseExpectedEdits =
          paramsApplied.codeNoiseRate *
          windowSteps *
          Math.max(1, Math.floor(paramsApplied.codeNoiseBatch || 1));

        let sdiffBase: number | null = null;
        let errF0_5: number | null = null;
        let badCellCount = 0;
        let badCellIdxArr: Uint32Array<ArrayBufferLike> = new Uint32Array(0);
        if (paramsApplied.metaLayers >= 1 && cells > 0 && s.metaField.length >= cells) {
          const meta0 = s.metaField.subarray(0, cells);
          sdiffBase = meanAbsDiff(s.baseSField, meta0, cells);
          errF0_5 = computeErrF05(
            s.baseSField,
            meta0,
            grid,
            paramsApplied.lS,
            MAINT_TRIALS,
            MAINT_ERR_FRAC,
            maint.seed++
          );
          const mask = computeBadCellMask(s.baseSField, meta0, cells, MAINT_BAD_CELL_TAU);
          badCellCount = mask.count;
          badCellIdxArr = mask.indices;
        }
        // Store bad cell data for evidence overlays
        maint.badCells = badCellCount;
        maint.badCellIdx = badCellIdxArr;
        maint.badTau = MAINT_BAD_CELL_TAU;
        maint.errF0_5 = errF0_5;

        let recoverySteps = maint.recoverySteps;
        if (maint.lastPerturbStep !== null && recoverySteps === null) {
          const errOk =
            errF0_5 !== null &&
            maint.baselineErr !== null &&
            errF0_5 <= maint.baselineErr * 1.1;
          const sdiffOk =
            sdiffBase !== null &&
            maint.baselineSdiff !== null &&
            sdiffBase <= maint.baselineSdiff * 1.1;
          if ((errOk || sdiffOk) && maintStepNow >= maint.lastPerturbStep) {
            recoverySteps = maintStepNow - maint.lastPerturbStep;
          }
        }

        maint.lastStep = maintStepNow;
        maint.lastEpRepair = epRepairTotal;
        maint.lastEpClock = epClockTotal;
        maint.recoverySteps = recoverySteps;

        const nextMaint = {
          errF0_5,
          sdiffBase,
          epRepairRate,
          epClockRate,
          noiseExpectedEdits,
          lastPerturbStep: maint.lastPerturbStep,
          recoverySteps,
        };
        setMaintStats(nextMaint);

        const histories = maintHistoryRef.current;
        if (errF0_5 !== null && Number.isFinite(errF0_5)) {
          histories.err.push(errF0_5);
          if (histories.err.length > MAINT_SERIES_CAP) histories.err.shift();
          const canvas = maintCanvasRefs.current["maint_err"];
          if (canvas) drawSparkline(canvas, histories.err, "rgba(255, 180, 140, 0.85)");
        }
        if (sdiffBase !== null && Number.isFinite(sdiffBase)) {
          histories.sdiff.push(sdiffBase);
          if (histories.sdiff.length > MAINT_SERIES_CAP) histories.sdiff.shift();
          const canvas = maintCanvasRefs.current["maint_sdiff"];
          if (canvas) drawSparkline(canvas, histories.sdiff, "rgba(160, 220, 140, 0.85)");
        }
        if (epRepairRate !== null && Number.isFinite(epRepairRate)) {
          histories.repair.push(epRepairRate);
          if (histories.repair.length > MAINT_SERIES_CAP) histories.repair.shift();
          const canvas = maintCanvasRefs.current["maint_repair"];
          if (canvas) drawSparkline(canvas, histories.repair, "rgba(140, 200, 255, 0.85)");
        }
          histories.damage.push(badCellCount);
          if (histories.damage.length > MAINT_SERIES_CAP) histories.damage.shift();
        const trendWindow = 8;
        const trendEps = 0.5;
        let trendPerSample: number | null = null;
        let trendLabel = "—";
        if (histories.damage.length >= trendWindow) {
          const start = histories.damage[histories.damage.length - trendWindow] ?? badCellCount;
          const end = histories.damage[histories.damage.length - 1] ?? badCellCount;
          trendPerSample = (end - start) / (trendWindow - 1);
          if (trendPerSample < -trendEps) trendLabel = "healing";
          else if (trendPerSample > trendEps) trendLabel = "worsening";
          else trendLabel = "stable";
        }
        const damagePct = cells > 0 ? badCellCount / cells : null;
        const nextHud: LifeHudState = {
          updatedAtSteps: maintStepNow,
          damageCells: badCellCount,
          damagePct,
          trendPerSample,
          trendLabel,
          epExactRate: currentEpExactRate,
          epRepairRate,
        };
        maint.badCellUpdatedAt = maintStepNow;
        lifeHudNow = nextHud;
        lifeHudRef.current = nextHud;
        setLifeHud(nextHud);

        const warmMaint = epStepCounterRef.current >= 200000;
        if (warmMaint) {
          const errOk = errF0_5 !== null && errF0_5 <= 0.1;
          const sdiffOk = sdiffBase !== null && sdiffBase <= 2.0;
          const epOk = currentEpExactRate !== null && currentEpExactRate >= 1e-3;
          codeMaintPassNow = errOk && sdiffOk && epOk;
        } else {
          codeMaintPassNow = false;
        }
      }

      const injuryMaskEligible =
        injuryMapOn &&
        cells > 0 &&
        cells <= INJURY_MASK_MAX_CELLS &&
        paramsApplied.metaLayers >= 1 &&
        s.metaField.length >= cells;
      if (injuryMaskEligible) {
        const storyPhaseNow = storyRef.current.phase;
        const isStoryActive = storyPhaseNow === "warming" || storyPhaseNow === "recovering";
        const stepNowForMask = epStepCounterRef.current;
        const due =
          stepNowForMask - injuryMaskStepRef.current >= INJURY_MASK_EVERY_STEPS ||
          (isStoryActive && injuryMaskStepRef.current === 0);
        if (due) {
          const meta0 = s.metaField.subarray(0, cells);
          const mask = computeBadCellMask(s.baseSField, meta0, cells, MAINT_BAD_CELL_TAU);
          maintRef.current.badCells = mask.count;
          maintRef.current.badCellIdx = mask.indices;
          maintRef.current.badTau = MAINT_BAD_CELL_TAU;
          maintRef.current.badCellUpdatedAt = stepNowForMask;
          injuryMaskStepRef.current = stepNowForMask;
        }
      }

      if (compareOn && storyRef.current.compareOn && storyRef.current.phase !== "idle") {
        const canvasA = abDiffARef.current;
        if (canvasA && cells > 0 && s.metaField.length >= cells) {
          const meta0 = s.metaField.subarray(0, cells);
          drawFieldAbsDiffHeatmap(canvasA, s.baseSField, meta0, grid, paramsApplied.lS);
          if (injuryMapOn) {
            const maint = maintRef.current;
            const damagePct = cells > 0 ? maint.badCells / cells : null;
            const legend = [
              "Injury map",
              `τ = ${MAINT_BAD_CELL_TAU}`,
              `bad = ${maint.badCells}${damagePct !== null ? ` (${(damagePct * 100).toFixed(1)}%)` : ""}`,
              maint.badCellUpdatedAt ? `@${maint.badCellUpdatedAt}` : "",
            ].filter((line) => line !== "");
            drawInjuryMapOverlay(canvasA.getContext("2d"), grid, maint.badCellIdx, legend);
          }
        }
      }
      if (abRef.current.enabled && abRef.current.awaitingA) {
        abRef.current.awaitingA = false;
      }
      if (abRef.current.enabled) {
        maybeAdvanceAb();
      }

      const isNullConfig = !p3Enabled && !p6Enabled;
      const warmedUp = epStepCounterRef.current >= CERT_MIN_STEPS;
      const counts = certCountsRef.current;
      const updateStable = (
        key: "epNull" | "sigmaNull" | "m6Null" | "clockNull" | "tur" | "opkBudget" | "codeMaint",
        passNow: boolean
      ) => {
        counts[key] = passNow ? counts[key] + 1 : 0;
        return counts[key] >= CERT_STABILITY_K;
      };

      const next = { ...certPassed };
      if (isNullConfig) {
        const epPassNow =
          warmedUp &&
          currentEpExactRate !== null &&
          Math.abs(currentEpExactRate) <= CERT_EP_EXACT_RATE_ABS_MAX;
        const sigmaPassNow =
          warmedUp && Math.abs(s.diagnostics.sigmaMem) <= CERT_SIGMA_MEM_ABS_MAX;
        const m6Max = Math.max(
          Math.abs(s.diagnostics.aM6W),
          Math.abs(s.diagnostics.aM6N),
          Math.abs(s.diagnostics.aM6A),
          Math.abs(s.diagnostics.aM6S),
        );
        const m6PassNow = warmedUp && m6Max <= CERT_M6_ABS_MAX;
        next.epNull = updateStable("epNull", epPassNow);
        next.sigmaNull = updateStable("sigmaNull", sigmaPassNow);
        next.m6Null = updateStable("m6Null", m6PassNow);
      } else {
        counts.epNull = 0;
        counts.sigmaNull = 0;
        counts.m6Null = 0;
        next.epNull = false;
        next.sigmaNull = false;
        next.m6Null = false;
      }

      const clockNullGate = paramsApplied.clockOn >= 0.5 && isNullConfig;
      if (clockNullGate) {
        const stepsTotal = epStepCounterRef.current;
        const clockDriftNow = clockQ !== null && stepsTotal > 0 ? clockQ / stepsTotal : null;
        const clockPassNow =
          stepsTotal >= CERT_CLOCK_NULL_MIN_STEPS &&
          clockDriftNow !== null &&
          Math.abs(clockDriftNow) <= CERT_CLOCK_NULL_DRIFT_ABS_MAX;
        next.clockNull = updateStable("clockNull", clockPassNow);
      } else {
        counts.clockNull = 0;
        next.clockNull = false;
      }

      const turGate = paramsApplied.clockOn >= 0.5 && p6Enabled;
      if (turGate) {
        const turPassNow =
          turStatsNow !== null &&
          turStatsNow.blocks >= CERT_TUR_MIN_BLOCKS &&
          Math.abs(turStatsNow.meanQ) >= CERT_TUR_MIN_MEANQ &&
          turStatsNow.R >= CERT_TUR_R_MIN;
        next.tur = updateStable("tur", turPassNow);
      } else {
        counts.tur = 0;
        next.tur = false;
      }

      const opkGate = paramsApplied.opCouplingOn >= 0.5 && paramsApplied.metaLayers >= 1;
      if (opkGate) {
        const opkCurrent = opkStatsRef.current;
        const opkPassNow = opkCurrent !== null && opkCurrent.budgetOk;
        next.opkBudget = updateStable("opkBudget", opkPassNow);
      } else {
        counts.opkBudget = 0;
        next.opkBudget = false;
      }

      const codeMaintGate = paramsApplied.metaLayers >= 2 && p6Enabled;
      if (codeMaintGate) {
        if (codeMaintPassNow !== null) {
          next.codeMaint = updateStable("codeMaint", codeMaintPassNow);
        } else {
          next.codeMaint = certPassed.codeMaint;
        }
      } else {
        counts.codeMaint = 0;
        next.codeMaint = false;
      }

      if (
        next.epNull !== certPassed.epNull ||
        next.sigmaNull !== certPassed.sigmaNull ||
        next.m6Null !== certPassed.m6Null ||
        next.clockNull !== certPassed.clockNull ||
        next.tur !== certPassed.tur ||
        next.opkBudget !== certPassed.opkBudget ||
        next.codeMaint !== certPassed.codeMaint
      ) {
        setCertPassed(next);
      }

      if (lifeHudOn && canvas) {
        const hud = lifeHudNow ?? lifeHudRef.current;
        const ctx = hud ? canvas.getContext("2d") : null;
        if (ctx && hud) {
          drawLifeHud(ctx, hud);
        }
      }

      // Draw evidence overlays on main canvas (after cert evaluation for responsiveness)
      if (evidenceOverlaysOn && canvas) {
        const maint = maintRef.current;
        // Compute stamp scalars for non-spatial certs
        const m6Max = Math.max(
          Math.abs(s.diagnostics.aM6W),
          Math.abs(s.diagnostics.aM6N),
          Math.abs(s.diagnostics.aM6A),
          Math.abs(s.diagnostics.aM6S),
        );
        const stepsTotal = epStepCounterRef.current;
        const clockDriftNow = clockQ !== null && stepsTotal > 0 ? clockQ / stepsTotal : null;

        const evidenceEnv: EvidenceEnv = {
          gridSize: grid,
          totalSteps: totalSteps + (s.steps > 0 ? s.steps : 0),
          certPassed: next, // Use computed next state for immediate responsiveness
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
          maintenance: {
            errF0_5: maint.errF0_5,
            badCells: maint.badCells,
            tau: maint.badTau,
            badCellIdx: maint.badCellIdx,
          },
          stamps: {
            epExactRate: currentEpExactRate,
            epExactRateMax: CERT_EP_EXACT_RATE_ABS_MAX,
            sigmaMem: s.diagnostics.sigmaMem,
            sigmaMemMax: CERT_SIGMA_MEM_ABS_MAX,
            m6MaxAbs: m6Max,
            m6MaxAbsMax: CERT_M6_ABS_MAX,
            clockDrift: clockDriftNow,
            clockDriftMax: CERT_CLOCK_NULL_DRIFT_ABS_MAX,
            turR: turStatsNow?.R ?? null,
            turRMin: CERT_TUR_R_MIN,
            turRMax: 2.0,
          },
        };
        drawEvidenceOverlays("mainCanvas", canvas, evidenceEnv);
      }

      chartStepRef.current += Math.max(0, s.steps);
      if (chartStepRef.current >= recordEverySteps) {
        chartStepRef.current = chartStepRef.current % recordEverySteps;
        const statsForCharts: GraphStats =
          stats ?? ({
            edges: 0,
            components: 0,
            largest: 0,
            sizes: [],
          });
        const safeSet = computeSafeSetStats(s.baseSField, safeThreshold);
        const ctx: ChartContext = {
          diagnostics: s.diagnostics,
          energy: s.energy,
          stats: statsForCharts,
          safeSet,
          n: s.n,
        };
        const history = historyRef.current;
        for (const chart of CHARTS) {
          const series = history[chart.id] ?? (history[chart.id] = []);
          pushHistory(series, chart.value(ctx), historyCap);
          const chartCanvas = chartRefs.current[chart.id];
          if (chartCanvas) {
            drawSparkline(chartCanvas, series, chart.color, {
              centerZero: chart.centerZero,
            });
          }
        }
        for (const hist of HISTOGRAMS) {
          const bins = hist.bins(ctx);
          const histCanvas = histRefs.current[hist.id];
          if (histCanvas) {
            drawHistogram(histCanvas, bins, hist.color);
          }
        }

        const opkCache = opkCacheRef.current;
        const opkMetaCurrent = opkMetaNow ?? opkMeta;
        if (
          paramsApplied.opCouplingOn >= 0.5 &&
          opkCache.tokens &&
          opkCache.offsets &&
          opkMetaCurrent
        ) {
          const grid = paramsApplied.gridSize;
          const cells = grid * grid;
          const { budgetK, interfaces, rCount, stencilId } = opkMetaCurrent;
          const minTokens = interfaces * cells * rCount;
          const minOffsets = rCount * 2;
          const baseLen = opkFieldRef.current.baseS.length;
          const metaLen = opkFieldRef.current.metaS.length;
          const shapeOk =
            cells > 0 &&
            rCount > 0 &&
            interfaces > 0 &&
            opkCache.tokens.length >= minTokens &&
            opkCache.offsets.length >= minOffsets &&
            baseLen >= cells &&
            metaLen >= interfaces * cells;
          if (shapeOk) {
            if (opkCache.offsetPairs.length !== rCount) {
              opkCache.offsetPairs = parseOpOffsets(opkCache.offsets);
            }
            const badCells = computeOpkBudgetBadCells(
              opkCache.tokens,
              interfaces,
              cells,
              rCount,
              budgetK
            );
            const sdiffMean = computeOpkSdiffMean({
              tokens: opkCache.tokens,
              offsets: opkCache.offsetPairs,
              grid,
              interfaces,
              rCount,
              budgetK,
              baseS: opkFieldRef.current.baseS,
              metaS: opkFieldRef.current.metaS,
              lS: opkFieldRef.current.lS,
            });
            const nextStats = {
              sdiffMean,
              budgetOk: badCells === 0,
              badCells,
              budgetK,
              interfaces,
              rCount,
              stencilId,
            };
            opkStatsRef.current = nextStats;
            setOpkStats(nextStats);
            setOpkViewVersion((v) => v + 1);
          } else {
            opkStatsRef.current = null;
            setOpkStats(null);
          }
        } else if (opkStatsRef.current !== null) {
          opkStatsRef.current = null;
          setOpkStats(null);
        }

        const align = metaAlignRef.current;
        if (align) {
          const histories = metaAlignHistoryRef.current;
          histories.sdiffBase.push(align.sdiffBase);
          histories.sdiffMeta.push(align.sdiffMeta);
          histories.wdiffMeta.push(align.wdiffMeta);
          if (histories.sdiffBase.length > META_ALIGN_SERIES_CAP) histories.sdiffBase.shift();
          if (histories.sdiffMeta.length > META_ALIGN_SERIES_CAP) histories.sdiffMeta.shift();
          if (histories.wdiffMeta.length > META_ALIGN_SERIES_CAP) histories.wdiffMeta.shift();

          const baseCanvas = metaAlignCanvasRefs.current["sdiff_base"];
          if (baseCanvas) {
            drawSparkline(baseCanvas, histories.sdiffBase, "rgba(120, 210, 160, 0.85)");
          }
          const metaCanvas = metaAlignCanvasRefs.current["sdiff_meta"];
          if (metaCanvas) {
            drawSparkline(metaCanvas, histories.sdiffMeta, "rgba(160, 200, 255, 0.85)");
          }
          const wCanvas = metaAlignCanvasRefs.current["wdiff_meta"];
          if (wCanvas) {
            drawSparkline(wCanvas, histories.wdiffMeta, "rgba(255, 160, 160, 0.85)");
          }
        }
      }

      const edges = 2 * cells;
      const metaS0 = s.metaLayers >= 1 ? s.metaField.subarray(0, cells) : null;
      const metaS1 = s.metaLayers >= 2 ? s.metaField.subarray(cells, 2 * cells) : null;
      const metaW0 = s.metaWEdges.length >= edges ? s.metaWEdges.subarray(0, edges) : null;
      const metaW1 = s.metaWEdges.length >= 2 * edges ? s.metaWEdges.subarray(edges, 2 * edges) : null;
      const epExtrasSummary = s.extras?.ep
        ? {
            exactTotal: s.extras.ep.exactTotal,
            naiveTotal: s.extras.ep.naiveTotal,
            exactByMove: s.extras.ep.exactByMove,
          }
        : undefined;
      const clockExtrasSummary = s.extras?.clock
        ? {
            q: s.extras.clock.q,
            fwd: s.extras.clock.fwd,
            bwd: s.extras.clock.bwd,
            state: s.extras.clock.state,
          }
        : undefined;
      const opkExtrasSummary = s.extras?.opk
        ? {
            enabled: s.extras.opk.enabled,
            budgetK: s.extras.opk.budgetK,
            interfaces: s.extras.opk.interfaces,
            rCount: s.extras.opk.rCount,
            stencilId: s.extras.opk.stencilId,
            computedAtSteps: s.extras.opk.computedAtSteps,
          }
        : undefined;

      addSnapshot({
        snapshotVersion: s.snapshotVersion,
        totalSteps: epStepCounterRef.current,
        n: s.n,
        energy: s.energy,
        diagnostics: s.diagnostics,
        graphStats: stats,
        positions: s.positions,
        bonds: s.bonds,
        counters: s.counters,
        apparatus: s.apparatus,
        baseSField: s.baseSField,
        metaLayers: s.metaLayers,
        metaS0,
        metaS1,
        metaW0,
        metaW1,
        extras: {
          ep: epExtrasSummary,
          clock: clockExtrasSummary,
          opk: opkExtrasSummary,
        },
        metrics: {
          epExactRateWindow: currentEpExactRate,
          certPassed: { ...certPassed },
          metaAlign: metaAlignRef.current ? { ...metaAlignRef.current } : null,
          turStats: turStatsNow ? { ...turStatsNow } : turStats ? { ...turStats } : null,
          opkStats: opkStatsRef.current ? { ...opkStatsRef.current } : null,
          maintenance: maintStats ? { ...maintStats } : null,
        },
        stepsDelta: s.steps,
      });
    });
    return () => {
      offReady();
      offErr();
      offSnap();
      // Don't terminate the worker on cleanup - we want it to survive StrictMode remounts
    };
  }, [
    client,
    colorSource,
    overlayChannel,
    overlayLayerIndex,
    bondThreshold,
    bondsEverySteps,
    paramsApplied,
    bondsMode,
    graphStatsMode,
    recordEverySteps,
    historyCap,
    safeThreshold,
    sStackMode,
    sStackDiffIndex,
    sStackMetaStart,
    stackMaxLayers,
    p3Enabled,
    p6Enabled,
    certPassed.epNull,
    certPassed.sigmaNull,
    certPassed.m6Null,
    certPassed.clockNull,
    certPassed.tur,
    certPassed.opkBudget,
    certPassed.codeMaint,
    evidenceOverlaysOn,
    lifeHudOn,
    injuryMapOn,
    compareOn,
  ]);

  useEffect(() => {
    if (status === "initializing") {
      historyRef.current = {};
      chartStepRef.current = 0;
      sStackStatsStepRef.current = 0;
      epStepCounterRef.current = 0;
      epWindowRef.current = [];
      bondsCacheRef.current = new Uint32Array();
      graphStatsRef.current = null;
      lastNRef.current = n;
      lastBondsRefreshStepsRef.current = null;
      certCountsRef.current = {
        epNull: 0,
        sigmaNull: 0,
        m6Null: 0,
        clockNull: 0,
        tur: 0,
        opkBudget: 0,
        codeMaint: 0,
      };
      maintHistoryRef.current = { err: [], sdiff: [], repair: [], damage: [] };
      maintForceComputeRef.current = false;
      lifeHudRef.current = null;
      injuryMaskStepRef.current = 0;
      maintRef.current = {
        lastStep: 0,
        lastEpRepair: 0,
        lastEpClock: 0,
        lastPerturbStep: null,
        baselineErr: null,
        baselineSdiff: null,
        recoverySteps: null,
        seed: 1234567,
        badCells: 0,
        badCellIdx: new Uint32Array(0) as Uint32Array<ArrayBufferLike>,
        badTau: MAINT_BAD_CELL_TAU,
        badCellUpdatedAt: 0,
        errF0_5: null,
      };
      metaAlignHistoryRef.current = { sdiffBase: [], sdiffMeta: [], wdiffMeta: [] };
      metaAlignRef.current = null;
      turRef.current = { lastStep: 0, lastQ: 0, lastSigma: 0, samplesQ: [], samplesSigma: [] };
      opkCacheRef.current = { tokens: null, offsets: null, offsetPairs: [] };
      opkMetaRef.current = null;
      opkFieldRef.current = { baseS: new Uint8Array(), metaS: new Uint8Array(), grid: 0, lS: 1, metaLayers: 0 };
      opkStatsRef.current = null;
      setGraphStats(null);
      setGraphStatsN(null);
      setTotalSteps(0);
      setEpExactTotal(null);
      setEpNaiveTotal(null);
      setEpExactRate(null);
      setEpNaiveRate(null);
      setClockDebug(null);
      setTurStats(null);
      setOpkMeta(null);
      setOpkStats(null);
      setOpkPayloadVersion(0);
      setOpkViewVersion(0);
      setOpkViewStatus("waiting");
      setMaintStats(null);
      setLifeHud(null);
      setLayerSafeStats([]);
      setSStackDiffMean(null);
      setMetaAlign(null);
      setMetaAlignBaseline(null);
      setCertPassed({
        epNull: false,
        sigmaNull: false,
        m6Null: false,
        clockNull: false,
        tur: false,
        opkBudget: false,
        codeMaint: false,
      });
    }
  }, [status]);

  useEffect(() => {
    injuryMapOnRef.current = injuryMapOn;
  }, [injuryMapOn]);

  // Note: We don't terminate the singleton worker - it lives for the page lifetime

  useEffect(() => {
    if (status !== "initializing") {
      setInitSlow(false);
      return;
    }
    const t = window.setTimeout(() => setInitSlow(true), 5000);
    return () => window.clearTimeout(t);
  }, [status]);

  useEffect(() => {
    if (!compareOn) {
      if (clientBRef.current) {
        clientBRef.current.terminate();
        clientBRef.current = null;
      }
      abRef.current.enabled = false;
      storyRef.current.compareOn = false;
      setCompareReady(false);
      return;
    }
    if (clientBRef.current) return;
    setCompareReady(false);
    const clientB = new SimWorkerClient();
    clientBRef.current = clientB;
    const offReady = clientB.onReady(() => {
      setCompareReady(true);
      handleAbReady("B");
    });
    const offSnap = clientB.onSnapshot((s) => handleBSnapshot(s));
    const offErr = clientB.onError((m) => setError(`B: ${m}`));
    return () => {
      offReady();
      offSnap();
      offErr();
      clientB.terminate();
      clientBRef.current = null;
      setCompareReady(false);
    };
  }, [compareOn]);

  useEffect(() => {
    if (status === "idle" || status === "initializing") return;
    client.send({ type: "config", bondThreshold, params: paramsApplied, bondsEverySteps });
  }, [bondThreshold, bondsEverySteps, client, paramsApplied, status]);

  useEffect(() => {
    if (graphStatsMode !== "off") return;
    graphStatsRef.current = null;
    setGraphStats(null);
    setGraphStatsN(null);
  }, [graphStatsMode]);

  useEffect(() => {
    if (bondsMode !== "off") return;
    graphStatsRef.current = null;
    setGraphStats(null);
    setGraphStatsN(null);
    lastBondsRefreshStepsRef.current = null;
  }, [bondsMode]);

  useEffect(() => {
    // Skip truncation if unlimited (cap <= 0)
    if (historyCap <= 0) return;
    const cap = Math.max(50, Math.floor(historyCap));
    const history = historyRef.current;
    for (const series of Object.values(history)) {
      while (series.length > cap) series.shift();
    }
  }, [historyCap]);

  useEffect(() => {
    lastNRef.current = n;
  }, [n]);

  useEffect(() => {
    const layers = metaSnapshot?.layers ?? 0;
    const wantsMeta = overlayChannel.startsWith("meta");
    if (wantsMeta && layers === 0) {
      setOverlayChannel("none");
      setOverlayLayerIndex(0);
      return;
    }
    if (wantsMeta) {
      const maxLayer = Math.max(0, layers - 1);
      if (overlayLayerIndex > maxLayer) {
        setOverlayLayerIndex(maxLayer);
      } else if (overlayLayerIndex < 0) {
        setOverlayLayerIndex(0);
      }
    }
  }, [metaSnapshot, overlayChannel, overlayLayerIndex]);

  useEffect(() => {
    const maxDiff = Math.max(0, metaLayerCount - 2);
    if (sStackDiffIndex > maxDiff) {
      setSStackDiffIndex(maxDiff);
    }
    const maxStart = Math.max(0, metaLayerCount - 1);
    if (sStackMetaStart > maxStart) {
      setSStackMetaStart(maxStart);
    }
  }, [metaLayerCount, sStackDiffIndex, sStackMetaStart]);

  useEffect(() => {
    sStackStatsStepRef.current = SSTACK_STATS_EVERY_STEPS;
  }, [sStackMode, sStackMetaStart, sStackDiffIndex, stackMaxLayers, safeThreshold]);

  useEffect(() => {
    const interfaces = opkMeta?.interfaces ?? 0;
    if (interfaces <= 0) {
      if (opkInterfaceIdx !== 0) setOpkInterfaceIdx(0);
    } else if (opkInterfaceIdx > interfaces - 1) {
      setOpkInterfaceIdx(interfaces - 1);
    }
    const rCount = opkMeta?.rCount ?? 0;
    if (rCount <= 0) {
      if (opkOffsetIdx !== 0) setOpkOffsetIdx(0);
    } else if (opkOffsetIdx > rCount - 1) {
      setOpkOffsetIdx(rCount - 1);
    }
  }, [opkMeta, opkInterfaceIdx, opkOffsetIdx]);

  useEffect(() => {
    const canvas = opkCanvasRef.current;
    const histCanvas = opkHistCanvasRef.current;
    if (!canvas || !histCanvas) return;
    const clearCanvases = () => {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      const hctx = histCanvas.getContext("2d");
      if (hctx) hctx.clearRect(0, 0, histCanvas.width, histCanvas.height);
    };
    if (paramsApplied.opCouplingOn < 0.5) {
      clearCanvases();
      setOpkViewStatus("waiting");
      return;
    }
    const cache = opkCacheRef.current;
    const tokens = cache.tokens;
    if (cache.offsetPairs.length === 0 && cache.offsets) {
      cache.offsetPairs = parseOpOffsets(cache.offsets);
    }
    const offsets = cache.offsetPairs;
    const meta = opkMeta;
    const grid = opkFieldRef.current.grid || paramsApplied.gridSize;
    const cells = grid * grid;
    if (!tokens || !cache.offsets || !meta) {
      clearCanvases();
      setOpkViewStatus("waiting");
      return;
    }
    if (cells <= 0 || cells > OPK_VIEW_MAX_CELLS) {
      clearCanvases();
      setOpkViewStatus("waiting");
      return;
    }
    const { budgetK, interfaces, rCount } = meta;
    if (interfaces <= 0 || rCount <= 0) return;
    const expectedTokensLen = interfaces * cells * rCount;
    const expectedOffsetsLen = rCount * 2;
    const baseLen = opkFieldRef.current.baseS.length;
    const metaLen = opkFieldRef.current.metaS.length;
    if (
      tokens.length < expectedTokensLen ||
      (cache.offsets?.length ?? 0) < expectedOffsetsLen ||
      baseLen < cells ||
      metaLen < interfaces * cells
    ) {
      clearCanvases();
      setOpkViewStatus("mismatch");
      return;
    }
    setOpkViewStatus("ok");
    const field =
      opkViewMode === "tokens"
        ? buildOpkTokenMap(tokens, opkInterfaceIdx, opkOffsetIdx, cells, rCount)
        : opkViewMode === "total"
          ? buildOpkTotalMap(tokens, opkInterfaceIdx, cells, rCount)
          : buildOpkMismatchMap({
              tokens,
              offsets,
              grid,
              interfaceIdx: opkInterfaceIdx,
              rCount,
              budgetK,
              baseS: opkFieldRef.current.baseS,
              metaS: opkFieldRef.current.metaS,
              lS: opkFieldRef.current.lS,
              diffMax: OPK_DIFF_MAX,
            });
    const maxValue = opkViewMode === "mismatch" ? 255 : budgetK;
    drawFieldHeatmap(canvas, field, grid, maxValue);
    // Draw evidence overlays on opK heatmap (cadence-driven: only when base redraws)
    if (evidenceOverlaysOn) {
      const opkStatsNow = opkStatsRef.current;
      const evidenceEnv: EvidenceEnv = {
        gridSize: grid,
        totalSteps,
        certPassed,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        opk: {
          badCells: opkStatsNow?.badCells ?? 0,
          budgetK: meta?.budgetK ?? budgetK,
          computedAtSteps: meta?.computedAtSteps,
        },
      };
      drawEvidenceOverlays("opkHeatmap", canvas, evidenceEnv);
    }

    const budget = Math.max(1, Math.min(255, budgetK));
    const bins = new Array(budget + 1).fill(0);
    const ifaceStart = opkHistAll ? 0 : opkInterfaceIdx;
    const ifaceEnd = opkHistAll ? interfaces : opkInterfaceIdx + 1;
    const span = cells * rCount;
    for (let iface = ifaceStart; iface < ifaceEnd; iface += 1) {
      const base = iface * span;
      for (let i = 0; i < span; i += 1) {
        const v = tokens[base + i] ?? 0;
        if (v <= budget) bins[v] += 1;
      }
    }
    drawHistogram(histCanvas, bins, "rgba(160, 200, 255, 0.85)");
  }, [
    opkViewMode,
    opkInterfaceIdx,
    opkOffsetIdx,
    opkHistAll,
    opkPayloadVersion,
    opkViewVersion,
    paramsApplied.opCouplingOn,
    paramsApplied.gridSize,
    opkMeta?.budgetK,
    opkMeta?.interfaces,
    opkMeta?.rCount,
    opkMeta?.stencilId,
    opkMeta?.computedAtSteps,
    evidenceOverlaysOn,
    certPassed,
    totalSteps,
  ]);

  const canInit = status === "idle" || status === "ready";
  const canRun = status === "ready";
  const canPause = status === "running";

  const statsById = new Map(layerSafeStats.map((entry) => [entry.id, entry.stats]));
  const stackMetaStart = Math.max(0, Math.min(sStackMetaStart, Math.max(0, metaLayerCount - 1)));
  const stackMetaCap = Math.max(0, stackMaxLayers - 1);
  const stackMetaCount = Math.min(metaLayerCount - stackMetaStart, stackMetaCap);
  const stackMetaIndices = Array.from(
    { length: Math.max(0, stackMetaCount) },
    (_, i) => stackMetaStart + i,
  );
  const diffPairMax = Math.max(0, metaLayerCount - 2);
  const diffPairIndex = Math.max(0, Math.min(sStackDiffIndex, diffPairMax));
  let sStackCards: Array<{ id: string; label: string; showStats: boolean; showDiffMean?: boolean }> = [];
  if (metaLayerCount > 0) {
    if (sStackMode === "layers") {
      sStackCards = [
        { id: "sstack_base", label: "Base", showStats: true },
        ...stackMetaIndices.map((idx) => ({
          id: `sstack_meta_${idx}`,
          label: `Meta ${idx}`,
          showStats: true,
        })),
      ];
    } else if (sStackMode === "diff_base") {
      sStackCards = [
        { id: "sstack_base", label: "Base", showStats: true },
        { id: "sstack_meta_0", label: "Meta 0", showStats: true },
        { id: "sstack_diff_base0", label: "|Base − Meta0|", showStats: false, showDiffMean: true },
      ];
    } else {
      sStackCards = [
        { id: `sstack_meta_${diffPairIndex}`, label: `Meta ${diffPairIndex}`, showStats: true },
        { id: `sstack_meta_${diffPairIndex + 1}`, label: `Meta ${diffPairIndex + 1}`, showStats: true },
        { id: "sstack_diff_meta_pair", label: "|Meta k − Meta k+1|", showStats: false, showDiffMean: true },
      ];
    }
  }

  const metaAlignCurrent = metaAlign;
  const formatDelta = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
  const pinBaseline = () => {
    const current = metaAlignRef.current;
    if (!current) return;
    setMetaAlignBaseline({
      step: epStepCounterRef.current,
      eta: paramsApplied.eta,
      sdiffBase: current.sdiffBase,
      sdiffMeta: current.sdiffMeta,
      wdiffMeta: current.wdiffMeta,
    });
  };
  const updateStoryStatus = (next: string) => {
    if (storyStatusRef.current !== next) {
      storyStatusRef.current = next;
      setStoryStatus(next);
    }
  };
  const resetAbState = () => {
    const ab = abRef.current;
    ab.enabled = true;
    ab.readyA = false;
    ab.readyB = false;
    ab.configuredA = false;
    ab.configuredB = false;
    ab.inFlight = false;
    ab.awaitingA = false;
    ab.awaitingB = false;
    ab.totalSteps = 0;
    ab.injuryTriggered = false;
    ab.badCellsB = 0;
    ab.badCellIdxB = new Uint32Array(0) as Uint32Array<ArrayBufferLike>;
    ab.badCellUpdatedAtB = 0;
    ab.forceMaskB = false;
  };
  const sendAbStep = () => {
    const ab = abRef.current;
    const clientB = clientBRef.current;
    if (!ab.enabled || ab.inFlight || !clientB) return;
    ab.inFlight = true;
    ab.awaitingA = true;
    ab.awaitingB = true;
    client.send({ type: "step", steps: AB_STEP_CHUNK });
    clientB.send({ type: "step", steps: AB_STEP_CHUNK });
  };
  const maybeAdvanceAb = () => {
    const ab = abRef.current;
    if (!ab.enabled || !ab.inFlight || ab.awaitingA || ab.awaitingB) return;
    ab.inFlight = false;
    ab.totalSteps += AB_STEP_CHUNK;
    const story = storyRef.current;
    const scenario = STORY_SCENARIOS[story.scenarioId];
    if (!ab.injuryTriggered && ab.totalSteps >= story.injuryAt) {
      ab.injuryTriggered = true;
      story.phase = "recovering";
      setStoryPhase("recovering");
      updateStoryStatus(`Story: injury triggered @ ${ab.totalSteps}`);
      const injurySeed = scenario.seed * 1000 + ab.totalSteps;
      triggerPerturb(scenario.perturbMode, injurySeed, ab.totalSteps);
      const clientB = clientBRef.current;
      if (clientB) {
        clientB.send({
          type: "perturb",
          params: {
            target: "metaS",
            layer: 0,
            frac: 0.3,
            mode: scenario.perturbMode,
            seed: injurySeed,
          },
        });
        ab.forceMaskB = true;
      }
    }
    if (story.phase === "warming") {
      updateStoryStatus(`Story: warming ${ab.totalSteps}/${scenario.warmupSteps}`);
    } else if (story.phase === "recovering") {
      const progress = Math.max(0, ab.totalSteps - story.injuryAt);
      updateStoryStatus(`Story: recovering ${progress}/${scenario.recoverySteps}`);
    }
    if (ab.totalSteps >= story.endAt) {
      story.phase = "done";
      setStoryPhase("done");
      updateStoryStatus("Story: complete");
      setStatus("ready");
      return;
    }
    sendAbStep();
  };
  const handleAbReady = (side: "A" | "B") => {
    const story = storyRef.current;
    if (!story.compareOn) return;
    const ab = abRef.current;
    const bondThresholdNow = bondThresholdRef.current;
    const bondsEveryStepsNow = bondsEveryStepsRef.current;
    if (side === "A") {
      ab.readyA = true;
      if (ab.paramsA) {
        client.send({ type: "config", bondThreshold: bondThresholdNow, params: ab.paramsA, bondsEverySteps: bondsEveryStepsNow });
        ab.configuredA = true;
      }
    } else {
      ab.readyB = true;
      const clientB = clientBRef.current;
      if (clientB && ab.paramsB) {
        clientB.send({ type: "config", bondThreshold: bondThresholdNow, params: ab.paramsB, bondsEverySteps: bondsEveryStepsNow });
        ab.configuredB = true;
      }
    }
    if (ab.readyA && ab.readyB && ab.configuredA && ab.configuredB) {
      if (story.phase === "resetting") {
        story.phase = "idle";
        setStoryPhase("idle");
        updateStoryStatus(STORY_STATUS_IDLE);
        setStatus("ready");
        return;
      }
      story.phase = "warming";
      setStoryPhase("warming");
      updateStoryStatus(`Story: warming 0/${story.injuryAt}`);
      setStatus("running");
      sendAbStep();
    }
  };

  const handleBSnapshot = (s: SimSnapshot) => {
    const ab = abRef.current;
    if (!ab.enabled) return;
    if (ab.awaitingB) {
      ab.awaitingB = false;
    }
    const paramsB = ab.paramsB ?? paramsApplied;
    const grid = paramsB.gridSize;
    const cells = grid * grid;
    if (
      injuryMapOnRef.current &&
      cells > 0 &&
      cells <= INJURY_MASK_MAX_CELLS &&
      paramsB.metaLayers >= 1 &&
      s.metaField.length >= cells
    ) {
      const stepNow = ab.totalSteps + (s.steps > 0 ? s.steps : 0);
      const due =
        ab.forceMaskB ||
        ab.badCellUpdatedAtB === 0 ||
        stepNow - ab.badCellUpdatedAtB >= INJURY_MASK_EVERY_STEPS;
      if (due) {
        const meta0 = s.metaField.subarray(0, cells);
        const mask = computeBadCellMask(s.baseSField, meta0, cells, MAINT_BAD_CELL_TAU);
        ab.badCellsB = mask.count;
        ab.badCellIdxB = mask.indices;
        ab.badCellUpdatedAtB = stepNow;
        ab.forceMaskB = false;
      }
    }

    const storyPhaseNow = storyRef.current.phase;
    if (compareOn && storyPhaseNow !== "idle") {
      const canvas = abDiffBRef.current;
      if (canvas && cells > 0 && s.metaField.length >= cells) {
        const meta0 = s.metaField.subarray(0, cells);
        drawFieldAbsDiffHeatmap(canvas, s.baseSField, meta0, grid, paramsB.lS);
        if (injuryMapOnRef.current) {
          const damagePct = cells > 0 ? ab.badCellsB / cells : null;
          const legend = [
            "Injury map",
            `τ = ${MAINT_BAD_CELL_TAU}`,
            `bad = ${ab.badCellsB}${damagePct !== null ? ` (${(damagePct * 100).toFixed(1)}%)` : ""}`,
            ab.badCellUpdatedAtB ? `@${ab.badCellUpdatedAtB}` : "",
          ].filter((line) => line !== "");
          drawInjuryMapOverlay(canvas.getContext("2d"), grid, ab.badCellIdxB, legend);
        }
      }
    }

    maybeAdvanceAb();
  };
  const triggerPerturb = (
    mode: "randomize" | "zero",
    seedOverride?: number,
    stepOverride?: number
  ) => {
    const stepMark =
      typeof stepOverride === "number"
        ? stepOverride
        : epStepCounterRef.current > 0
        ? epStepCounterRef.current
        : totalSteps;
    maintRef.current.lastPerturbStep = stepMark;
    maintRef.current.recoverySteps = null;
    maintRef.current.baselineErr = maintStats?.errF0_5 ?? null;
    maintRef.current.baselineSdiff = maintStats?.sdiffBase ?? null;
    maintForceComputeRef.current = true;
    if (maintStats) {
      setMaintStats({
        ...maintStats,
        lastPerturbStep: stepMark,
        recoverySteps: null,
      });
    }
    client.send({
      type: "perturb",
      params: {
        target: "metaS",
        layer: 0,
        frac: 0.3,
        mode,
        seed: typeof seedOverride === "number" ? seedOverride : seed * 1000 + stepMark,
      },
    });
  };
  const startStory = () => {
    const scenario = STORY_SCENARIOS[storyScenarioId];
    const entry = PRESET_CATALOG.find((item) => item.id === scenario.presetId);
    if (!entry) return;
    if (compareOn) {
      const clientB = clientBRef.current;
      if (!clientB) {
        setError("Compare worker not ready yet.");
        return;
      }
      if (status === "running") {
        client.send({ type: "pause" });
      }
      setPresetId(entry.id);
      const applied = applyPreset(entry);
      const paramsB = applyCompareControl(applied, compareControl);
      storyRef.current.paramsApplied = applied;
      storyRef.current.compareOn = true;
      resetAbState();
      abRef.current.paramsA = applied;
      abRef.current.paramsB = paramsB;
      setN(scenario.n);
      setSeed(scenario.seed);
      setInjuryMapOn(true);
      setLifeHudOn(true);
      setEvidenceOverlaysOn(true);
      if (scenario.forceSStackMode) {
        setSStackMode(scenario.forceSStackMode);
        setSStackDiffIndex(0);
        setSStackMetaStart(0);
      }
      storyRef.current.scenarioId = storyScenarioId;
      storyRef.current.phase = "preparing";
      storyRef.current.injuryAt = scenario.warmupSteps;
      storyRef.current.endAt = scenario.warmupSteps + scenario.recoverySteps;
      storyRef.current.startedAt = 0;
      storyRef.current.injuryTriggered = false;
      setStoryPhase("preparing");
      updateStoryStatus("Story: preparing A/B");
      setStatus("initializing");
      client.send({ type: "init", n: scenario.n, seed: scenario.seed });
      clientB.send({ type: "init", n: scenario.n, seed: scenario.seed });
      return;
    }
    if (status === "running") {
      client.send({ type: "pause" });
    }
    setPresetId(entry.id);
    const applied = applyPreset(entry);
    storyRef.current.paramsApplied = applied;
    storyRef.current.compareOn = false;
    setN(scenario.n);
    setSeed(scenario.seed);
    setInjuryMapOn(true);
    setLifeHudOn(true);
    setEvidenceOverlaysOn(true);
    if (scenario.forceSStackMode) {
      setSStackMode(scenario.forceSStackMode);
      setSStackDiffIndex(0);
      setSStackMetaStart(0);
    }
    storyRef.current.scenarioId = storyScenarioId;
    storyRef.current.phase = "preparing";
    storyRef.current.injuryAt = scenario.warmupSteps;
    storyRef.current.endAt = scenario.warmupSteps + scenario.recoverySteps;
    storyRef.current.startedAt = 0;
    storyRef.current.injuryTriggered = false;
    setStoryPhase("preparing");
    updateStoryStatus("Story: preparing");
    setStatus("initializing");
    client.send({ type: "init", n: scenario.n, seed: scenario.seed });
  };
  const resetStory = () => {
    const scenario = STORY_SCENARIOS[storyScenarioId];
    const entry = PRESET_CATALOG.find((item) => item.id === scenario.presetId);
    if (compareOn) {
      const clientB = clientBRef.current;
      if (!clientB) {
        setError("Compare worker not ready yet.");
        return;
      }
      if (status === "running") {
        client.send({ type: "pause" });
      }
      if (entry) {
        setPresetId(entry.id);
        const applied = applyPreset(entry);
        const paramsB = applyCompareControl(applied, compareControl);
        storyRef.current.paramsApplied = applied;
        abRef.current.paramsA = applied;
        abRef.current.paramsB = paramsB;
      }
      storyRef.current.compareOn = true;
      resetAbState();
      setN(scenario.n);
      setSeed(scenario.seed);
      setInjuryMapOn(true);
      setLifeHudOn(true);
      setEvidenceOverlaysOn(true);
      if (scenario.forceSStackMode) {
        setSStackMode(scenario.forceSStackMode);
        setSStackDiffIndex(0);
        setSStackMetaStart(0);
      }
      storyRef.current.scenarioId = storyScenarioId;
      storyRef.current.phase = "resetting";
      storyRef.current.injuryAt = scenario.warmupSteps;
      storyRef.current.endAt = scenario.warmupSteps + scenario.recoverySteps;
      storyRef.current.startedAt = 0;
      storyRef.current.injuryTriggered = false;
      setStoryPhase("resetting");
      updateStoryStatus("Story: reset");
      setStatus("initializing");
      client.send({ type: "init", n: scenario.n, seed: scenario.seed });
      clientB.send({ type: "init", n: scenario.n, seed: scenario.seed });
      return;
    }
    if (status === "running") {
      client.send({ type: "pause" });
    }
    if (entry) {
      setPresetId(entry.id);
      const applied = applyPreset(entry);
      storyRef.current.paramsApplied = applied;
    }
    setN(scenario.n);
    setSeed(scenario.seed);
    setInjuryMapOn(true);
    setLifeHudOn(true);
    setEvidenceOverlaysOn(true);
    if (scenario.forceSStackMode) {
      setSStackMode(scenario.forceSStackMode);
      setSStackDiffIndex(0);
      setSStackMetaStart(0);
    }
    storyRef.current.scenarioId = storyScenarioId;
    storyRef.current.phase = "resetting";
    storyRef.current.injuryAt = scenario.warmupSteps;
    storyRef.current.endAt = scenario.warmupSteps + scenario.recoverySteps;
    storyRef.current.startedAt = 0;
    storyRef.current.injuryTriggered = false;
    setStoryPhase("resetting");
    updateStoryStatus("Story: reset");
    setStatus("initializing");
    client.send({ type: "init", n: scenario.n, seed: scenario.seed });
  };

  const showClockPanel =
    clockDebug &&
    (paramsApplied.clockOn >= 0.5 ||
      clockDebug.q !== 0 ||
      clockDebug.fwd !== 0 ||
      clockDebug.bwd !== 0);
  const clockSteps = clockDebug ? clockDebug.fwd + clockDebug.bwd : 0;
  const stepsTotal = epStepCounterRef.current > 0 ? epStepCounterRef.current : totalSteps;
  const lastBondsStep = lastBondsRefreshStepsRef.current;
  const bondsAge = lastBondsStep !== null ? Math.max(0, stepsTotal - lastBondsStep) : null;
  const bondsFreshText =
    bondsMode === "off"
      ? "graph stats disabled (edges off)"
      : lastBondsStep !== null
      ? `edges fresh @ step ${lastBondsStep}${bondsAge !== null ? ` (age ${bondsAge})` : ""}`
      : "edges not refreshed yet";
  const clockDrift = clockDebug && stepsTotal > 0 ? clockDebug.q / stepsTotal : 0;
  const turLine =
    turStats !== null
      ? `TUR blocks ${turStats.blocks} | meanΔQ ${formatTURValue(turStats.meanQ)} | varΔQ ${formatTURValue(
          turStats.varQ
        )} | meanΔΣ ${formatTURValue(turStats.meanSigma)} | R ${formatTURValue(turStats.R)}`
      : null;
  const opkDebugLine = opkStats
    ? `Sdiff_op ${formatTURValue(opkStats.sdiffMean)} | budgetOk ${
        opkStats.budgetOk ? "true" : "false"
      } | badCells ${opkStats.badCells}`
    : null;
  const opkMetaLine = opkStats
    ? `budgetK ${opkStats.budgetK} | rCount ${opkStats.rCount} | interfaces ${opkStats.interfaces} | stencil ${opkStats.stencilId}`
    : null;
  const opkViewTooLarge = paramsApplied.gridSize * paramsApplied.gridSize > OPK_VIEW_MAX_CELLS;
  const hasOpkPayload =
    opkPayloadVersion > 0 &&
    opkCacheRef.current.tokens !== null &&
    opkCacheRef.current.offsets !== null;
  const opkOffsetLabel = opkCacheRef.current.offsetPairs[opkOffsetIdx]
    ? `(${opkCacheRef.current.offsetPairs[opkOffsetIdx]![0]}, ${opkCacheRef.current.offsetPairs[opkOffsetIdx]![1]})`
    : "";
  const opkPayloadSteps = opkMeta?.computedAtSteps;
  const opkPayloadAge =
    opkPayloadSteps !== undefined && opkPayloadSteps !== null ? stepsTotal - opkPayloadSteps : null;
  const maintErrText =
    maintStats?.errF0_5 !== null && maintStats?.errF0_5 !== undefined
      ? formatTURValue(maintStats.errF0_5)
      : "n/a";
  const maintSdiffText =
    maintStats?.sdiffBase !== null && maintStats?.sdiffBase !== undefined
      ? formatTURValue(maintStats.sdiffBase)
      : "n/a";
  const maintRepairText =
    maintStats?.epRepairRate !== null && maintStats?.epRepairRate !== undefined
      ? formatTURValue(maintStats.epRepairRate)
      : "n/a";
  const maintClockText =
    maintStats?.epClockRate !== null && maintStats?.epClockRate !== undefined
      ? formatTURValue(maintStats.epClockRate)
      : "n/a";
  const maintNoiseText =
    maintStats?.noiseExpectedEdits !== null && maintStats?.noiseExpectedEdits !== undefined
      ? formatTURValue(maintStats.noiseExpectedEdits)
      : "n/a";
  const maintPerturbText =
    maintStats?.lastPerturbStep !== null && maintStats?.lastPerturbStep !== undefined
      ? `last perturb ${maintStats.lastPerturbStep}`
      : "no perturb";
  const maintRecoveryText =
    maintStats?.recoverySteps !== null && maintStats?.recoverySteps !== undefined
      ? `recovery ${maintStats.recoverySteps}`
      : "recovery n/a";

  const effectiveDraft = effectiveParams(paramsDraft);
  const activePrimitives = {
    p1: paramsApplied.pWrite > 0,
    p2: paramsApplied.pAWrite > 0,
    p3: paramsApplied.p3On > 0,
    p4: paramsApplied.pNWrite > 0,
    p5: paramsApplied.pSWrite > 0,
    p6: paramsApplied.p6On > 0,
  };
  const draftDirty = !shallowEqual(effectiveDraft, paramsApplied);

  const presetGroups = PRESET_CATALOG.reduce<Record<string, PresetEntry[]>>((acc, entry) => {
    acc[entry.group] = acc[entry.group] ?? [];
    acc[entry.group].push(entry);
    return acc;
  }, {});

  return (
    <div className="app">
      <div className="panel">
        <div className="titleRow">
          <h1>Six Birds Playground</h1>
          <div className="titleActions">
            <button
              type="button"
              className="helpBtn"
              onClick={() => setShowHelp((prev) => !prev)}
              title="How to get started"
              aria-label="How to get started"
            >
              ?
            </button>
            <button
              type="button"
              className="resetBtn"
              onClick={handleResetSettings}
              title="Reset all settings to defaults"
            >
              Reset
            </button>
          </div>
        </div>
        <div className="subtitle">github.com/ioannist/six-birds-life</div>
        {showHelp ? (
          <div className="helpBox">
            <div className="helpTitle">Getting started</div>
            <div>1) Click Init, wait for Status: ready</div>
            <div>2) Pick a preset (optional)</div>
            <div>3) Click Run (or Step)</div>
            <div>Tip: Apply params after manual edits</div>
          </div>
        ) : null}

        <div className="row">
          <div>
            <label>Particles (N)</label>
            <input
              type="number"
              min={10}
              max={5000}
              value={n}
              onChange={(e) => setN(Number(e.target.value))}
              disabled={!canInit}
            />
          </div>
          <div>
            <label>Seed</label>
            <input
              type="number"
              min={1}
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
              disabled={!canInit}
            />
          </div>
        </div>

        <div className="row">
          <button
            className="primary"
            onClick={() => {
              setError(null);
              setStatus("initializing");
              void startRun({
                n,
                seed,
                bondThreshold,
                paramsApplied,
                presetId,
                presetSourcePath: selectedPreset?.sourcePath,
                supports: selectedPreset?.supports,
                captureEverySteps: recordEverySteps,
                uiConfig: {
                  snapshotVersion: SNAPSHOT_VERSION,
                  epWindowSteps: EP_WINDOW_STEPS,
                  certStabilityK: CERT_STABILITY_K,
                  turBlockSteps: TUR_BLOCK_STEPS,
                  opkPayloadEverySteps: OPK_PAYLOAD_EVERY_STEPS,
                  maintEverySteps: MAINT_EVERY_STEPS,
                  bondsEverySteps,
                  bondsMode,
                  graphStatsMode,
                },
              });
              setCaptureEverySteps(recordEverySteps);
              client.send({ type: "init", n, seed });
            }}
            disabled={!canInit}
          >
            Init
          </button>
          <button
            onClick={() => {
              setError(null);
              client.send({ type: "step", steps: 5000 });
            }}
            disabled={status === "idle" || status === "initializing"}
          >
            Step
          </button>
        </div>

        <div className="row">
          <div>
            <label>Bond threshold (w ≥)</label>
            <input
              type="number"
              min={0}
              max={255}
              value={bondThreshold}
              onChange={(e) => setBondThreshold(Number(e.target.value))}
              disabled={status === "idle" || status === "initializing"}
            />
          </div>
          <div />
        </div>

        <div className="row">
          <div>
            <label>Primitives</label>
            <div className="primitiveToggle">
              <label>
                <input
                  type="checkbox"
                  checked={p1Enabled}
                  onChange={(e) => setP1Enabled(e.target.checked)}
                  disabled={status === "initializing"}
                />
                <span className="legendSwatch legendSwatch--P1" aria-hidden />
                <span className="primitiveLabel">P1 bond write</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={p2Enabled}
                  onChange={(e) => setP2Enabled(e.target.checked)}
                  disabled={status === "initializing"}
                />
                <span className="legendSwatch legendSwatch--P2" aria-hidden />
                <span className="primitiveLabel">P2 apparatus</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={p3Enabled}
                  onChange={(e) => setP3Enabled(e.target.checked)}
                  disabled={status === "initializing"}
                />
                <span className="legendSwatch legendSwatch--P3" aria-hidden />
                <span className="primitiveLabel">P3 protocol</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={p4Enabled}
                  onChange={(e) => setP4Enabled(e.target.checked)}
                  disabled={status === "initializing"}
                />
                <span className="legendSwatch legendSwatch--P4" aria-hidden />
                <span className="primitiveLabel">P4 counters</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={p5Enabled}
                  onChange={(e) => setP5Enabled(e.target.checked)}
                  disabled={status === "initializing"}
                />
                <span className="legendSwatch legendSwatch--P5" aria-hidden />
                <span className="primitiveLabel">P5 field</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={p6Enabled}
                  onChange={(e) => setP6Enabled(e.target.checked)}
                  disabled={status === "initializing"}
                />
                <span className="legendSwatch legendSwatch--P6" aria-hidden />
                <span className="primitiveLabel">P6 resource</span>
              </label>
            </div>
          </div>
          <div />
        </div>

        <div className="row twoCol">
          <div>
            <label>Record every (steps)</label>
            <input
              type="number"
              min={1}
              max={100000}
              value={recordEverySteps}
              onChange={(e) => {
                const v = Math.max(1, Math.floor(Number(e.target.value)));
                setRecordEverySteps(v);
                setCaptureEverySteps(v);
              }}
              disabled={status === "initializing"}
            />
            <p style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
              Affects chart sampling + run export capture.
            </p>
          </div>
          <div>
            <label>Color overlay</label>
            <select
              value={colorSource}
              onChange={(e) => setColorSource(e.target.value as "none" | "p4" | "p2")}
              disabled={status === "initializing"}
            >
              <option value="none">None</option>
              <option value="p4">P4 counters</option>
              <option value="p2">P2 apparatus</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Performance</div>
          <div className="row twoCol">
            <div>
              <label>Bonds/edges updates</label>
              <select
                value={bondsMode}
                onChange={(e) => setBondsMode(e.target.value as "live" | "chart" | "off")}
                disabled={status === "initializing"}
              >
                <option value="live">Live (every snapshot)</option>
                <option value="chart">Chart cadence</option>
                <option value="off">Off</option>
              </select>
              <p style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
                Reducing edges updates speeds up runs; graph stats depend on edges.
              </p>
            </div>
            <div>
              <label>Graph stats</label>
              <select
                value={graphStatsMode}
                onChange={(e) => setGraphStatsMode(e.target.value as "auto" | "ondemand" | "off")}
                disabled={status === "initializing"}
              >
                <option value="auto">Auto</option>
                <option value="ondemand">On-demand</option>
                <option value="off">Off</option>
              </select>
              <p style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>{bondsFreshText}</p>
              {graphStatsMode === "ondemand" ? (
                <div style={{ marginTop: 6 }}>
                  <button
                    onClick={() => {
                      const bonds = bondsCacheRef.current;
                      const nVal = lastNRef.current;
                      if (!bonds || bonds.length === 0 || nVal <= 0) {
                        graphStatsRef.current = null;
                        setGraphStats(null);
                        setGraphStatsN(null);
                        return;
                      }
                      const stats = computeGraphStats(nVal, bonds);
                      graphStatsRef.current = stats;
                      setGraphStats(stats);
                      setGraphStatsN(nVal);
                    }}
                    disabled={status === "idle" || status === "initializing" || bondsMode === "off"}
                  >
                    Compute graph stats now
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="row twoCol">
            <div>
              <label>Layer stack max layers</label>
              <input
                type="number"
                min={1}
                max={8}
                step={1}
                value={stackMaxLayers}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(8, Math.floor(Number(e.target.value))));
                  setStackMaxLayers(v);
                }}
                disabled={status === "initializing"}
              />
            </div>
            <div>
              <label>History points kept</label>
              <select
                value={historyCap}
                onChange={(e) => {
                  setHistoryCap(Number(e.target.value));
                }}
                disabled={status === "initializing"}
              >
                <option value={200}>200</option>
                <option value={400}>400</option>
                <option value={800}>800</option>
                <option value={1600}>1600</option>
                <option value={4000}>4000</option>
                <option value={0}>Unlimited ⚠️</option>
              </select>
            </div>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={evidenceOverlaysOn}
                onChange={(e) => setEvidenceOverlaysOn(e.target.checked)}
              />
              <span>Evidence overlays</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={lifeHudOn}
                onChange={(e) => setLifeHudOn(e.target.checked)}
              />
              <span>Show Life HUD</span>
            </label>
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label>Overlay channel</label>
          <select
            value={overlayChannel}
            onChange={(e) =>
              setOverlayChannel(
                e.target.value as "none" | "baseS" | "metaS" | "metaN" | "metaA" | "metaW"
              )
            }
            disabled={status === "initializing"}
          >
            <option value="none">None</option>
            <option value="baseS">Base S</option>
            <option value="metaS" disabled={metaLayerCount === 0}>
              Meta S
            </option>
            <option value="metaN" disabled={metaLayerCount === 0}>
              Meta N
            </option>
            <option value="metaA" disabled={metaLayerCount === 0}>
              Meta A
            </option>
            <option value="metaW" disabled={metaLayerCount === 0}>
              Meta W
            </option>
          </select>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label>Preset</label>
          <select
            value={presetId}
            onChange={(e) => {
              const nextId = e.target.value;
              setPresetId(nextId);
              const entry = PRESET_CATALOG.find((item) => item.id === nextId);
              if (entry) {
                applyPreset(entry);
              }
            }}
            disabled={
              status === "idle" ||
              status === "initializing" ||
              (storyPhase !== "idle" && storyPhase !== "done")
            }
          >
            {Object.entries(presetGroups).map(([group, entries]) => (
              <optgroup label={group} key={group}>
                {entries.map((entry) => (
                  <option value={entry.id} key={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {selectedPreset?.tags && selectedPreset.tags.length > 0 ? (
            <div
              style={{
                marginTop: 6,
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                fontSize: 11,
                color: "var(--muted)",
              }}
            >
              {selectedPreset.tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    padding: "2px 8px",
                    borderRadius: 999,
                    border: "1px solid var(--border)",
                    background: "rgba(255,255,255,0.04)",
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
          {selectedPreset?.blurb ? (
            <p style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>{selectedPreset.blurb}</p>
          ) : null}
          {selectedPreset?.recommendedView ? (
            <p style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
              Recommended view: {selectedPreset.recommendedView}
            </p>
          ) : null}
          {selectedPreset ? (
            <p style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
              Source: {selectedPreset.sourcePath}
            </p>
          ) : null}
          {selectedPreset?.supports && selectedPreset.supports.length > 0 ? (
            <details style={{ marginTop: 4 }}>
              <summary style={{ fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
                Technical
              </summary>
              <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
                Supports: {selectedPreset.supports.join(", ")}
              </div>
            </details>
          ) : null}
          <p
            style={{
              marginTop: 6,
              fontSize: 12,
              color: "var(--muted)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            Active primitives:{" "}
            <span style={{ color: activePrimitives.p1 ? "#8de0c6" : "#ff9aa2" }}>
              P1{activePrimitives.p1 ? "✅" : "❌"}
            </span>{" "}
            <span style={{ color: activePrimitives.p2 ? "#8de0c6" : "#ff9aa2" }}>
              P2{activePrimitives.p2 ? "✅" : "❌"}
            </span>{" "}
            <span style={{ color: activePrimitives.p3 ? "#8de0c6" : "#ff9aa2" }}>
              P3{activePrimitives.p3 ? "✅" : "❌"}
            </span>{" "}
            <span style={{ color: activePrimitives.p4 ? "#8de0c6" : "#ff9aa2" }}>
              P4{activePrimitives.p4 ? "✅" : "❌"}
            </span>{" "}
            <span style={{ color: activePrimitives.p5 ? "#8de0c6" : "#ff9aa2" }}>
              P5{activePrimitives.p5 ? "✅" : "❌"}
            </span>{" "}
            <span style={{ color: activePrimitives.p6 ? "#8de0c6" : "#ff9aa2" }}>
              P6{activePrimitives.p6 ? "✅" : "❌"}
            </span>
            {draftDirty ? (
              <span style={{ marginLeft: 6, color: "var(--muted)" }}>(unsaved changes)</span>
            ) : null}
          </p>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>Story Mode</label>
          <select
            value={storyScenarioId}
            onChange={(e) => setStoryScenarioId(e.target.value as StoryScenarioId)}
            disabled={status === "initializing" || (storyPhase !== "idle" && storyPhase !== "done")}
          >
            {Object.entries(STORY_SCENARIO_META).map(([id, meta]) => (
              <option value={id} key={id}>
                {meta.label}
              </option>
            ))}
          </select>
          {storyMeta?.description?.length ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
              {storyMeta.description.map((line, idx) => (
                <div key={`${storyMeta.label}-${idx}`}>{line}</div>
              ))}
            </div>
          ) : null}
          {storyPresetEntry ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
              Preset: {storyPresetEntry.label}
            </div>
          ) : null}
          {storyMeta?.recommendedCompareControl && !compareOn ? (
            <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
              Recommended: Compare A/B → {COMPARE_CONTROL_LABELS[storyMeta.recommendedCompareControl]}
            </div>
          ) : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={compareOn}
                onChange={(e) => setCompareOn(e.target.checked)}
                disabled={storyPhase !== "idle" && storyPhase !== "done"}
              />
              <span>Compare A/B</span>
            </label>
            {compareOn ? (
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span>Control</span>
                <select
                  value={compareControl}
                  onChange={(e) => setCompareControl(e.target.value as CompareControlId)}
                  disabled={storyPhase !== "idle" && storyPhase !== "done"}
                >
                  <option value="no_repair">{COMPARE_CONTROL_LABELS.no_repair}</option>
                  <option value="no_eta">{COMPARE_CONTROL_LABELS.no_eta}</option>
                  <option value="no_p6">{COMPARE_CONTROL_LABELS.no_p6}</option>
                </select>
              </label>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              type="button"
              onClick={startStory}
              disabled={
                status === "initializing" ||
                (storyPhase !== "idle" && storyPhase !== "done") ||
                (compareOn && !compareReady)
              }
            >
              Start demo
            </button>
            <button type="button" onClick={resetStory} disabled={storyPhase === "idle"}>
              Stop/Reset
            </button>
          </div>
          {compareOn ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
              A: Full system · B: Control: {COMPARE_CONTROL_LABELS[compareControl]}
            </div>
          ) : null}
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              color: "var(--muted)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            {storyStatus}
          </div>
        </div>

        {overlayChannel.startsWith("meta") ? (
          <div className="row twoCol">
            <div>
              <label>Overlay layer</label>
              <input
                type="number"
                step={1}
                min={0}
                max={Math.max(0, metaLayerCount - 1)}
                value={overlayLayerIndex}
                onChange={(e) => setOverlayLayerIndex(Math.max(0, Math.floor(Number(e.target.value))))}
                disabled={status === "initializing" || metaLayerCount === 0}
              />
            </div>
            <div />
          </div>
        ) : null}

        <div className="accordion">
          <div 
            className="accordionTitle"
            onClick={() => setExpandedPanels(prev => ({ ...prev, motion: !prev.motion }))}
            style={{ cursor: 'pointer', userSelect: 'none' }}
          >
            <span>{expandedPanels.motion ? '▼' : '▶'}</span> X — motion
          </div>
          {expandedPanels.motion && (
          <div className="accordionContent">
          <div className="row">
            <div>
              <label>beta</label>
              <input
                type="number"
                step={0.1}
                min={0}
                value={paramsDraft.beta}
                onChange={(e) => setParamsDraft((p) => ({ ...p, beta: Number(e.target.value) }))}
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
            <div>
              <label>stepSize</label>
              <input
                type="number"
                step={0.001}
                min={0}
                value={paramsDraft.stepSize}
                onChange={(e) => setParamsDraft((p) => ({ ...p, stepSize: Number(e.target.value) }))}
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
          </div>
          <div className="row">
            <div>
              <label>kappaRep</label>
              <input
                type="number"
                step={1}
                min={0}
                value={paramsDraft.kappaRep}
                onChange={(e) => setParamsDraft((p) => ({ ...p, kappaRep: Number(e.target.value) }))}
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
            <div>
              <label>r0</label>
              <input
                type="number"
                step={0.01}
                min={0}
                max={0.5}
                value={paramsDraft.r0}
                onChange={(e) => setParamsDraft((p) => ({ ...p, r0: Number(e.target.value) }))}
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
          </div>
          </div>
          )}
        </div>

        {p1Enabled ? (
          <div className="accordion">
            <div 
              className="accordionTitle"
              onClick={() => setExpandedPanels(prev => ({ ...prev, p1: !prev.p1 }))}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              <span>{expandedPanels.p1 ? '▼' : '▶'}</span> P1 — bond write
            </div>
            {expandedPanels.p1 && (
            <div className="accordionContent">
            <div className="row">
              <div>
                <label>pWrite (P1 rate)</label>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={paramsDraft.pWrite}
                  onChange={(e) => setParamsDraft((p) => ({ ...p, pWrite: Number(e.target.value) }))}
                  disabled={status === "idle" || status === "initializing"}
                />
              </div>
              <div>
                <label>rPropose</label>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={0.5}
                  value={paramsDraft.rPropose}
                  onChange={(e) => setParamsDraft((p) => ({ ...p, rPropose: Number(e.target.value) }))}
                  disabled={status === "idle" || status === "initializing"}
                />
              </div>
            </div>

            <div className="row">
              <div>
                <label>lambdaW</label>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  value={paramsDraft.lambdaW}
                  onChange={(e) => setParamsDraft((p) => ({ ...p, lambdaW: Number(e.target.value) }))}
                  disabled={status === "idle" || status === "initializing"}
                />
              </div>
              <div>
                <label>kappaBond</label>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  value={paramsDraft.kappaBond}
                  onChange={(e) => setParamsDraft((p) => ({ ...p, kappaBond: Number(e.target.value) }))}
                  disabled={status === "idle" || status === "initializing"}
                />
              </div>
            </div>

            <div className="row">
              <div>
                <label>rStar</label>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={0.5}
                  value={paramsDraft.rStar}
                  onChange={(e) => setParamsDraft((p) => ({ ...p, rStar: Number(e.target.value) }))}
                  disabled={status === "idle" || status === "initializing"}
                />
              </div>
              <div>
                <label>Lw (max w)</label>
                <input
                  type="number"
                  step={1}
                  min={1}
                  max={255}
                  value={paramsDraft.lW}
                  onChange={(e) => setParamsDraft((p) => ({ ...p, lW: Number(e.target.value) }))}
                  disabled={status === "idle" || status === "initializing"}
                />
              </div>
            </div>
            </div>
            )}
          </div>
        ) : null}

        {p4Enabled ? (
          <div className="accordion">
            <div 
              className="accordionTitle"
              onClick={() => setExpandedPanels(prev => ({ ...prev, p4: !prev.p4 }))}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              <span>{expandedPanels.p4 ? '▼' : '▶'}</span> P4 — counters
            </div>
            {expandedPanels.p4 && (
            <div className="accordionContent">
            <div className="row">
              <div>
                <label>pNWrite (P4 rate)</label>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={paramsDraft.pNWrite}
                  onChange={(e) => setParamsDraft((p) => ({ ...p, pNWrite: Number(e.target.value) }))}
                  disabled={status === "idle" || status === "initializing"}
                />
              </div>
              <div>
                <label>lambdaN</label>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  value={paramsDraft.lambdaN}
                  onChange={(e) => setParamsDraft((p) => ({ ...p, lambdaN: Number(e.target.value) }))}
                  disabled={status === "idle" || status === "initializing"}
                />
              </div>
            </div>
            <div className="row">
              <div>
                <label>Ln (max |n|)</label>
                <input
                  type="number"
                  step={1}
                  min={1}
                  max={32767}
                  value={paramsDraft.lN}
                  onChange={(e) => setParamsDraft((p) => ({ ...p, lN: Number(e.target.value) }))}
                  disabled={status === "idle" || status === "initializing"}
                />
              </div>
              <div />
            </div>
            </div>
            )}
          </div>
        ) : null}

        <div className="accordion">
          <div 
            className="accordionTitle"
            onClick={() => setExpandedPanels(prev => ({ ...prev, clock: !prev.clock }))}
            style={{ cursor: 'pointer', userSelect: 'none' }}
          >
            <span>{expandedPanels.clock ? '▼' : '▶'}</span> Clock / TUR
          </div>
          {expandedPanels.clock && (
          <div className="accordionContent">
          <div className="row">
            <div>
              <label>clockOn</label>
              <input
                type="checkbox"
                checked={paramsDraft.clockOn >= 0.5}
                onChange={(e) =>
                  setParamsDraft((p) => ({ ...p, clockOn: e.target.checked ? 1 : 0 }))
                }
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
            <div>
              <label>clockUsesP6</label>
              <input
                type="checkbox"
                checked={paramsDraft.clockUsesP6 >= 0.5}
                onChange={(e) =>
                  setParamsDraft((p) => ({ ...p, clockUsesP6: e.target.checked ? 1 : 0 }))
                }
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
          </div>
          <div className="row">
            <div>
              <label>clockK</label>
              <input
                type="number"
                step={1}
                min={1}
                value={paramsDraft.clockK}
                onChange={(e) => setParamsDraft((p) => ({ ...p, clockK: Number(e.target.value) }))}
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
            <div>
              <label>clockFrac</label>
              <input
                type="number"
                step={0.001}
                min={0}
                max={1}
                value={paramsDraft.clockFrac}
                onChange={(e) =>
                  setParamsDraft((p) => ({ ...p, clockFrac: Number(e.target.value) }))
                }
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
          </div>
          <div className="row">
            <div>
              <label>clockFrac slider</label>
              <input
                type="range"
                step={0.001}
                min={0}
                max={1}
                value={paramsDraft.clockFrac}
                onChange={(e) =>
                  setParamsDraft((p) => ({ ...p, clockFrac: Number(e.target.value) }))
                }
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
            <div />
          </div>
          <div className="row">
            <div>
              <label>repairClockGated</label>
              <input
                type="checkbox"
                checked={paramsDraft.repairClockGated >= 0.5}
                onChange={(e) =>
                  setParamsDraft((p) => ({ ...p, repairClockGated: e.target.checked ? 1 : 0 }))
                }
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
            <div>
              <label>repairGateMode</label>
              <input
                type="number"
                step={1}
                value={paramsDraft.repairGateMode}
                onChange={(e) =>
                  setParamsDraft((p) => ({ ...p, repairGateMode: Number(e.target.value) }))
                }
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
          </div>
          <div className="row">
            <div>
              <label>repairGateSpan</label>
              <input
                type="number"
                step={1}
                value={paramsDraft.repairGateSpan}
                onChange={(e) =>
                  setParamsDraft((p) => ({ ...p, repairGateSpan: Number(e.target.value) }))
                }
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
            <div />
          </div>
          </div>
          )}
        </div>

        <div className="accordion">
          <div 
            className="accordionTitle"
            onClick={() => setExpandedPanels(prev => ({ ...prev, opk: !prev.opk }))}
            style={{ cursor: 'pointer', userSelect: 'none' }}
          >
            <span>{expandedPanels.opk ? '▼' : '▶'}</span> opK coupling
          </div>
          {expandedPanels.opk && (
          <div className="accordionContent">
          <div className="row">
            <div>
              <label>opCouplingOn</label>
              <input
                type="checkbox"
                checked={paramsDraft.opCouplingOn >= 0.5}
                onChange={(e) =>
                  setParamsDraft((p) => ({ ...p, opCouplingOn: e.target.checked ? 1 : 0 }))
                }
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
            <div>
              <label>opDriveOnK</label>
              <input
                type="checkbox"
                checked={paramsDraft.opDriveOnK >= 0.5}
                onChange={(e) =>
                  setParamsDraft((p) => ({ ...p, opDriveOnK: e.target.checked ? 1 : 0 }))
                }
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
          </div>
          <div className="row">
            <div>
              <label>sCouplingMode</label>
              <select
                value={paramsDraft.sCouplingMode}
                onChange={(e) => setParamsDraft((p) => ({ ...p, sCouplingMode: Number(e.target.value) }))}
                disabled={status === "idle" || status === "initializing"}
              >
                <option value={0}>0</option>
                <option value={1}>1</option>
              </select>
            </div>
            <div>
              <label>opStencil</label>
              <select
                value={paramsDraft.opStencil}
                onChange={(e) => setParamsDraft((p) => ({ ...p, opStencil: Number(e.target.value) }))}
                disabled={status === "idle" || status === "initializing"}
              >
                <option value={0}>0</option>
                <option value={1}>1</option>
              </select>
            </div>
          </div>
          <div className="row">
            <div>
              <label>opBudgetK</label>
              <input
                type="number"
                step={1}
                min={1}
                value={paramsDraft.opBudgetK}
                onChange={(e) => setParamsDraft((p) => ({ ...p, opBudgetK: Number(e.target.value) }))}
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
            <div>
              <label>opKTargetWeight</label>
              <input
                type="number"
                step={0.01}
                min={0}
                value={paramsDraft.opKTargetWeight}
                onChange={(e) =>
                  setParamsDraft((p) => ({ ...p, opKTargetWeight: Number(e.target.value) }))
                }
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
          </div>
          </div>
          )}
        </div>

        <div className="accordion">
          <div 
            className="accordionTitle"
            onClick={() => setExpandedPanels(prev => ({ ...prev, maintenance: !prev.maintenance }))}
            style={{ cursor: 'pointer', userSelect: 'none' }}
          >
            <span>{expandedPanels.maintenance ? '▼' : '▶'}</span> Maintenance (noise + repair)
          </div>
          {expandedPanels.maintenance && (
          <div className="accordionContent">
          <div className="row">
            <div>
              <label>codeNoiseRate</label>
              <input
                type="number"
                step={0.0001}
                min={0}
                max={1}
                value={paramsDraft.codeNoiseRate}
                onChange={(e) =>
                  setParamsDraft((p) => ({ ...p, codeNoiseRate: Number(e.target.value) }))
                }
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
            <div>
              <label>codeNoiseRate slider</label>
              <input
                type="range"
                step={0.0001}
                min={0}
                max={1}
                value={paramsDraft.codeNoiseRate}
                onChange={(e) =>
                  setParamsDraft((p) => ({ ...p, codeNoiseRate: Number(e.target.value) }))
                }
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
          </div>
          <div className="row">
            <div>
              <label>codeNoiseBatch</label>
              <input
                type="number"
                step={1}
                min={1}
                value={paramsDraft.codeNoiseBatch}
                onChange={(e) =>
                  setParamsDraft((p) => ({ ...p, codeNoiseBatch: Math.max(1, Math.floor(Number(e.target.value))) }))
                }
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
            <div>
              <label>codeNoiseLayer</label>
              <input
                type="number"
                step={1}
                min={0}
                max={Math.max(0, paramsDraft.metaLayers - 1)}
                value={paramsDraft.codeNoiseLayer}
                onChange={(e) => {
                  const maxLayer = Math.max(0, paramsDraft.metaLayers - 1);
                  const next = Math.max(0, Math.min(maxLayer, Math.floor(Number(e.target.value))));
                  setParamsDraft((p) => ({ ...p, codeNoiseLayer: next }));
                }}
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
          </div>
          <div className="row">
            <div>
              <label>etaDrive</label>
              <input
                type="number"
                step={0.01}
                min={0}
                max={2}
                value={paramsDraft.etaDrive}
                onChange={(e) => setParamsDraft((p) => ({ ...p, etaDrive: Number(e.target.value) }))}
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
            <div>
              <label>p6SFactor</label>
              <input
                type="number"
                step={0.01}
                min={0}
                max={1}
                value={paramsDraft.p6SFactor}
                onChange={(e) => setParamsDraft((p) => ({ ...p, p6SFactor: Number(e.target.value) }))}
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
          </div>
          <div className="row">
            <div>
              <label>etaDrive slider</label>
              <input
                type="range"
                step={0.01}
                min={0}
                max={2}
                value={paramsDraft.etaDrive}
                onChange={(e) => setParamsDraft((p) => ({ ...p, etaDrive: Number(e.target.value) }))}
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
            <div>
              <label>p6SFactor slider</label>
              <input
                type="range"
                step={0.01}
                min={0}
                max={1}
                value={paramsDraft.p6SFactor}
                onChange={(e) => setParamsDraft((p) => ({ ...p, p6SFactor: Number(e.target.value) }))}
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
          </div>
          <div className="row">
            <div>
              <label>repairClockGated</label>
              <input
                type="checkbox"
                checked={paramsDraft.repairClockGated >= 0.5}
                onChange={(e) =>
                  setParamsDraft((p) => ({ ...p, repairClockGated: e.target.checked ? 1 : 0 }))
                }
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
            <div>
              <label>repairGateMode</label>
              <input
                type="number"
                step={1}
                value={paramsDraft.repairGateMode}
                onChange={(e) =>
                  setParamsDraft((p) => ({ ...p, repairGateMode: Number(e.target.value) }))
                }
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
          </div>
          <div className="row">
            <div>
              <label>repairGateSpan</label>
              <input
                type="number"
                step={1}
                value={paramsDraft.repairGateSpan}
                onChange={(e) =>
                  setParamsDraft((p) => ({ ...p, repairGateSpan: Number(e.target.value) }))
                }
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
            <div />
          </div>
          <div className="row">
            <button
              type="button"
              onClick={() => triggerPerturb("randomize")}
              disabled={status === "idle" || status === "initializing" || paramsApplied.metaLayers < 1}
            >
              Perturb meta0 (30% randomize)
            </button>
            <button
              type="button"
              onClick={() => triggerPerturb("zero")}
              disabled={status === "idle" || status === "initializing" || paramsApplied.metaLayers < 1}
            >
              Perturb meta0 (30% zero)
            </button>
          </div>
          </div>
          )}
        </div>

        {p2Enabled ? (
          <div className="accordion">
            <div 
              className="accordionTitle"
              onClick={() => setExpandedPanels(prev => ({ ...prev, p2: !prev.p2 }))}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              <span>{expandedPanels.p2 ? '▼' : '▶'}</span> P2 — apparatus
            </div>
            {expandedPanels.p2 && (
            <div className="accordionContent">
            <div className="row">
              <div>
                <label>pAWrite (P2 rate)</label>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={paramsDraft.pAWrite}
                  onChange={(e) => setParamsDraft((p) => ({ ...p, pAWrite: Number(e.target.value) }))}
                  disabled={status === "idle" || status === "initializing"}
                />
              </div>
              <div>
                <label>lambdaA</label>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  value={paramsDraft.lambdaA}
                  onChange={(e) => setParamsDraft((p) => ({ ...p, lambdaA: Number(e.target.value) }))}
                  disabled={status === "idle" || status === "initializing"}
                />
              </div>
            </div>
            <div className="row">
              <div>
                <label>La (max |a|)</label>
                <input
                  type="number"
                  step={1}
                  min={1}
                  max={32767}
                  value={paramsDraft.lA}
                  onChange={(e) => setParamsDraft((p) => ({ ...p, lA: Number(e.target.value) }))}
                  disabled={status === "idle" || status === "initializing"}
                />
              </div>
              <div />
            </div>
            </div>
            )}
          </div>
        ) : null}

        {p5Enabled ? (
          <div className="accordion">
            <div 
              className="accordionTitle"
              onClick={() => setExpandedPanels(prev => ({ ...prev, p5: !prev.p5 }))}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              <span>{expandedPanels.p5 ? '▼' : '▶'}</span> P5 — field
            </div>
            {expandedPanels.p5 && (
            <div className="accordionContent">
            <div className="row">
              <div>
                <label>pSWrite (P5 rate)</label>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={paramsDraft.pSWrite}
                  onChange={(e) => setParamsDraft((p) => ({ ...p, pSWrite: Number(e.target.value) }))}
                  disabled={status === "idle" || status === "initializing"}
                />
              </div>
              <div>
                <label>lambdaS</label>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  value={paramsDraft.lambdaS}
                  onChange={(e) => setParamsDraft((p) => ({ ...p, lambdaS: Number(e.target.value) }))}
                  disabled={status === "idle" || status === "initializing"}
                />
              </div>
            </div>
            <div className="row">
              <div>
                <label>Ls (max S)</label>
                <input
                  type="number"
                  step={1}
                  min={1}
                  max={255}
                  value={paramsDraft.lS}
                  onChange={(e) => setParamsDraft((p) => ({ ...p, lS: Number(e.target.value) }))}
                  disabled={status === "idle" || status === "initializing"}
                />
              </div>
              <div>
                <label>Grid size</label>
                <input
                  type="number"
                  step={1}
                  min={2}
                  max={256}
                  value={paramsDraft.gridSize}
                  onChange={(e) => setParamsDraft((p) => ({ ...p, gridSize: Number(e.target.value) }))}
                  disabled={status === "idle" || status === "initializing"}
                />
              </div>
            </div>
            <div className="row">
              <div>
                <label>Safe threshold (S ≥)</label>
                <input
                  type="number"
                  step={1}
                  min={1}
                  max={255}
                  value={safeThreshold}
                  onChange={(e) => setSafeThreshold(Math.max(1, Math.floor(Number(e.target.value))))}
                  disabled={status === "initializing"}
                />
              </div>
              <div />
            </div>
            </div>
            )}
          </div>
        ) : null}

        <div className="accordion">
          <div 
            className="accordionTitle"
            onClick={() => setExpandedPanels(prev => ({ ...prev, meta: !prev.meta }))}
            style={{ cursor: 'pointer', userSelect: 'none' }}
          >
            <span>{expandedPanels.meta ? '▼' : '▶'}</span> Meta
          </div>
          {expandedPanels.meta && (
          <div className="accordionContent">
          <div className="row">
            <div>
              <label>Meta layers</label>
              <input
                type="number"
                step={1}
                min={0}
                max={16}
                value={paramsDraft.metaLayers}
                onChange={(e) => setParamsDraft((p) => ({ ...p, metaLayers: Number(e.target.value) }))}
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
            <div>
              <label>eta</label>
              <input
                type="number"
                step={0.01}
                min={0}
                max={1}
                value={paramsDraft.eta}
                onChange={(e) => setParamsDraft((p) => ({ ...p, eta: Number(e.target.value) }))}
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
          </div>
          <div className="row">
            <div>
              <label>eta slider</label>
              <input
                type="range"
                step={0.01}
                min={0}
                max={1}
                value={paramsDraft.eta}
                onChange={(e) => setParamsDraft((p) => ({ ...p, eta: Number(e.target.value) }))}
                disabled={status === "idle" || status === "initializing"}
              />
            </div>
            <div />
          </div>
          </div>
          )}
        </div>

        {p6Enabled ? (
          <div className="accordion">
            <div 
              className="accordionTitle"
              onClick={() => setExpandedPanels(prev => ({ ...prev, p6: !prev.p6 }))}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              <span>{expandedPanels.p6 ? '▼' : '▶'}</span> P6 — resource
            </div>
            {expandedPanels.p6 && (
            <div className="accordionContent">
            <div className="row">
              <div>
                <label>muHigh</label>
                <input
                  type="number"
                  step={0.1}
                  value={paramsDraft.muHigh}
                  onChange={(e) => setParamsDraft((p) => ({ ...p, muHigh: Number(e.target.value) }))}
                  disabled={status === "idle" || status === "initializing"}
                />
              </div>
              <div>
                <label>muLow</label>
                <input
                  type="number"
                  step={0.1}
                  value={paramsDraft.muLow}
                  onChange={(e) => setParamsDraft((p) => ({ ...p, muLow: Number(e.target.value) }))}
                  disabled={status === "idle" || status === "initializing"}
                />
              </div>
            </div>
            </div>
            )}
          </div>
        ) : null}

        <div className="row">
          <button
            onClick={() => {
              setError(null);
              const applied = effectiveParams(paramsDraft);
              setParamsApplied(applied);
            }}
            disabled={status === "initializing" || shallowEqual(effectiveParams(paramsDraft), paramsApplied)}
          >
            Apply params
          </button>
          <div />
        </div>

        <div className="row">
          <button
            className="primary"
            onClick={() => {
              setError(null);
              setStatus("running");
              client.send({ type: "resume" });
            }}
            disabled={!canRun}
          >
            Run
          </button>
          <button
            onClick={() => {
              setStatus("ready");
              client.send({ type: "pause" });
            }}
            disabled={!canPause}
          >
            Pause
          </button>
        </div>

        <p>Status: {status}</p>
        {!shallowEqual(effectiveParams(paramsDraft), paramsApplied) ? (
          <p style={{ color: "#97a3b3" }}>Params changed (not applied). For scientific runs, prefer Apply params + Init.</p>
        ) : null}
        {status === "initializing" && initSlow ? (
          <p style={{ color: "#97a3b3" }}>
            Still initializing… if this persists, the worker likely failed to load the WASM module; check the Error
            line below.
          </p>
        ) : null}
        {energy ? (
          <p style={{ marginTop: 8, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            E={energy.total.toFixed(3)} (Urep {energy.uRep.toFixed(3)}, Ubond {energy.uBond.toFixed(3)}, Ew{" "}
            {energy.eW.toFixed(3)}, En {energy.eN.toFixed(3)}, Ea {energy.eA.toFixed(3)}, Es{" "}
            {energy.eS.toFixed(3)})
          </p>
        ) : null}
        <p style={{ marginTop: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
          Steps: {totalSteps}
        </p>
        {epExactTotal !== null ? (
          <p style={{ marginTop: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            EP exact {epExactTotal.toFixed(4)} | rate (Δ{EP_WINDOW_STEPS}){" "}
            {epExactRate !== null ? epExactRate.toExponential(3) : "n/a"}
          </p>
        ) : null}
        {epNaiveTotal !== null ? (
          <p style={{ marginTop: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            EP naive {epNaiveTotal.toFixed(4)} | rate (Δ{EP_WINDOW_STEPS}){" "}
            {epNaiveRate !== null ? epNaiveRate.toExponential(3) : "n/a"}
          </p>
        ) : null}
        {showClockPanel && clockDebug ? (
          <div style={{ marginTop: 6 }}>
            <p style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
              Clock state {clockDebug.state} | Q {clockDebug.q}
            </p>
            <p style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
              fwd/bwd {clockDebug.fwd} / {clockDebug.bwd} | steps {clockSteps} | drift{" "}
              {clockDrift.toExponential(3)}
            </p>
            {turLine ? (
              <p style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                {turLine}
              </p>
            ) : null}
          </div>
        ) : null}
        {opkDebugLine && opkMetaLine ? (
          <div style={{ marginTop: 6 }}>
            <p style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
              opK {opkDebugLine}
            </p>
            <p style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
              opK {opkMetaLine}
            </p>
          </div>
        ) : null}
        <p style={{ marginTop: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
          Meta layers {paramsApplied.metaLayers} | metaField.length {metaSnapshot ? metaSnapshot.length : 0}
        </p>
        {diagnostics ? (
          <p style={{ marginTop: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            P1 steps {diagnostics.window} | N+ {diagnostics.wPlus} N- {diagnostics.wMinus} | Jw{" "}
            {diagnostics.jW.toFixed(4)} Aw {diagnostics.aW.toFixed(4)} Σmem {diagnostics.sigmaMem.toFixed(4)}
          </p>
        ) : null}
        {diagnostics ? (
          <p style={{ marginTop: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            P2 steps {diagnostics.window} | N+ {diagnostics.aPlus} N- {diagnostics.aMinus} | Ja{" "}
            {diagnostics.jA.toFixed(4)} Aa {diagnostics.aA.toFixed(4)}
          </p>
        ) : null}
        {diagnostics ? (
          <p style={{ marginTop: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            P4 steps {diagnostics.window} | N+ {diagnostics.nPlus} N- {diagnostics.nMinus} | Jn{" "}
            {diagnostics.jN.toFixed(4)} An {diagnostics.aN.toFixed(4)}
          </p>
        ) : null}
        {diagnostics ? (
          <p style={{ marginTop: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            P5 steps {diagnostics.window} | N+ {diagnostics.sPlus} N- {diagnostics.sMinus} | Js{" "}
            {diagnostics.jS.toFixed(4)} As {diagnostics.aS.toFixed(4)}
          </p>
        ) : null}
        {diagnostics && p3Enabled ? (
          <p style={{ marginTop: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            P3 cycle {diagnostics.p3CycleLen} | disp {diagnostics.p3DispMag.toFixed(4)} | loop{" "}
            {diagnostics.p3LoopArea.toFixed(4)}
          </p>
        ) : null}
        {diagnostics && p6Enabled ? (
          <p style={{ marginTop: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            P6 M6 | W {diagnostics.aM6W.toFixed(4)} N {diagnostics.aM6N.toFixed(4)} A{" "}
            {diagnostics.aM6A.toFixed(4)} S {diagnostics.aM6S.toFixed(4)}
          </p>
        ) : null}
        {graphStatsMode !== "off" && graphStats && graphStatsN ? (
          <p style={{ marginTop: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            Graph edges {graphStats.edges} | components {graphStats.components} | largest{" "}
            {graphStats.largest}/{graphStatsN} ({(graphStats.largest / graphStatsN).toFixed(2)})
          </p>
        ) : null}
        <button
          style={{ marginTop: 8 }}
          onClick={async () => {
            try {
              await exportRun();
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              setError(message);
            }
          }}
          disabled={status === "idle" || status === "initializing"}
        >
          Export run
        </button>
        {error ? <p style={{ color: "#ff6a6a" }}>Error: {error}</p> : null}
        <p style={{ marginTop: 14 }}>
          Build WASM into the UI at: <code>apps/web/src/wasm/sim_core</code>
        </p>
      </div>

      <div className="main">
        <div className="topRow">
          <div className="canvasWrap">
            <canvas ref={canvasRef} />
          </div>
          {metaLayerCount > 0 ? (
            <div className="sStackSection sStackSection--side">
              <div className="sStackHeader">
                <div className="sStackTitle">S Layer Stack</div>
                <div className="sStackControls">
                  <label>
                    Mode
                    <select
                      value={sStackMode}
                      onChange={(e) =>
                        setSStackMode(e.target.value as "layers" | "diff_base" | "diff_meta")
                      }
                    >
                      <option value="layers">Layers</option>
                      <option value="diff_base">Diff: |Base − Meta0|</option>
                      <option value="diff_meta">Diff: |Meta(k) − Meta(k+1)|</option>
                    </select>
                  </label>
                  {sStackMode === "diff_base" ? (
                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={injuryMapOn}
                        onChange={(e) => setInjuryMapOn(e.target.checked)}
                      />
                      <span>Injury map overlay</span>
                    </label>
                  ) : null}
                  {sStackMode === "diff_meta" ? (
                    <label>
                      k
                      <input
                        type="number"
                        min={0}
                        max={diffPairMax}
                        step={1}
                        value={diffPairIndex}
                        onChange={(e) =>
                          setSStackDiffIndex(Math.max(0, Math.floor(Number(e.target.value))))
                        }
                      />
                    </label>
                  ) : null}
                  {sStackMode === "layers" && metaLayerCount > stackMaxLayers - 1 ? (
                    <label>
                      start
                      <input
                        type="number"
                        min={0}
                        max={Math.max(0, metaLayerCount - 1)}
                        step={1}
                        value={stackMetaStart}
                        onChange={(e) =>
                          setSStackMetaStart(Math.max(0, Math.floor(Number(e.target.value))))
                        }
                      />
                    </label>
                  ) : null}
                </div>
              </div>
              <div className="sStackGrid">
                {sStackCards.map((card) => {
                  const stats = statsById.get(card.id);
                  return (
                    <div className="sStackCard" key={card.id}>
                      <div className="sStackLabel">{card.label}</div>
                      <canvas
                        className="sStackCanvas"
                        ref={(el) => (sStackRefs.current[card.id] = el)}
                      />
                      {card.showStats && stats ? (
                        <div className="sStackStats">
                          safe {stats.fraction.toFixed(2)} | cc {stats.components} | largest{" "}
                          {stats.largestFrac.toFixed(2)}
                        </div>
                      ) : null}
                      {card.showDiffMean && sStackDiffMean !== null ? (
                        <div className="sStackStats">
                          mean |Δ| {sStackDiffMean.toFixed(2)}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        {(certPassed.epNull ||
          certPassed.sigmaNull ||
          certPassed.m6Null ||
          certPassed.clockNull ||
          certPassed.tur ||
          certPassed.opkBudget ||
          certPassed.codeMaint) && (
          <div className="certificatesBar">
            <span className="certificatesLabel">Certificates:</span>
            {certPassed.epNull && <span className="certBadge">✅ Null EP</span>}
            {certPassed.sigmaNull && <span className="certBadge">✅ Null Σmem</span>}
            {certPassed.m6Null && <span className="certBadge">✅ Null M6</span>}
            {certPassed.clockNull && <span className="certBadge">✅ Null Clock</span>}
            {certPassed.tur && <span className="certBadge">✅ TUR R≥1</span>}
            {certPassed.opkBudget && <span className="certBadge">✅ opK Budget</span>}
            {certPassed.codeMaint && <span className="certBadge">✅ Code Maint</span>}
          </div>
        )}

        {compareOn && storyPhase !== "idle" ? (
          <div
            style={{
              margin: "0 16px 12px",
              padding: "12px",
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "rgba(255, 255, 255, 0.03)",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              A/B injury compare
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 260px", minWidth: 220 }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>A: Full system</div>
                <canvas
                  ref={abDiffARef}
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "rgba(0, 0, 0, 0.2)",
                  }}
                />
              </div>
              <div style={{ flex: "1 1 260px", minWidth: 220 }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
                  B: {COMPARE_CONTROL_LABELS[compareControl]}
                </div>
                <canvas
                  ref={abDiffBRef}
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "rgba(0, 0, 0, 0.2)",
                  }}
                />
              </div>
            </div>
          </div>
        ) : null}

        <div className="chartsPanel">
          {metaLayerCount >= 2 && metaAlignCurrent ? (
            <div className="metaAlignSection">
              <div className="metaAlignHeader">
                <div className="metaAlignTitle">Meta alignment</div>
                <div className="metaAlignControls">
                  <button
                    type="button"
                    onClick={pinBaseline}
                    disabled={!metaAlignCurrent}
                  >
                    Pin baseline
                  </button>
                  {metaAlignBaseline ? (
                    <button type="button" onClick={() => setMetaAlignBaseline(null)}>
                      Clear baseline
                    </button>
                  ) : null}
                </div>
              </div>
              {metaAlignBaseline ? (
                <div className="metaAlignBaseline">
                  Pinned at step {metaAlignBaseline.step} (η={metaAlignBaseline.eta.toFixed(2)})
                </div>
              ) : null}
              <div className="metaAlignGrid">
                {[
                  {
                    id: "sdiff_base",
                    label: "Sdiff base/meta0",
                    value: metaAlignCurrent.sdiffBase,
                    baseline: metaAlignBaseline?.sdiffBase ?? null,
                  },
                  {
                    id: "sdiff_meta",
                    label: "Sdiff meta0/meta1",
                    value: metaAlignCurrent.sdiffMeta,
                    baseline: metaAlignBaseline?.sdiffMeta ?? null,
                  },
                  {
                    id: "wdiff_meta",
                    label: "Wdiff meta0/meta1",
                    value: metaAlignCurrent.wdiffMeta,
                    baseline: metaAlignBaseline?.wdiffMeta ?? null,
                  },
                ].map((item) => {
                  const delta =
                    item.baseline !== null && item.baseline !== undefined
                      ? item.value - item.baseline
                      : null;
                  return (
                    <div className="metaAlignCard" key={item.id}>
                      <div className="metaAlignLabel">{item.label}</div>
                      <div className="metaAlignValue">
                        {item.value.toFixed(3)}
                        {delta !== null ? ` (Δ ${formatDelta(delta)})` : ""}
                      </div>
                      <canvas
                        className="metaAlignCanvas"
                        ref={(el) => (metaAlignCanvasRefs.current[item.id] = el)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          {paramsApplied.opCouplingOn >= 0.5 && hasOpkPayload ? (
            <div className="opkSection">
              <div className="opkHeader">
                <div className="opkTitle">opK view</div>
                <div className="opkControls">
                  <label>
                    Interface
                    <select
                      value={opkInterfaceIdx}
                      onChange={(e) => setOpkInterfaceIdx(Math.max(0, Math.floor(Number(e.target.value))))}
                    >
                      {Array.from({ length: opkMeta?.interfaces ?? 0 }, (_, i) => (
                        <option key={i} value={i}>
                          {i}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    View
                    <select
                      value={opkViewMode}
                      onChange={(e) =>
                        setOpkViewMode(e.target.value as "tokens" | "total" | "mismatch")
                      }
                    >
                      <option value="tokens">Tokens (offset r)</option>
                      <option value="total">Total tokens per cell</option>
                      <option value="mismatch">Mismatch |upper - pred|</option>
                    </select>
                  </label>
                  {opkViewMode === "tokens" ? (
                    <label>
                      Offset r {opkOffsetLabel}
                      <select
                        value={opkOffsetIdx}
                        onChange={(e) => setOpkOffsetIdx(Math.max(0, Math.floor(Number(e.target.value))))}
                      >
                        {Array.from({ length: opkMeta?.rCount ?? 0 }, (_, i) => (
                          <option key={i} value={i}>
                            {i}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label className="opkCheckbox">
                    <input
                      type="checkbox"
                      checked={opkHistAll}
                      onChange={(e) => setOpkHistAll(e.target.checked)}
                    />
                    Hist all interfaces
                  </label>
                </div>
                <div className="opkNote">
                  payload@steps {opkPayloadSteps ?? "n/a"}
                  {opkPayloadAge !== null ? ` | age ${opkPayloadAge}` : ""}
                </div>
              </div>
              {opkViewTooLarge ? (
                <div className="opkNote">
                  opK view paused: grid {paramsApplied.gridSize}x{paramsApplied.gridSize} exceeds cap
                  ({OPK_VIEW_MAX_CELLS} cells).
                </div>
              ) : opkViewStatus === "mismatch" ? (
                <div className="opkNote">Waiting for opK payload refresh (shape mismatch).</div>
              ) : null}
              <div className="opkGrid">
                <div className="opkCard">
                  <div className="opkLabel">
                    {opkViewMode === "tokens"
                      ? `Token map (r ${opkOffsetIdx})`
                      : opkViewMode === "total"
                        ? "Total tokens per cell"
                        : "Mismatch |upper - pred|"}
                  </div>
                  <canvas className="opkCanvas" ref={opkCanvasRef} />
                  {opkViewMode === "mismatch" ? (
                    <div className="opkNote">diff max {OPK_DIFF_MAX}</div>
                  ) : null}
                </div>
                <div className="opkCard">
                  <div className="opkLabel">Token histogram</div>
                  <canvas className="opkHistCanvas" ref={opkHistCanvasRef} />
                  <div className="opkNote">bins 0..{opkMeta?.budgetK ?? 0}</div>
                </div>
              </div>
            </div>
          ) : null}
          {paramsApplied.metaLayers >= 1 ? (
            <div className="maintSection">
              <div className="maintHeader">
                <div className="maintTitle">Maintenance</div>
                <div className="maintStatus">
                  noise expected/window {maintNoiseText} | repairGate{" "}
                  {paramsApplied.repairClockGated >= 0.5 ? "on" : "off"}
                </div>
              </div>
              <div className="maintGrid">
                <div className="maintCard">
                  <div className="maintLabel">errF0.5</div>
                  <div className="maintValue">{maintErrText}</div>
                  <canvas
                    className="maintCanvas"
                    ref={(el) => (maintCanvasRefs.current["maint_err"] = el)}
                  />
                </div>
                <div className="maintCard">
                  <div className="maintLabel">sdiff base</div>
                  <div className="maintValue">{maintSdiffText}</div>
                  <canvas
                    className="maintCanvas"
                    ref={(el) => (maintCanvasRefs.current["maint_sdiff"] = el)}
                  />
                </div>
                <div className="maintCard">
                  <div className="maintLabel">repair rate</div>
                  <div className="maintValue">{maintRepairText}</div>
                  <canvas
                    className="maintCanvas"
                    ref={(el) => (maintCanvasRefs.current["maint_repair"] = el)}
                  />
                </div>
              </div>
              <div className="maintNote">
                clock rate {maintClockText} | {maintPerturbText} | {maintRecoveryText}
              </div>
            </div>
          ) : null}
          {chartGroups.current.flatMap((group) => {
            if (group === "P1" && !p1Enabled) return [];
            if (group === "P2" && !p2Enabled) return [];
            if (group === "P3" && !p3Enabled) return [];
            if (group === "P4" && !p4Enabled) return [];
            if (group === "P5" && !p5Enabled) return [];
            const charts = CHARTS.filter((c) => c.group === group).map((chart) => (
              <div className={`chartCard chartCard--${group}`} key={chart.id}>
                <div className="chartLabel">{chart.label}</div>
                <canvas ref={(el) => (chartRefs.current[chart.id] = el)} />
              </div>
            ));
            const hists = HISTOGRAMS.filter((h) => h.group === group).map((hist) => (
              <div className={`chartCard chartCard--${group}`} key={hist.id}>
                <div className="chartLabel">{hist.label}</div>
                <canvas ref={(el) => (histRefs.current[hist.id] = el)} />
              </div>
            ));
            return charts.concat(hists);
          })}
        </div>
      </div>
    </div>
  );
}

function shallowEqual(a: SimParams, b: SimParams): boolean {
  const keys: Array<keyof SimParams> = [
    "beta",
    "stepSize",
    "p3On",
    "p6On",
    "etaDrive",
    "p6SFactor",
    "pWrite",
    "pNWrite",
    "pAWrite",
    "pSWrite",
    "muHigh",
    "muLow",
    "kappaRep",
    "r0",
    "kappaBond",
    "rStar",
    "lambdaW",
    "lW",
    "lambdaN",
    "lN",
    "lambdaA",
    "lA",
    "lambdaS",
    "lS",
    "gridSize",
    "rPropose",
    "metaLayers",
    "eta",
    "clockOn",
    "clockK",
    "clockFrac",
    "clockUsesP6",
    "repairClockGated",
    "repairGateMode",
    "repairGateSpan",
    "codeNoiseRate",
    "codeNoiseBatch",
    "codeNoiseLayer",
    "opCouplingOn",
    "sCouplingMode",
    "opStencil",
    "opBudgetK",
    "opKTargetWeight",
    "opDriveOnK",
  ];
  return keys.every((k) => a[k] === b[k]);
}
