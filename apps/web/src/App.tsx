import React, { useEffect, useRef, useState } from "react";
import { SimWorkerClient } from "./sim/workerClient";
import {
  addSnapshot,
  attachToWindow,
  exportRun,
  setCaptureEverySteps,
  startRun,
} from "./sim/runCache";
import type { Diagnostics, EnergyBreakdown, SimParams } from "./sim/workerMessages";
import { PRESET_CATALOG, type PresetEntry } from "./sim/presetCatalog";

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

const EP_WINDOW_STEPS = 20000;
const CERT_STABILITY_K = 5;
const CERT_MIN_STEPS = EP_WINDOW_STEPS;
const CERT_EP_EXACT_RATE_ABS_MAX = 2e-4;
const CERT_SIGMA_MEM_ABS_MAX = 2e-3;
const CERT_M6_ABS_MAX = 2e-3;
const MAX_STACK_LAYERS = 4;
const META_ALIGN_SERIES_CAP = 400;
const DEFAULT_PRESET_ID = "base_null_balanced";

function pushHistory(series: number[], value: number) {
  series.push(value);
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
  opDriveOnK: 0,
};

export default function App() {
  const [n, setN] = useState(200);
  const [seed, setSeed] = useState(1);
  const [bondThreshold, setBondThreshold] = useState(3);
  const [energy, setEnergy] = useState<EnergyBreakdown | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [graphStats, setGraphStats] = useState<GraphStats | null>(null);
  const [graphStatsN, setGraphStatsN] = useState<number | null>(null);
  const [recordEverySteps, setRecordEverySteps] = useState(2000);
  const [totalSteps, setTotalSteps] = useState(0);
  const [epExactTotal, setEpExactTotal] = useState<number | null>(null);
  const [epNaiveTotal, setEpNaiveTotal] = useState<number | null>(null);
  const [epExactRate, setEpExactRate] = useState<number | null>(null);
  const [epNaiveRate, setEpNaiveRate] = useState<number | null>(null);
  const [clockDebug, setClockDebug] = useState<null | { state: number; q: number; fwd: number; bwd: number }>(null);
  const [sStackMode, setSStackMode] = useState<"layers" | "diff_base" | "diff_meta">("layers");
  const [sStackDiffIndex, setSStackDiffIndex] = useState(0);
  const [sStackMetaStart, setSStackMetaStart] = useState(0);
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
  const [certPassed, setCertPassed] = useState({ epNull: false, sigmaNull: false, m6Null: false });
  const [p1Enabled, setP1Enabled] = useState(true);
  const [p2Enabled, setP2Enabled] = useState(true);
  const [p4Enabled, setP4Enabled] = useState(true);
  const [p5Enabled, setP5Enabled] = useState(true);
  const [p3Enabled, setP3Enabled] = useState(false);
  const [p6Enabled, setP6Enabled] = useState(false);
  const [safeThreshold, setSafeThreshold] = useState(3);
  const [colorSource, setColorSource] = useState<"none" | "p4" | "p2">("p4");
  const [overlayChannel, setOverlayChannel] = useState<
    "none" | "baseS" | "metaS" | "metaN" | "metaA" | "metaW"
  >("none");
  const [overlayLayerIndex, setOverlayLayerIndex] = useState(0);
  const [status, setStatus] = useState<"idle" | "initializing" | "ready" | "running">("idle");
  const [error, setError] = useState<string | null>(null);
  const [initSlow, setInitSlow] = useState(false);
  const [metaSnapshot, setMetaSnapshot] = useState<{ layers: number; length: number } | null>(null);
  const [paramsDraft, setParamsDraft] = useState<SimParams>(DEFAULT_PARAMS);
  const [paramsApplied, setParamsApplied] = useState<SimParams>(DEFAULT_PARAMS);
  const [presetId, setPresetId] = useState<string>(DEFAULT_PRESET_ID);
  const [expandedPanels, setExpandedPanels] = useState<Record<string, boolean>>({
    motion: false,
    p1: false,
    p2: false,
    p4: false,
    p5: false,
    p6: false,
    meta: false,
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const histRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const sStackRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const metaAlignCanvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const historyRef = useRef<History>({});
  const chartStepRef = useRef(0);
  const epStepCounterRef = useRef(0);
  const epWindowRef = useRef<EpPoint[]>([]);
  const certCountsRef = useRef({ epNull: 0, sigmaNull: 0, m6Null: 0 });
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

  // Use module-level singleton to avoid React StrictMode double-creation
  const client = getClient();

  const applyPreset = (entry: PresetEntry, sendConfig = true) => {
    const nextDraft: SimParams = { ...DEFAULT_PARAMS, ...entry.params };
    const nextP1 = (nextDraft.pWrite ?? 0) > 0;
    const nextP2 = (nextDraft.pAWrite ?? 0) > 0;
    const nextP4 = (nextDraft.pNWrite ?? 0) > 0;
    const nextP5 = (nextDraft.pSWrite ?? 0) > 0;
    const nextP3 = (nextDraft.p3On ?? 0) > 0;
    const nextP6 = (nextDraft.p6On ?? 0) > 0;

    setP1Enabled(nextP1);
    setP2Enabled(nextP2);
    setP4Enabled(nextP4);
    setP5Enabled(nextP5);
    setP3Enabled(nextP3);
    setP6Enabled(nextP6);
    setParamsDraft(nextDraft);

    const nextApplied: SimParams = {
      ...nextDraft,
      p3On: nextP3 ? 1 : 0,
      p6On: nextP6 ? 1 : 0,
      pWrite: nextP1 ? nextDraft.pWrite : 0,
      pAWrite: nextP2 ? nextDraft.pAWrite : 0,
      pNWrite: nextP4 ? nextDraft.pNWrite : 0,
      pSWrite: nextP5 ? nextDraft.pSWrite : 0,
    };
    setParamsApplied(nextApplied);
    if (sendConfig && status !== "idle" && status !== "initializing") {
      client.send({ type: "config", bondThreshold, params: nextApplied });
    }
  };

  const presetInitRef = useRef(false);
  useEffect(() => {
    if (presetInitRef.current) return;
    presetInitRef.current = true;
    if (selectedPreset) {
      applyPreset(selectedPreset, false);
    }
  }, [selectedPreset]);

  useEffect(() => {
    attachToWindow();
    const offReady = client.onReady(() => {
      setStatus((s) => (s === "running" ? "running" : "ready"));
    });
    const offErr = client.onError((m) => setError(m));
    const offSnap = client.onSnapshot((s) => {
      let currentEpExactRate: number | null = null;
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
      drawFrame(
        canvas,
        s.positions,
        s.bonds,
        overlay,
        overlayField,
        overlayMax
      );
      setEnergy(s.energy);
      setDiagnostics(s.diagnostics);
      const stats = computeGraphStats(s.n, s.bonds);
      setGraphStats(stats);
      setGraphStatsN(s.n);
      const safeSet = computeSafeSetStats(s.baseSField, safeThreshold);
      setMetaSnapshot({ layers: s.metaLayers, length: s.metaField.length });
      if (s.steps > 0) {
        setTotalSteps((prev) => prev + s.steps);
      }
      const epExtras = s.extras?.ep;
      if (epExtras && typeof epExtras.exactTotal === "number") {
        setEpExactTotal(epExtras.exactTotal);
        setEpNaiveTotal(typeof epExtras.naiveTotal === "number" ? epExtras.naiveTotal : null);
      }
      if (s.steps > 0 && epExtras && typeof epExtras.exactTotal === "number") {
        epStepCounterRef.current += s.steps;
        const stepNow = epStepCounterRef.current;
        const points = epWindowRef.current;
        points.push({
          step: stepNow,
          exact: epExtras.exactTotal,
          naive: typeof epExtras.naiveTotal === "number" ? epExtras.naiveTotal : 0,
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
            exactRate = (epExtras.exactTotal - oldest.exact) / dt;
            if (typeof epExtras.naiveTotal === "number") {
              naiveRate = (epExtras.naiveTotal - oldest.naive) / dt;
            }
          }
        }
        currentEpExactRate = exactRate;
        setEpExactRate(exactRate);
        setEpNaiveRate(naiveRate);
      }

      const clockExtras = s.extras?.clock;
      if (
        clockExtras &&
        Number.isFinite(clockExtras.state) &&
        Number.isFinite(clockExtras.q) &&
        Number.isFinite(clockExtras.fwd) &&
        Number.isFinite(clockExtras.bwd)
      ) {
        setClockDebug({
          state: Number(clockExtras.state),
          q: Number(clockExtras.q),
          fwd: Number(clockExtras.fwd),
          bwd: Number(clockExtras.bwd),
        });
      } else {
        setClockDebug(null);
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

      if (s.metaLayers > 0 && cells > 0) {
        const maxMetaPanels = Math.max(0, MAX_STACK_LAYERS - 1);
        const start = Math.max(0, Math.min(sStackMetaStart, Math.max(0, s.metaLayers - 1)));
        const metaCount = Math.min(s.metaLayers - start, maxMetaPanels);
        const baseField = s.baseSField;
        const getMeta = (idx: number) => {
          const offset = idx * cells;
          if (s.metaField.length < offset + cells) return null;
          return s.metaField.subarray(offset, offset + cells);
        };
        const statsList: Array<{ id: string; label: string; stats: SafeSetStats }> = [];
        const addStats = (id: string, label: string, field: Uint8Array) => {
          statsList.push({ id, label, stats: computeSafeSetStats(field, safeThreshold) });
        };
        if (sStackMode === "layers") {
          const baseCanvas = sStackRefs.current["sstack_base"];
          if (baseCanvas) {
            drawFieldHeatmap(baseCanvas, baseField, grid, paramsApplied.lS);
          }
          addStats("sstack_base", "Base", baseField);
          for (let i = 0; i < metaCount; i++) {
            const layerIndex = start + i;
            const metaField = getMeta(layerIndex);
            if (!metaField) continue;
            const id = `sstack_meta_${layerIndex}`;
            const canvas = sStackRefs.current[id];
            if (canvas) {
              drawFieldHeatmap(canvas, metaField, grid, paramsApplied.lS);
            }
            addStats(id, `Meta ${layerIndex}`, metaField);
          }
          if (sStackDiffMean !== null) {
            setSStackDiffMean(null);
          }
        } else if (sStackMode === "diff_base") {
          const meta0 = getMeta(0);
          const baseCanvas = sStackRefs.current["sstack_base"];
          if (baseCanvas) {
            drawFieldHeatmap(baseCanvas, baseField, grid, paramsApplied.lS);
          }
          addStats("sstack_base", "Base", baseField);
          if (meta0) {
            const metaCanvas = sStackRefs.current["sstack_meta_0"];
            if (metaCanvas) {
              drawFieldHeatmap(metaCanvas, meta0, grid, paramsApplied.lS);
            }
            addStats("sstack_meta_0", "Meta 0", meta0);
            const diffCanvas = sStackRefs.current["sstack_diff_base0"];
            if (diffCanvas) {
              drawFieldAbsDiffHeatmap(diffCanvas, baseField, meta0, grid, paramsApplied.lS);
            }
            setSStackDiffMean(meanAbsDiff(baseField, meta0, cells));
          } else if (sStackDiffMean !== null) {
            setSStackDiffMean(null);
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
            addStats(`sstack_meta_${k}`, `Meta ${k}`, metaA);
          }
          if (metaB) {
            const canvasB = sStackRefs.current[`sstack_meta_${k + 1}`];
            if (canvasB) {
              drawFieldHeatmap(canvasB, metaB, grid, paramsApplied.lS);
            }
            addStats(`sstack_meta_${k + 1}`, `Meta ${k + 1}`, metaB);
          }
          if (metaA && metaB) {
            const diffCanvas = sStackRefs.current["sstack_diff_meta_pair"];
            if (diffCanvas) {
              drawFieldAbsDiffHeatmap(diffCanvas, metaA, metaB, grid, paramsApplied.lS);
            }
            setSStackDiffMean(meanAbsDiff(metaA, metaB, cells));
          } else if (sStackDiffMean !== null) {
            setSStackDiffMean(null);
          }
        }
        setLayerSafeStats(statsList);
      } else if (layerSafeStats.length > 0 || sStackDiffMean !== null) {
        setLayerSafeStats([]);
        setSStackDiffMean(null);
      }

      const isNullConfig = !p3Enabled && !p6Enabled;
      if (!isNullConfig) {
        certCountsRef.current = { epNull: 0, sigmaNull: 0, m6Null: 0 };
        if (certPassed.epNull || certPassed.sigmaNull || certPassed.m6Null) {
          setCertPassed({ epNull: false, sigmaNull: false, m6Null: false });
        }
      } else {
        const warmedUp = epStepCounterRef.current >= CERT_MIN_STEPS;
        const updateStable = (key: "epNull" | "sigmaNull" | "m6Null", passNow: boolean) => {
          const counts = certCountsRef.current;
          counts[key] = passNow ? counts[key] + 1 : 0;
          return counts[key] >= CERT_STABILITY_K;
        };
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

        const next = {
          epNull: updateStable("epNull", epPassNow),
          sigmaNull: updateStable("sigmaNull", sigmaPassNow),
          m6Null: updateStable("m6Null", m6PassNow),
        };
        if (
          next.epNull !== certPassed.epNull ||
          next.sigmaNull !== certPassed.sigmaNull ||
          next.m6Null !== certPassed.m6Null
        ) {
          setCertPassed(next);
        }
      }

      chartStepRef.current += Math.max(0, s.steps);
      if (chartStepRef.current >= recordEverySteps) {
        chartStepRef.current = chartStepRef.current % recordEverySteps;
        const ctx: ChartContext = {
          diagnostics: s.diagnostics,
          energy: s.energy,
          stats,
          safeSet,
          n: s.n,
        };
        const history = historyRef.current;
        for (const chart of CHARTS) {
          const series = history[chart.id] ?? (history[chart.id] = []);
          pushHistory(series, chart.value(ctx));
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

      addSnapshot({
        n: s.n,
        energy: s.energy,
        diagnostics: s.diagnostics,
        graphStats: stats,
        positions: s.positions,
        bonds: s.bonds,
        counters: s.counters,
        apparatus: s.apparatus,
        field: s.baseSField,
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
    paramsApplied,
    recordEverySteps,
    safeThreshold,
    sStackMode,
    sStackDiffIndex,
    sStackMetaStart,
    p3Enabled,
    p6Enabled,
    certPassed.epNull,
    certPassed.sigmaNull,
    certPassed.m6Null,
  ]);

  useEffect(() => {
    if (status === "initializing") {
      historyRef.current = {};
      chartStepRef.current = 0;
      epStepCounterRef.current = 0;
      epWindowRef.current = [];
      certCountsRef.current = { epNull: 0, sigmaNull: 0, m6Null: 0 };
      metaAlignHistoryRef.current = { sdiffBase: [], sdiffMeta: [], wdiffMeta: [] };
      metaAlignRef.current = null;
      setTotalSteps(0);
      setEpExactTotal(null);
      setEpNaiveTotal(null);
      setEpExactRate(null);
      setEpNaiveRate(null);
      setClockDebug(null);
      setLayerSafeStats([]);
      setSStackDiffMean(null);
      setMetaAlign(null);
      setMetaAlignBaseline(null);
      setCertPassed({ epNull: false, sigmaNull: false, m6Null: false });
    }
  }, [status]);

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
    if (status === "idle" || status === "initializing") return;
    client.send({ type: "config", bondThreshold, params: paramsApplied });
  }, [bondThreshold, client, paramsApplied, status]);

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

  const canInit = status === "idle" || status === "ready";
  const canRun = status === "ready";
  const canPause = status === "running";

  const statsById = new Map(layerSafeStats.map((entry) => [entry.id, entry.stats]));
  const stackMetaStart = Math.max(0, Math.min(sStackMetaStart, Math.max(0, metaLayerCount - 1)));
  const stackMetaCap = Math.max(0, MAX_STACK_LAYERS - 1);
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

  const showClockPanel =
    clockDebug &&
    (paramsApplied.clockOn >= 0.5 ||
      clockDebug.q !== 0 ||
      clockDebug.fwd !== 0 ||
      clockDebug.bwd !== 0);
  const clockSteps = clockDebug ? clockDebug.fwd + clockDebug.bwd : 0;
  const stepsTotal = epStepCounterRef.current > 0 ? epStepCounterRef.current : totalSteps;
  const clockDrift = clockDebug && stepsTotal > 0 ? clockDebug.q / stepsTotal : 0;

  const presetGroups = PRESET_CATALOG.reduce<Record<string, PresetEntry[]>>((acc, entry) => {
    acc[entry.group] = acc[entry.group] ?? [];
    acc[entry.group].push(entry);
    return acc;
  }, {});

  return (
    <div className="app">
      <div className="panel">
        <h1>Ratchet Playground</h1>
        <p>
          Scaffold UI: worker + WASM sim core. Next: implement null-regime detailed balance kernels
          and Deliverable D diagnostics.
        </p>

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
                params: paramsApplied,
                captureEverySteps: recordEverySteps,
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
                  checked={p6Enabled}
                  onChange={(e) => setP6Enabled(e.target.checked)}
                  disabled={status === "initializing"}
                />
                <span className="legendSwatch legendSwatch--P6" aria-hidden />
                <span className="primitiveLabel">P6 resource</span>
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

        <div className="row twoCol">
          <div>
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
          <div>
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
              disabled={status === "idle" || status === "initializing"}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                color: "var(--text)",
              }}
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
            {selectedPreset?.supports && selectedPreset.supports.length > 0 ? (
              <p style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
                Supports: {selectedPreset.supports.join(", ")}
              </p>
            ) : null}
            {selectedPreset ? (
              <p style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
                Source: {selectedPreset.sourcePath}
              </p>
            ) : null}
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
              if (status !== "idle" && status !== "initializing") {
                client.send({ type: "config", bondThreshold, params: applied });
              }
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
          </div>
        ) : null}
        {certPassed.epNull || certPassed.sigmaNull || certPassed.m6Null ? (
          <div style={{ marginTop: 8 }}>
            <p style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
              Certificates
            </p>
            {certPassed.epNull ? (
              <p style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                ✅ Null EP exact rate ~ 0
              </p>
            ) : null}
            {certPassed.sigmaNull ? (
              <p style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                ✅ Null Σmem ~ 0
              </p>
            ) : null}
            {certPassed.m6Null ? (
              <p style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                ✅ Null M6 motifs ~ 0
              </p>
            ) : null}
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
        {graphStats && graphStatsN ? (
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
        <div className="canvasWrap">
          <canvas ref={canvasRef} />
        </div>
        <div className="chartsPanel">
          {metaLayerCount > 0 ? (
            <div className="sStackSection">
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
                  {sStackMode === "layers" && metaLayerCount > MAX_STACK_LAYERS - 1 ? (
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
    "opDriveOnK",
  ];
  return keys.every((k) => a[k] === b[k]);
}
