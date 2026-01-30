import type { SimParams } from "./workerMessages";

import baseNullBalancedRaw from "../../../scripts/params/base_null_balanced.json";
import baseP6DriveRaw from "../../../scripts/params/base_p6_drive.json";
import baseP3PumpRaw from "../../../scripts/params/base_p3_pump_minimal.json";
import baseP3P6ComboRaw from "../../../scripts/params/base_p3p6_combo_minimal.json";
import metaNullDecoupledRaw from "../../../scripts/params/meta/meta2_null_decoupled.json";
import metaNullCoupledRaw from "../../../scripts/params/meta/meta2_null_coupled.json";
import metaP6DriveRaw from "../../../scripts/params/meta/meta2_p6_drive_coupled.json";
import clockNullRaw from "../../../scripts/params/clock_code/clock_null.json";
import clockP6Raw from "../../../scripts/params/clock_code/clock_p6.json";
import clockTurRaw from "../../../scripts/params/clock_code/clock_tur_sweep_base.json";
import codeNullRaw from "../../../scripts/params/clock_code/code_null.json";
import codeP6DriveRaw from "../../../scripts/params/clock_code/code_p6_drive.json";
import codeP6ClockGatedRaw from "../../../scripts/params/clock_code/code_p6_clock_gated.json";
import codeDeadlineGatedClockRaw from "../../../scripts/params/clock_code/code_deadline_gated_clock.json";
import opNullEnergyRaw from "../../../scripts/params/op_coupling/opS_null_energy.json";
import opP6DriveRaw from "../../../scripts/params/op_coupling/opS_p6_drive_only.json";
import opDeadlineBestRaw from "../../../scripts/params/op_coupling/deadline_opk_best.json";

export type PresetEntry = {
  id: string;
  group: string;
  label: string;
  sourcePath: string;
  supports?: string[];
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
    id: "base_null_balanced",
    group: "Base",
    label: "Base null balanced",
    sourcePath: "scripts/params/base_null_balanced.json",
    supports: ["C_BASE_NULL_1", "C_EP_EXACT_NULL_1"],
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
    supports: ["C_CLOCK_DRIFT_1"],
    params: toParams(clockNullRaw as Record<string, unknown>),
  },
  {
    id: "clock_p6",
    group: "Clock/TUR",
    label: "Clock P6 drive",
    sourcePath: "scripts/params/clock_code/clock_p6.json",
    supports: ["C_CLOCK_DRIFT_1"],
    params: toParams(clockP6Raw as Record<string, unknown>),
  },
  {
    id: "clock_tur_sweep_base",
    group: "Clock/TUR",
    label: "Clock TUR sweep base",
    sourcePath: "scripts/params/clock_code/clock_tur_sweep_base.json",
    supports: ["C_TUR_1"],
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
    supports: ["C_CODE_MAINT_1"],
    params: toParams(codeP6DriveRaw as Record<string, unknown>),
  },
  {
    id: "code_p6_clock_gated",
    group: "Maintenance",
    label: "Code P6 clock gated",
    sourcePath: "scripts/params/clock_code/code_p6_clock_gated.json",
    supports: ["C_TRAVERSAL_NEED_1", "C_TRAVERSAL_ORIENT_1"],
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
    supports: ["C_OPK_INV_1", "C_OPK_NULL_EP_1"],
    params: toParams(opNullEnergyRaw as Record<string, unknown>),
  },
  {
    id: "opk_p6_drive_only",
    group: "opK",
    label: "opK P6 drive only",
    sourcePath: "scripts/params/op_coupling/opS_p6_drive_only.json",
    supports: ["C_OPK_EFFECT_1"],
    params: toParams(opP6DriveRaw as Record<string, unknown>),
  },
  {
    id: "opk_deadline_best",
    group: "opK",
    label: "opK deadline best",
    sourcePath: "scripts/params/op_coupling/deadline_opk_best.json",
    supports: ["C_OPK_DILUTION_1"],
    params: toParams(opDeadlineBestRaw as Record<string, unknown>),
  },
];
