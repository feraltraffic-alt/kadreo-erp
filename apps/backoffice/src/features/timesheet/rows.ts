import type { Timesheet, TimesheetRow, TimesheetRowStatus } from "@kadreo/domain";

export function rowStatus(row: TimesheetRow, ts: Timesheet): TimesheetRowStatus {
  if (row.days.some((d) => d.disputed)) return "disputed";
  if (row.days.some((d) => d.issue)) return "issues";
  if (ts.clientStage.kind === "confirmed" || ts.clientStage.kind === "auto_accepted") return "confirmed";
  return "ready";
}

export const rowTotal = (row: TimesheetRow) => row.days.reduce((s, d) => s + d.payableHours, 0);
export const rowPlanned = (row: TimesheetRow) => row.days.reduce((s, d) => s + d.plannedHours, 0);
export const rowOvertime = (row: TimesheetRow) => row.days.reduce((s, d) => s + Math.max(0, d.payableHours - d.plannedHours), 0);
