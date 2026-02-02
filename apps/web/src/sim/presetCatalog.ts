import type { SimParams } from "./workerMessages";

import baseNullBalancedRaw from "../../../../scripts/params/base_null_balanced.json";
import baseP6DriveRaw from "../../../../scripts/params/base_p6_drive.json";
import baseP3PumpRaw from "../../../../scripts/params/base_p3_pump_minimal.json";
import baseP3P6ComboRaw from "../../../../scripts/params/base_p3p6_combo_minimal.json";
import metaNullDecoupledRaw from "../../../../scripts/params/meta/meta2_null_decoupled.json";
import metaNullCoupledRaw from "../../../../scripts/params/meta/meta2_null_coupled.json";
import metaP6DriveRaw from "../../../../scripts/params/meta/meta2_p6_drive_coupled.json";
import clockNullRaw from "../../../../scripts/params/clock_code/clock_null.json";
import clockP6Raw from "../../../../scripts/params/clock_code/clock_p6.json";
import clockTurRaw from "../../../../scripts/params/clock_code/clock_tur_sweep_base.json";
import codeNullRaw from "../../../../scripts/params/clock_code/code_null.json";
import codeP6DriveRaw from "../../../../scripts/params/clock_code/code_p6_drive.json";
import codeP6ClockGatedRaw from "../../../../scripts/params/clock_code/code_p6_clock_gated.json";
import codeDeadlineGatedClockRaw from "../../../../scripts/params/clock_code/code_deadline_gated_clock.json";
import opNullEnergyRaw from "../../../../scripts/params/op_coupling/opS_null_energy.json";
import opP6DriveRaw from "../../../../scripts/params/op_coupling/opS_p6_drive_only.json";
import opDeadlineBestRaw from "../../../../scripts/params/op_coupling/deadline_opk_best.json";
import all6MetaP3P6Raw from "../../../../scripts/params/showcase/all6_meta_p3p6_drive.json";
import all6ClockTurRaw from "../../../../scripts/params/showcase/all6_clock_tur.json";
import all6OpkRaw from "../../../../scripts/params/showcase/all6_opk_coupling.json";
import all6CodeMaintRaw from "../../../../scripts/params/showcase/all6_code_maintenance.json";
import all6InjuryHealingRaw from "../../../../scripts/params/showcase/all6_injury_healing.json";

export type PresetEntry = {
  id: string;
  group: string;
  label: string;
  sourcePath: string;
  supports?: string[];
  tags?: string[];
  blurb?: string;
  recommendedView?: string;
  params: Partial<SimParams>;
};

export function sanitizeParams(raw: Record<string, unknown>): Partial<SimParams> {
  const params: Partial<SimParams> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      (params as Record<string, number>)[key] = value;
    }
  }
  return params;
}

const toParams = (raw: Record<string, unknown>) => sanitizeParams(raw);

export const PRESET_CATALOG: PresetEntry[] = [
  {
    id: "showcase_all6_meta_p3p6_drive",
    group: "Showcase (All 6 primitives)",
    label: "All6 showcase: Meta + P3/P6 drive",
    sourcePath: "scripts/params/showcase/all6_meta_p3p6_drive.json",
    supports: ["showcase:all6", "C_META_ETA_ALIGN_1"],
    tags: ["Shows: meta alignment under drive", "Watch: sdiff drops"],
    blurb: "Drive with P3/P6 and eta to tighten alignment between base and meta layers.",
    recommendedView: "Meta alignment charts + S Layer Stack",
    params: toParams(all6MetaP3P6Raw as Record<string, unknown>),
  },
  {
    id: "showcase_all6_clock_tur",
    group: "Showcase (All 6 primitives)",
    label: "All6 showcase: Clock/TUR friendly",
    sourcePath: "scripts/params/showcase/all6_clock_tur.json",
    supports: ["showcase:all6", "C_CLOCK_DRIFT_1", "C_TUR_1", "badge:tur"],
    tags: ["Shows: Clock drift under drive", "Shows: TUR ≥ 1"],
    blurb: "Under drive, clock current becomes nonzero and the TUR estimate clears the bound.",
    params: toParams(all6ClockTurRaw as Record<string, unknown>),
  },
  {
    id: "showcase_all6_opk_coupling",
    group: "Showcase (All 6 primitives)",
    label: "All6 showcase: opK coupling",
    sourcePath: "scripts/params/showcase/all6_opk_coupling.json",
    supports: ["showcase:all6", "C_OPK_INV_1", "C_OPK_EFFECT_1", "badge:opk-budget"],
    tags: ["Shows: opK budget constraint", "Watch: residuals stay low"],
    blurb: "Token budgets remain conserved while coupling influences alignment.",
    params: toParams(all6OpkRaw as Record<string, unknown>),
  },
  {
    id: "showcase_all6_code_maintenance",
    group: "Showcase (All 6 primitives)",
    label: "All6 showcase: Code maintenance",
    sourcePath: "scripts/params/showcase/all6_code_maintenance.json",
    supports: ["showcase:all6", "C_CODE_MAINT_1", "badge:code-maint"],
    tags: ["Shows: repair lowers mismatch", "Watch: error collapse"],
    blurb: "Drive-enabled repair reduces mismatch and reconstruction error over time.",
    params: toParams(all6CodeMaintRaw as Record<string, unknown>),
  },
  {
    id: "showcase_all6_injury_healing",
    group: "Showcase (All 6 primitives)",
    label: "All6 showcase: Injury → Healing",
    sourcePath: "scripts/params/showcase/all6_injury_healing.json",
    supports: ["showcase:injury-healing", "C_CODE_MAINT_1"],
    tags: ["Shows: Injury→Healing", "Watch: injury map shrinks", "Compare: No repair"],
    blurb: "Inject damage into Meta0 and watch mismatch shrink under drive.",
    recommendedView: "S Diff |Base−Meta0| + Injury map + Life HUD",
    params: toParams(all6InjuryHealingRaw as Record<string, unknown>),
  },
  {
    id: "base_null_balanced",
    group: "Base",
    label: "Base null balanced",
    sourcePath: "scripts/params/base_null_balanced.json",
    supports: ["C_BASE_NULL_1", "C_EP_EXACT_NULL_1", "badge:ep-null"],
    tags: ["Control: Null baseline", "Shows: EP≈0"],
    params: toParams(baseNullBalancedRaw as Record<string, unknown>),
  },
  {
    id: "base_p6_drive",
    group: "Base",
    label: "Base P6 drive",
    sourcePath: "scripts/params/base_p6_drive.json",
    supports: ["C_P6_SEP_1"],
    params: toParams(baseP6DriveRaw as Record<string, unknown>),
  },
  {
    id: "base_p3_pump_minimal",
    group: "Base",
    label: "Base P3 pump minimal",
    sourcePath: "scripts/params/base_p3_pump_minimal.json",
    supports: ["C_P3_OBS_1"],
    params: toParams(baseP3PumpRaw as Record<string, unknown>),
  },
  {
    id: "base_p3p6_combo_minimal",
    group: "Base",
    label: "Base P3+P6 combo minimal",
    sourcePath: "scripts/params/base_p3p6_combo_minimal.json",
    supports: ["C_BASE_RETUNE_P3P6_1"],
    params: toParams(baseP3P6ComboRaw as Record<string, unknown>),
  },
  {
    id: "meta2_null_decoupled",
    group: "Meta",
    label: "Meta2 null decoupled",
    sourcePath: "scripts/params/meta/meta2_null_decoupled.json",
    supports: ["C_META_ETA_ALIGN_1"],
    params: toParams(metaNullDecoupledRaw as Record<string, unknown>),
  },
  {
    id: "meta2_null_coupled",
    group: "Meta",
    label: "Meta2 null coupled",
    sourcePath: "scripts/params/meta/meta2_null_coupled.json",
    supports: ["C_META_NULL_1", "C_META_ETA_ALIGN_1"],
    params: toParams(metaNullCoupledRaw as Record<string, unknown>),
  },
  {
    id: "meta2_p6_drive_coupled",
    group: "Meta",
    label: "Meta2 P6 drive coupled",
    sourcePath: "scripts/params/meta/meta2_p6_drive_coupled.json",
    supports: ["C_META_ETA_ALIGN_1", "C_P6_SEP_1"],
    params: toParams(metaP6DriveRaw as Record<string, unknown>),
  },
  {
    id: "clock_null",
    group: "Clock/TUR",
    label: "Clock null",
    sourcePath: "scripts/params/clock_code/clock_null.json",
    supports: ["C_CLOCK_DRIFT_1", "badge:clock-null"],
    tags: ["Control: Null clock", "Shows: drift≈0"],
    params: toParams(clockNullRaw as Record<string, unknown>),
  },
  {
    id: "clock_p6",
    group: "Clock/TUR",
    label: "Clock P6 drive",
    sourcePath: "scripts/params/clock_code/clock_p6.json",
    supports: ["C_CLOCK_DRIFT_1", "C_TUR_1", "badge:tur"],
    params: toParams(clockP6Raw as Record<string, unknown>),
  },
  {
    id: "clock_tur_sweep_base",
    group: "Clock/TUR",
    label: "Clock TUR sweep base",
    sourcePath: "scripts/params/clock_code/clock_tur_sweep_base.json",
    supports: ["C_TUR_1", "badge:tur"],
    params: toParams(clockTurRaw as Record<string, unknown>),
  },
  {
    id: "code_null",
    group: "Maintenance",
    label: "Code null",
    sourcePath: "scripts/params/clock_code/code_null.json",
    supports: ["C_CODE_MAINT_1"],
    params: toParams(codeNullRaw as Record<string, unknown>),
  },
  {
    id: "code_p6_drive",
    group: "Maintenance",
    label: "Code P6 drive",
    sourcePath: "scripts/params/clock_code/code_p6_drive.json",
    supports: ["C_CODE_MAINT_1", "badge:code-maint"],
    params: toParams(codeP6DriveRaw as Record<string, unknown>),
  },
  {
    id: "code_p6_clock_gated",
    group: "Maintenance",
    label: "Code P6 clock gated",
    sourcePath: "scripts/params/clock_code/code_p6_clock_gated.json",
    supports: ["C_TRAVERSAL_NEED_1", "C_TRAVERSAL_ORIENT_1", "badge:code-maint"],
    tags: ["Shows: traversal needed for recovery", "Compare: No P6"],
    params: toParams(codeP6ClockGatedRaw as Record<string, unknown>),
  },
  {
    id: "code_deadline_gated_clock",
    group: "Maintenance",
    label: "Code deadline gated clock",
    sourcePath: "scripts/params/clock_code/code_deadline_gated_clock.json",
    supports: ["C_DEADLINE_DRIFT_1", "C_DEADLINE_CLOCK_EP_1"],
    params: toParams(codeDeadlineGatedClockRaw as Record<string, unknown>),
  },
  {
    id: "opk_null_energy",
    group: "opK",
    label: "opK null energy",
    sourcePath: "scripts/params/op_coupling/opS_null_energy.json",
    supports: ["C_OPK_INV_1", "C_OPK_NULL_EP_1", "badge:opk-budget"],
    params: toParams(opNullEnergyRaw as Record<string, unknown>),
  },
  {
    id: "opk_p6_drive_only",
    group: "opK",
    label: "opK P6 drive only",
    sourcePath: "scripts/params/op_coupling/opS_p6_drive_only.json",
    supports: ["C_OPK_EFFECT_1", "badge:opk-budget"],
    params: toParams(opP6DriveRaw as Record<string, unknown>),
  },
  {
    id: "opk_deadline_best",
    group: "opK",
    label: "opK deadline best",
    sourcePath: "scripts/params/op_coupling/deadline_opk_best.json",
    supports: ["C_OPK_DILUTION_1", "badge:opk-budget"],
    params: toParams(opDeadlineBestRaw as Record<string, unknown>),
  },
];
