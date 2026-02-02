/**
 * Evidence Overlay Framework
 *
 * Provides lightweight drawing helpers and registry for certificate-based overlays
 * that render on top of existing canvases when certificates pass.
 */

// ============================================================================
// Centralized Overlay Palette (Ticket Polish #4)
// ============================================================================

const OVERLAY_STYLE = {
  // Panel backgrounds and borders
  panelBg: "rgba(20, 25, 35, 0.88)",
  panelBgDark: "rgba(20, 25, 35, 0.9)",
  panelBorder: "rgba(100, 120, 140, 0.5)",

  // Text colors
  textMain: "rgba(180, 200, 220, 0.95)",
  textMuted: "rgba(160, 180, 200, 0.85)",

  // Meter styling
  meterOutline: "rgba(150, 170, 190, 0.6)",
  meterCenterTick: "rgba(150, 170, 190, 0.4)",
  meterFillPos: "rgba(100, 180, 255, 0.7)",
  meterFillNeg: "rgba(255, 140, 100, 0.7)",
  meterFillPass: "rgba(100, 200, 140, 0.75)",
  meterFillWarn: "rgba(220, 180, 80, 0.7)",
  meterThresholdTick: "rgba(200, 200, 200, 0.5)",

  // Hatch pattern
  hatchColor: "rgba(80, 220, 140, 1)",

  // Bad cell highlighting
  badCellColor: [255, 120, 80] as const,

  // opK overlay
  opkPanelBg: "rgba(20, 40, 30, 0.92)",
  opkTextColor: "rgba(140, 230, 180, 0.95)",

  // Maintenance overlay
  maintPanelBg: "rgba(30, 35, 25, 0.92)",
  maintTextColor: "rgba(200, 230, 160, 0.95)",
} as const;

// ============================================================================
// Utility: Cached DPR helper (Ticket Polish #5)
// ============================================================================

/**
 * Get device pixel ratio, clamped to a minimum of 1 and floored.
 */
function getDpr(): number {
  return Math.max(1, Math.floor(window.devicePixelRatio || 1));
}

// ============================================================================
// Overlay Target Types
// ============================================================================

/**
 * Identifies which canvas an overlay should be drawn on.
 * - mainCanvas: The main particle + bonds canvas
 * - sStackBase: S layer stack base canvas
 * - sStackMeta:N: Meta layer canvas at index N (e.g., "sStackMeta:0")
 * - sStackDiff: Diff heatmap canvas (base0 or meta pair)
 * - opkHeatmap: opK heatmap canvas
 */
export type EvidenceOverlayTarget =
  | "mainCanvas"
  | "sStackBase"
  | `sStackMeta:${number}`
  | "sStackDiff"
  | "opkHeatmap";

// ============================================================================
// Drawing Helpers
// ============================================================================

export type CornerLabelOptions = {
  corner?: "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
  padding?: number;
  alpha?: number;
  fontSize?: number;
  bgColor?: string;
  textColor?: string;
};

/**
 * Clears an overlay area (or the full canvas if needed).
 * For overlays drawn on top, you typically don't need to call this -
 * the base canvas clear handles it.
 */
export function clearOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  ctx.clearRect(0, 0, width, height);
}

/**
 * Draws a subtle corner label box with text.
 * Used for status/info overlays on canvases.
 */
export function drawCornerLabel(
  ctx: CanvasRenderingContext2D,
  textLines: string[],
  options: CornerLabelOptions = {}
): void {
  const {
    corner = "topRight",
    padding = 6,
    alpha = 0.85,
    fontSize = 10,
    bgColor = OVERLAY_STYLE.panelBgDark,
    textColor = OVERLAY_STYLE.textMain,
  } = options;

  if (textLines.length === 0) return;

  const dpr = getDpr();
  const scaledFontSize = fontSize * dpr;
  const scaledPadding = padding * dpr;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${scaledFontSize}px monospace`;
  ctx.textBaseline = "top";

  // Measure text to determine box size
  let maxWidth = 0;
  for (const line of textLines) {
    const m = ctx.measureText(line);
    if (m.width > maxWidth) maxWidth = m.width;
  }

  const lineHeight = scaledFontSize * 1.3;
  const boxWidth = maxWidth + scaledPadding * 2;
  const boxHeight = textLines.length * lineHeight + scaledPadding * 2;

  // Determine position based on corner
  let x: number;
  let y: number;
  const margin = scaledPadding;

  switch (corner) {
    case "topLeft":
      x = margin;
      y = margin;
      break;
    case "topRight":
      x = ctx.canvas.width - boxWidth - margin;
      y = margin;
      break;
    case "bottomLeft":
      x = margin;
      y = ctx.canvas.height - boxHeight - margin;
      break;
    case "bottomRight":
      x = ctx.canvas.width - boxWidth - margin;
      y = ctx.canvas.height - boxHeight - margin;
      break;
  }

  // Clamp position to stay on canvas
  x = Math.max(margin, Math.min(x, ctx.canvas.width - boxWidth - margin));
  y = Math.max(margin, Math.min(y, ctx.canvas.height - boxHeight - margin));

  // Draw background box
  ctx.fillStyle = bgColor;
  ctx.fillRect(x, y, boxWidth, boxHeight);

  // Draw border
  ctx.strokeStyle = OVERLAY_STYLE.panelBorder;
  ctx.lineWidth = dpr;
  ctx.strokeRect(x, y, boxWidth, boxHeight);

  // Draw text
  ctx.fillStyle = textColor;
  for (let i = 0; i < textLines.length; i++) {
    ctx.fillText(textLines[i], x + scaledPadding, y + scaledPadding + i * lineHeight);
  }

  ctx.restore();
}

export type GridMaskOptions = {
  alpha?: number;
  maxValue?: number;
  mode?: "heat" | "binary";
  threshold?: number;
  color?: [number, number, number];
};

/**
 * Draws a per-cell overlay mask on a grid canvas.
 * Used for highlighting specific cells based on U8 values.
 */
export function drawGridMaskOverlay(
  ctx: CanvasRenderingContext2D,
  grid: number,
  valuesU8: Uint8Array,
  options: GridMaskOptions = {}
): void {
  const {
    alpha = 0.4,
    maxValue = 255,
    mode = "heat",
    threshold = 0,
    color = [255, 200, 100],
  } = options;

  const cells = grid * grid;
  if (grid <= 0 || valuesU8.length < cells) return;

  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const cellW = w / grid;
  const cellH = h / grid;
  const max = Math.max(1, maxValue);

  ctx.save();
  ctx.globalAlpha = alpha;

  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const idx = y * grid + x;
      const v = valuesU8[idx] ?? 0;
      if (v <= threshold) continue;

      if (mode === "binary") {
        ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
      } else {
        // Heat mode: intensity varies with value
        const t = Math.min(1, v / max);
        ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${t})`;
      }
      ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
    }
  }

  ctx.restore();
}

export type HatchOptions = {
  spacingPx?: number;
  alpha?: number;
  color?: string;
  lineWidth?: number;
};

/**
 * Draws a subtle diagonal hatch pattern over the entire canvas.
 * Used to indicate "pass" state visually even when no data to highlight.
 */
export function drawHatch(
  ctx: CanvasRenderingContext2D,
  options: HatchOptions = {}
): void {
  const {
    spacingPx = 12,
    alpha = 0.15,
    color = OVERLAY_STYLE.hatchColor,
    lineWidth = 1,
  } = options;

  const dpr = getDpr();
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const spacing = spacingPx * dpr;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth * dpr;
  ctx.beginPath();

  // Draw diagonal lines from top-left to bottom-right direction
  const maxDim = Math.max(w, h) * 2;
  for (let offset = -maxDim; offset < maxDim; offset += spacing) {
    ctx.moveTo(offset, 0);
    ctx.lineTo(offset + h, h);
  }

  ctx.stroke();
  ctx.restore();
}

export type BadCellsOptions = {
  alpha?: number;
  color?: readonly [number, number, number] | [number, number, number];
  borderOnly?: boolean;
};

/**
 * Draws rectangles for specific "bad" cells by index.
 * O(#badCells) complexity - uses precomputed index list.
 */
export function drawBadCells(
  ctx: CanvasRenderingContext2D,
  grid: number,
  badCellIndices: Uint32Array | number[],
  options: BadCellsOptions = {}
): void {
  const {
    alpha = 0.5,
    color = OVERLAY_STYLE.badCellColor,
    borderOnly = false,
  } = options;

  if (grid <= 0 || badCellIndices.length === 0) return;

  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const cellW = w / grid;
  const cellH = h / grid;
  const dpr = getDpr();

  ctx.save();
  ctx.globalAlpha = alpha;

  if (borderOnly) {
    ctx.strokeStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
    ctx.lineWidth = 2 * dpr;
    for (let i = 0; i < badCellIndices.length; i++) {
      const idx = badCellIndices[i]!;
      const x = idx % grid;
      const y = Math.floor(idx / grid);
      ctx.strokeRect(x * cellW, y * cellH, cellW, cellH);
    }
  } else {
    ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
    for (let i = 0; i < badCellIndices.length; i++) {
      const idx = badCellIndices[i]!;
      const x = idx % grid;
      const y = Math.floor(idx / grid);
      ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
    }
  }

  ctx.restore();
}

// ============================================================================
// Stamp Strip Drawing Helpers (Ticket 3)
// ============================================================================

/** Maximum characters for formatted values to keep stamps compact */
const FORMAT_MAX_CHARS = 9;

/**
 * Format a small number in compact exponential notation.
 * e.g., 0.000123 -> "1.2e-4"
 * Handles NaN, Infinity, null, undefined gracefully.
 */
function formatTiny(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (Number.isNaN(value)) return "NaN";
  if (!Number.isFinite(value)) return value > 0 ? "+∞" : "-∞";

  const absVal = Math.abs(value);
  if (absVal === 0) return "0";

  let result: string;
  if (absVal >= 0.01 && absVal < 1000) {
    result = value.toFixed(3);
  } else {
    const exp = Math.floor(Math.log10(absVal));
    const mantissa = value / Math.pow(10, exp);
    result = `${mantissa.toFixed(1)}e${exp}`;
  }

  // Truncate if too long
  if (result.length > FORMAT_MAX_CHARS) {
    result = result.slice(0, FORMAT_MAX_CHARS);
  }
  return result;
}

/**
 * Draw a signed meter (zero-centered bar).
 * Positive values fill right from center, negative fill left.
 */
function drawSignedMeter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  value: number | null | undefined,
  maxAbs: number,
  dpr: number
): void {
  // Draw outline
  ctx.strokeStyle = OVERLAY_STYLE.meterOutline;
  ctx.lineWidth = dpr;
  ctx.strokeRect(x, y, w, h);

  // Draw center tick
  const centerX = x + w / 2;
  ctx.beginPath();
  ctx.moveTo(centerX, y);
  ctx.lineTo(centerX, y + h);
  ctx.strokeStyle = OVERLAY_STYLE.meterCenterTick;
  ctx.stroke();

  if (value === null || value === undefined || !Number.isFinite(value)) return;

  // Fill based on sign
  const normalizedVal = Math.max(-1, Math.min(1, value / Math.max(1e-12, maxAbs)));
  const fillWidth = Math.abs(normalizedVal) * (w / 2);
  const drawH = Math.max(0, h - 2);

  if (drawH <= 0) return;

  if (normalizedVal >= 0) {
    const drawW = Math.max(0, fillWidth);
    if (drawW > 0) {
      ctx.fillStyle = OVERLAY_STYLE.meterFillPos;
      ctx.fillRect(centerX, y + 1, drawW, drawH);
    }
  } else {
    const drawW = Math.max(0, fillWidth);
    if (drawW > 0) {
      ctx.fillStyle = OVERLAY_STYLE.meterFillNeg;
      ctx.fillRect(centerX - drawW, y + 1, drawW, drawH);
    }
  }
}

/**
 * Draw an unsigned meter (left-to-right bar).
 * Value fills from left edge toward right.
 */
function drawUnsignedMeter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  valueAbs: number | null | undefined,
  maxAbs: number,
  dpr: number
): void {
  // Draw outline
  ctx.strokeStyle = OVERLAY_STYLE.meterOutline;
  ctx.lineWidth = dpr;
  ctx.strokeRect(x, y, w, h);

  if (valueAbs === null || valueAbs === undefined || !Number.isFinite(valueAbs)) return;

  // Fill from left
  const normalizedVal = Math.min(1, Math.abs(valueAbs) / Math.max(1e-12, maxAbs));
  const fillWidth = normalizedVal * w;
  const drawW = Math.max(0, fillWidth - 1);
  const drawH = Math.max(0, h - 2);

  if (drawW > 0 && drawH > 0) {
    ctx.fillStyle = OVERLAY_STYLE.meterFillPos;
    ctx.fillRect(x + 1, y + 1, drawW, drawH);
  }
}

/**
 * Draw an R gauge (fills from Rmin toward Rmax).
 * Used for TUR R value where passing means R >= 1.
 */
function drawRGauge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  R: number | null | undefined,
  Rmin: number,
  Rmax: number,
  dpr: number
): void {
  // Draw outline
  ctx.strokeStyle = OVERLAY_STYLE.meterOutline;
  ctx.lineWidth = dpr;
  ctx.strokeRect(x, y, w, h);

  if (R === null || R === undefined || !Number.isFinite(R)) return;

  // Clamp R between 0 and Rmax for display
  const clampedR = Math.max(0, Math.min(Rmax, R));
  const normalizedR = clampedR / Rmax;
  const fillWidth = normalizedR * w;
  const drawW = Math.max(0, fillWidth - 1);
  const drawH = Math.max(0, h - 2);

  // Color: green if R >= Rmin, otherwise yellow
  const isPass = R >= Rmin;
  if (drawW > 0 && drawH > 0) {
    ctx.fillStyle = isPass ? OVERLAY_STYLE.meterFillPass : OVERLAY_STYLE.meterFillWarn;
    ctx.fillRect(x + 1, y + 1, drawW, drawH);
  }

  // Draw Rmin threshold tick
  const thresholdX = x + (Rmin / Rmax) * w;
  ctx.beginPath();
  ctx.moveTo(thresholdX, y);
  ctx.lineTo(thresholdX, y + h);
  ctx.strokeStyle = OVERLAY_STYLE.meterThresholdTick;
  ctx.lineWidth = dpr;
  ctx.stroke();
}

/**
 * Draw the certificate stamp strip on the main canvas.
 * Shows a compact vertical strip with one row per passing cert.
 */
function drawCertStampStrip(ctx: CanvasRenderingContext2D, env: EvidenceEnv): void {
  const dpr = getDpr();
  const { certPassed, stamps } = env;

  // Collect rows to draw
  type StampRow = {
    label: string;
    type: "signed" | "unsigned" | "rgauge";
    value: number | null | undefined;
    maxAbs: number;
    rMin?: number;
    rMax?: number;
  };

  const rows: StampRow[] = [];

  if (certPassed.epNull) {
    rows.push({
      label: "EP",
      type: "signed",
      value: stamps?.epExactRate,
      maxAbs: stamps?.epExactRateMax ?? 1e-4,
    });
  }

  if (certPassed.sigmaNull) {
    rows.push({
      label: "Σmem",
      type: "unsigned",
      value: stamps?.sigmaMem !== null && stamps?.sigmaMem !== undefined
        ? Math.abs(stamps.sigmaMem)
        : null,
      maxAbs: stamps?.sigmaMemMax ?? 0.01,
    });
  }

  if (certPassed.m6Null) {
    rows.push({
      label: "M6",
      type: "unsigned",
      value: stamps?.m6MaxAbs,
      maxAbs: stamps?.m6MaxAbsMax ?? 0.01,
    });
  }

  if (certPassed.clockNull) {
    rows.push({
      label: "clk",
      type: "signed",
      value: stamps?.clockDrift,
      maxAbs: stamps?.clockDriftMax ?? 5e-4,
    });
  }

  if (certPassed.tur) {
    rows.push({
      label: "R",
      type: "rgauge",
      value: stamps?.turR,
      maxAbs: 1, // not used for rgauge
      rMin: stamps?.turRMin ?? 1.0,
      rMax: stamps?.turRMax ?? 2.0,
    });
  }

  if (rows.length === 0) return;

  // Layout constants (in CSS pixels, will be scaled by dpr)
  const padding = 5 * dpr;
  const rowHeight = 14 * dpr;
  const labelWidth = 32 * dpr;
  const meterWidth = 40 * dpr;
  const valueWidth = 50 * dpr;
  const rowGap = 3 * dpr;
  const fontSize = 9 * dpr;

  const totalWidth = padding * 2 + labelWidth + meterWidth + valueWidth;
  const totalHeight = padding * 2 + rows.length * rowHeight + (rows.length - 1) * rowGap;

  // Position in top-right corner, with clamping for small canvases
  const margin = 6 * dpr;
  let boxX = ctx.canvas.width - totalWidth - margin;
  let boxY = margin;

  // Clamp X to stay on canvas
  boxX = Math.max(margin, boxX);

  // If stamp strip would overflow bottom, try to fit by clamping Y
  if (boxY + totalHeight > ctx.canvas.height - margin) {
    boxY = Math.max(margin, ctx.canvas.height - totalHeight - margin);
  }

  ctx.save();

  // Draw background
  ctx.fillStyle = OVERLAY_STYLE.panelBg;
  ctx.fillRect(boxX, boxY, totalWidth, totalHeight);

  // Draw border
  ctx.strokeStyle = OVERLAY_STYLE.panelBorder;
  ctx.lineWidth = dpr;
  ctx.strokeRect(boxX, boxY, totalWidth, totalHeight);

  // Draw each row
  ctx.font = `${fontSize}px monospace`;
  ctx.textBaseline = "middle";

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowY = boxY + padding + i * (rowHeight + rowGap);
    const textY = rowY + rowHeight / 2;

    // Label
    ctx.fillStyle = OVERLAY_STYLE.textMain;
    ctx.fillText(row.label, boxX + padding, textY);

    // Meter
    const meterX = boxX + padding + labelWidth;
    const meterY = rowY + 2 * dpr;
    const meterH = rowHeight - 4 * dpr;

    if (row.type === "signed") {
      drawSignedMeter(ctx, meterX, meterY, meterWidth, meterH, row.value, row.maxAbs, dpr);
    } else if (row.type === "unsigned") {
      drawUnsignedMeter(ctx, meterX, meterY, meterWidth, meterH, row.value, row.maxAbs, dpr);
    } else if (row.type === "rgauge") {
      drawRGauge(ctx, meterX, meterY, meterWidth, meterH, row.value, row.rMin ?? 1, row.rMax ?? 2, dpr);
    }

    // Value text
    const valueX = meterX + meterWidth + 4 * dpr;
    ctx.fillStyle = OVERLAY_STYLE.textMuted;
    ctx.fillText(formatTiny(row.value), valueX, textY);
  }

  ctx.restore();
}

export type LifeHudState = {
  updatedAtSteps: number;
  damageCells: number | null;
  damagePct: number | null;
  trendPerSample: number | null;
  trendLabel: string;
  epExactRate: number | null;
  epRepairRate: number | null;
};

function formatHudValue(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e4 || (abs > 0 && abs < 1e-3)) {
    return value.toExponential(2);
  }
  return value.toFixed(3);
}

export function drawLifeHud(ctx: CanvasRenderingContext2D, hud: LifeHudState): void {
  const dpr = getDpr();
  const fontSize = 13 * dpr;
  const lineHeight = fontSize * 1.35;
  const padding = 8 * dpr;

  const damageLabel =
    hud.damageCells !== null
      ? `Damage: ${hud.damageCells} cells${
          hud.damagePct !== null ? ` (${(hud.damagePct * 100).toFixed(1)}%)` : ""
        }`
      : "Damage: —";

  let trendSymbol = "—";
  if (hud.trendLabel === "healing") trendSymbol = "↓";
  if (hud.trendLabel === "worsening") trendSymbol = "↑";
  if (hud.trendLabel === "stable") trendSymbol = "→";
  const trendLabel = hud.trendLabel === "—" ? "—" : `${trendSymbol} ${hud.trendLabel}`;
  const trendLine = `Trend: ${trendLabel}`;

  const epText = formatHudValue(hud.epExactRate);
  const repairText = formatHudValue(hud.epRepairRate);
  const costLine = `Cost: EP ${epText} | Repair ${repairText}`;

  const lines = [damageLabel, trendLine, costLine];

  ctx.save();
  ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textBaseline = "top";

  let maxWidth = 0;
  for (const line of lines) {
    const m = ctx.measureText(line);
    if (m.width > maxWidth) maxWidth = m.width;
  }

  const boxWidth = maxWidth + padding * 2;
  const boxHeight = lines.length * lineHeight + padding * 2;
  const x = padding;
  const y = ctx.canvas.height - boxHeight - padding;

  ctx.fillStyle = "rgba(15, 20, 28, 0.78)";
  ctx.fillRect(x, y, boxWidth, boxHeight);
  ctx.strokeStyle = OVERLAY_STYLE.panelBorder;
  ctx.lineWidth = 1 * dpr;
  ctx.strokeRect(x, y, boxWidth, boxHeight);

  ctx.fillStyle = "rgba(210, 220, 235, 0.95)";
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i]!, x + padding, y + padding + i * lineHeight);
  }

  ctx.restore();
}

export type InjuryMapOptions = {
  alpha?: number;
  borderOnly?: boolean;
};

export function drawInjuryMapOverlay(
  ctx: CanvasRenderingContext2D | null,
  grid: number,
  badCellIdx: Uint32Array,
  legendLines: string[],
  options: InjuryMapOptions = {}
): void {
  if (!ctx || grid <= 0) return;
  const { alpha = 0.85, borderOnly = true } = options;
  if (badCellIdx.length > 0) {
    drawBadCells(ctx, grid, badCellIdx, {
      alpha,
      color: OVERLAY_STYLE.badCellColor,
      borderOnly,
    });
  }
  if (legendLines.length > 0) {
    drawCornerLabel(ctx, legendLines, {
      corner: "topRight",
      alpha: 0.9,
      bgColor: OVERLAY_STYLE.panelBg,
      textColor: OVERLAY_STYLE.textMain,
    });
  }
}

// ============================================================================
// Evidence Environment (passed to overlay draw functions)
// ============================================================================

export type CertPassedState = {
  epNull: boolean;
  sigmaNull: boolean;
  m6Null: boolean;
  clockNull: boolean;
  tur: boolean;
  opkBudget: boolean;
  codeMaint: boolean;
};

export type EvidenceEnv = {
  gridSize: number;
  totalSteps: number;
  certPassed: CertPassedState;
  canvasWidth: number;
  canvasHeight: number;

  // opK evidence data (optional)
  opk?: {
    badCells?: number;
    budgetK?: number;
    computedAtSteps?: number;
  };

  // Maintenance evidence data (optional)
  maintenance?: {
    errF0_5?: number | null;
    badCells?: number;
    tau?: number;
    badCellIdx?: Uint32Array;
  };

  // Context for S-stack overlays (optional)
  context?: {
    sStackMode?: "layers" | "diff_base" | "diff_meta";
    sStackDiffKind?: "base0" | "metaPair";
    sStackLayerIndex?: number;
  };

  // Stamp strip scalar values (Ticket 3)
  stamps?: {
    epExactRate?: number | null;
    epExactRateMax?: number;

    sigmaMem?: number | null;
    sigmaMemMax?: number;

    m6MaxAbs?: number | null;
    m6MaxAbsMax?: number;

    clockDrift?: number | null;
    clockDriftMax?: number;

    turR?: number | null;
    turRMin?: number;
    turRMax?: number;
  };
};

// ============================================================================
// Overlay Spec and Registry
// ============================================================================

export type EvidenceOverlaySpec = {
  id: string;
  target: EvidenceOverlayTarget;
  /** Return true if this overlay should be drawn given current state */
  condition: (env: EvidenceEnv) => boolean;
  /** Draw the overlay on the given context */
  draw: (ctx: CanvasRenderingContext2D, env: EvidenceEnv) => void;
};

/**
 * Registry of all evidence overlays.
 */
export const EVIDENCE_OVERLAYS: EvidenceOverlaySpec[] = [
  // =========================================================================
  // Main canvas stamp strip (Ticket 3 - replaces placeholder)
  // =========================================================================
  {
    id: "cert-stamp-strip",
    target: "mainCanvas",
    condition: (env) =>
      env.certPassed.epNull ||
      env.certPassed.sigmaNull ||
      env.certPassed.m6Null ||
      env.certPassed.clockNull ||
      env.certPassed.tur,
    draw: (ctx, env) => {
      drawCertStampStrip(ctx, env);
    },
  },

  // =========================================================================
  // opK budget overlay on opkHeatmap (Ticket 2)
  // =========================================================================
  {
    id: "opk-budget-ok",
    target: "opkHeatmap",
    condition: (env) => env.certPassed.opkBudget === true,
    draw: (ctx, env) => {
      // Draw subtle hatch to indicate pass state
      drawHatch(ctx, {
        spacingPx: 10,
        alpha: 0.12,
        color: OVERLAY_STYLE.hatchColor,
      });

      // Draw corner label with details
      const lines: string[] = ["opK budget OK"];
      if (env.opk?.badCells !== undefined) {
        lines.push(`violations: ${env.opk.badCells}`);
      }
      if (env.opk?.budgetK !== undefined) {
        lines.push(`budgetK: ${env.opk.budgetK}`);
      }
      if (env.opk?.computedAtSteps !== undefined) {
        lines.push(`payload@${env.opk.computedAtSteps}`);
      }

      drawCornerLabel(ctx, lines, {
        corner: "topLeft",
        alpha: 0.9,
        bgColor: OVERLAY_STYLE.opkPanelBg,
        textColor: OVERLAY_STYLE.opkTextColor,
      });
    },
  },

  // =========================================================================
  // Maintenance overlay on sStackDiff (Ticket 2)
  // =========================================================================
  {
    id: "maint-codeMaint-diff",
    target: "sStackDiff",
    condition: (env) =>
      env.certPassed.codeMaint === true &&
      env.context?.sStackDiffKind === "base0",
    draw: (ctx, env) => {
      // Draw bad cells if we have the index list
      if (env.maintenance?.badCellIdx && env.maintenance.badCellIdx.length > 0) {
        drawBadCells(ctx, env.gridSize, env.maintenance.badCellIdx, {
          alpha: 0.35,
          color: OVERLAY_STYLE.badCellColor,
          borderOnly: false,
        });
      }

      // Draw corner label with maintenance info
      const lines: string[] = ["maintenance OK"];
      if (env.maintenance?.badCells !== undefined) {
        lines.push(`bad cells: ${env.maintenance.badCells}`);
      }
      if (env.maintenance?.errF0_5 !== undefined && env.maintenance.errF0_5 !== null) {
        lines.push(`errF0.5: ${env.maintenance.errF0_5.toFixed(3)}`);
      }
      if (env.maintenance?.tau !== undefined) {
        lines.push(`tau: ${env.maintenance.tau}`);
      }

      drawCornerLabel(ctx, lines, {
        corner: "topLeft",
        alpha: 0.9,
        bgColor: OVERLAY_STYLE.maintPanelBg,
        textColor: OVERLAY_STYLE.maintTextColor,
      });
    },
  },

  // =========================================================================
  // Maintenance fallback overlay on sStackBase (Ticket 2)
  // =========================================================================
  {
    id: "maint-codeMaint-base",
    target: "sStackBase",
    condition: (env) => env.certPassed.codeMaint === true,
    draw: (ctx, env) => {
      // Label only (no cell rectangles on base canvas)
      const lines: string[] = ["maintenance OK"];
      if (env.maintenance?.badCells !== undefined) {
        lines.push(`bad cells: ${env.maintenance.badCells}`);
      }
      if (env.maintenance?.errF0_5 !== undefined && env.maintenance.errF0_5 !== null) {
        lines.push(`errF0.5: ${env.maintenance.errF0_5.toFixed(3)}`);
      }

      drawCornerLabel(ctx, lines, {
        corner: "topLeft",
        alpha: 0.85,
        fontSize: 9,
        bgColor: OVERLAY_STYLE.maintPanelBg,
        textColor: OVERLAY_STYLE.maintTextColor,
      });
    },
  },

  // =========================================================================
  // Maintenance fallback overlay on sStackMeta:0 (Ticket 2)
  // =========================================================================
  {
    id: "maint-codeMaint-meta0",
    target: "sStackMeta:0",
    condition: (env) => env.certPassed.codeMaint === true,
    draw: (ctx, env) => {
      // Label only (no cell rectangles on meta canvas)
      const lines: string[] = ["maintenance OK"];
      if (env.maintenance?.badCells !== undefined) {
        lines.push(`bad cells: ${env.maintenance.badCells}`);
      }

      drawCornerLabel(ctx, lines, {
        corner: "topLeft",
        alpha: 0.85,
        fontSize: 9,
        bgColor: OVERLAY_STYLE.maintPanelBg,
        textColor: OVERLAY_STYLE.maintTextColor,
      });
    },
  },
];

// ============================================================================
// Overlay Dispatcher
// ============================================================================

/**
 * Draws all registered overlays that match the given target and whose
 * conditions are satisfied.
 *
 * Call this after the base canvas content is drawn.
 */
export function drawEvidenceOverlays(
  target: EvidenceOverlayTarget,
  canvas: HTMLCanvasElement,
  env: EvidenceEnv
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Update env with canvas dimensions
  const fullEnv: EvidenceEnv = {
    ...env,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
  };

  // Find and draw matching overlays
  for (const spec of EVIDENCE_OVERLAYS) {
    if (spec.target !== target) continue;
    if (!spec.condition(fullEnv)) continue;
    spec.draw(ctx, fullEnv);
  }
}

/**
 * Checks if there are any overlays registered for a given target.
 * Useful for skipping overlay calls entirely when not needed.
 */
export function hasOverlaysForTarget(target: EvidenceOverlayTarget): boolean {
  return EVIDENCE_OVERLAYS.some((spec) => spec.target === target);
}
