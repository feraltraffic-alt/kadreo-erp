import { addDays, weekdayIndex } from "../dates";
import type { Assignment, StaffRequest, StaffRequestCell, StaffRequestStatus } from "../types";
import { DEMO_TODAY, assignments, plans } from "./generate";
import { staffRequests } from "./ops";

/**
 * Staff request progress (12.1 statuses). Accepting a request adds `headcount` places to each of
 * its shift cells; assignments made afterwards in those cells count towards the request until it
 * has `headcount` people there. «X of N» is the least staffed day. The backend implements the
 * same rules (operations module).
 */

export interface RequestCell {
  templateId: string;
  date: string;
  needed: number;
}

/** Cells of accepted requests, and the assignments counted towards each request. */
export const requestCells = new Map<string, RequestCell[]>();
export const requestAssignments = new Map<string, Set<string>>();

const isActive = (a: Assignment) => a.status === "confirmed" || a.status === "proposed";

/** Shift days of a request: every day of the period except Sunday, for each chosen shift. */
export function cellsOf(r: Pick<StaffRequest, "templateIds" | "from" | "to" | "headcount">, onlyPlanned: boolean): RequestCell[] {
  const out: RequestCell[] = [];
  for (let d = r.from; d <= r.to; d = addDays(d, 1)) {
    if (weekdayIndex(d) === 6) continue;
    for (const templateId of r.templateIds) {
      if (onlyPlanned && !plans.some((p) => p.templateId === templateId && p.date === d && p.planned > 0 && !p.cancelled)) continue;
      out.push({ templateId, date: d, needed: r.headcount });
    }
  }
  return out;
}

/** Counts a new assignment towards the earliest accepted request in its cell that still needs people. */
export function attachAssignment(a: Assignment) {
  const open = staffRequests
    .filter((r) => r.acceptedAt && !r.cancelledAt && requestCells.get(r.id)?.some((c) => c.templateId === a.templateId && c.date === a.date))
    .sort((x, y) => x.acceptedAt!.localeCompare(y.acceptedAt!));
  for (const r of open) {
    const cell = requestCells.get(r.id)!.find((c) => c.templateId === a.templateId && c.date === a.date)!;
    if (cellAssigned(r.id, cell) < cell.needed) {
      requestAssignments.get(r.id)!.add(a.id);
      return;
    }
  }
}

function cellAssigned(requestId: string, cell: RequestCell): number {
  const ids = requestAssignments.get(requestId) ?? new Set<string>();
  return assignments.filter((a) => ids.has(a.id) && isActive(a) && a.templateId === cell.templateId && a.date === cell.date).length;
}

export function progressCells(requestId: string): StaffRequestCell[] {
  return (requestCells.get(requestId) ?? []).map((c) => ({ ...c, assigned: cellAssigned(requestId, c) }));
}

/** The request as screens see it: progress and status derived from its cells. */
export function requestView(r: StaffRequest): StaffRequest {
  if (!r.acceptedAt || r.cancelledAt) return { ...r, assigned: r.cancelledAt ? r.assigned : 0 };
  const cells = progressCells(r.id);
  const assigned = cells.length ? Math.min(r.headcount, ...cells.map((c) => c.assigned)) : 0;
  let status: StaffRequestStatus = "in_progress";
  if (r.to < DEMO_TODAY) status = "done";
  else if (cells.length && assigned >= r.headcount) status = "staffed";
  return { ...r, assigned, status };
}

/* The demo's already accepted requests: their cells, and existing assignments counted to them. */
for (const r of staffRequests.filter((x) => x.acceptedAt)) {
  const cells = cellsOf(r, true);
  requestCells.set(r.id, cells);
  const ids = new Set<string>();
  for (const c of cells) {
    assignments
      .filter((a) => a.templateId === c.templateId && a.date === c.date && isActive(a))
      .sort((x, y) => x.id.localeCompare(y.id, "en", { numeric: true }))
      .slice(0, r.assigned)
      .forEach((a) => ids.add(a.id));
  }
  requestAssignments.set(r.id, ids);
}
