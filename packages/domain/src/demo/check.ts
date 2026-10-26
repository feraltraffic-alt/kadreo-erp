// Sanity check of the generated demo data: run with `npx tsx src/demo/check.ts`.
import { createMockApi } from "./mockApi";
import { workers, assignments } from "./generate";
const api = createMockApi();
const s = await api.dashboardSummary({});
console.log("workers", workers.length, "assignments", assignments.length);
console.log("summary", s);
const sites = await api.dashboardSites({});
console.log(sites.map((x) => `${x.siteName} ${x.actual}/${x.planned} late ${x.late} ns ${x.noShows} ${x.status}`).join("\n"));
const sch = await api.schedule("pr-strykow", "2026-10-26", "2026-11-01");
console.log(sch.publishState, sch.filled, sch.total);
console.log(sch.rows.map((r) => r.cells.map((c) => (c.planned === null ? "—" : `${c.assigned}/${c.planned}`)).join(" ")).join("\n"));
const c = await api.candidates("tpl-strykow-1", "2026-10-28");
console.log(c.slice(0, 6).map((x) => `${x.firstName} ${x.lastName} ${x.score} ${JSON.stringify(x.tags)} ${JSON.stringify(x.warnings)}`).join("\n"));
const ts = await api.timesheet("pr-strykow", "2026-10-19", "2026-10-25");
console.log("rows", ts.timesheet.rows.length);
for (const r of ts.timesheet.rows.slice(0, 6)) console.log(ts.workers[r.workerId]!.lastName, r.days.map((d) => (d.hasShift ? d.payableHours + (d.issue ? "!" : "") + (d.corrections.length ? "✎" : "") : "—")).join(" "));
const list = await api.timesheets();
console.log(list.slice(0, 5));
