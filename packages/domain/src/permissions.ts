import type { Permission, RoleCode } from "./types";

/**
 * System role templates (3.1) expressed as granular permissions (3.3). Tenant admins can build
 * their own roles from the same list. The server is the source of truth; the client only uses
 * these to hide what a role cannot do.
 */
const ops: Permission[] = [
  "dashboard.read",
  "alert.read",
  "alert.take",
  "alert.rule.manage",
  "shift.schedule.read",
  "shift.schedule.edit",
  "shift.schedule.publish",
  "shift.autoassign.run",
  "shift.urgent.create",
  "timesheet.read",
  "timesheet.entry.correct",
  "timesheet.send_to_client",
  "clockevent.read",
  "clockevent.evidence.read",
  "staffrequest.read",
  "staffrequest.manage",
  "timesheet.dispute.resolve",
  "site.read",
  "site.manage",
  "client.manage",
  "contract.read",
  "contract.rates.read",
  "worker.read",
  "worker.document.read",
  "invoice.read",
  "analytics.read",
  "motivation.read",
];

export const rolePermissions: Record<RoleCode, Permission[]> = {
  TENANT_ADMIN: ["*"],
  EXECUTIVE: ["dashboard.read", "alert.read", "shift.schedule.read", "timesheet.read", "staffrequest.read", "site.read", "contract.read", "worker.read", "invoice.read", "payroll.run.read", "analytics.read", "motivation.read", "audit.read"],
  OPS_MANAGER: ops,
  SITE_MANAGER: ops.filter((p) => !["client.manage", "site.manage", "contract.rates.read", "alert.rule.manage"].includes(p)),
  TEAM_LEADER: ["shift.schedule.read", "timesheet.read", "clockevent.read"],
  WORKER: [],
  HR: ["worker.read", "worker.create", "worker.update", "worker.document.manage", "report.compliance", "motivation.read", "motivation.campaign.manage", "shift.schedule.read", "timesheet.read"],
  PAYROLL: ["payroll.run.read", "payroll.run.execute", "payroll.payslip.read", "payment.batch.prepare", "worker.read", "timesheet.read", "report.compliance"],
  FINANCE: ["invoice.read", "invoice.generate", "invoice.issue", "bank.statement.import", "bank.connection.manage", "payment.batch.prepare", "contract.read", "contract.rates.read", "contract.manage", "timesheet.read", "analytics.read"],
  ANALYST: ["analytics.read"],
  AUDITOR: ["audit.read", "report.compliance"],
  // Client portal roles (12): their data is limited to their own client by the server.
  CLIENT_ADMIN: ["portal.read", "staffrequest.create", "timesheet.client.confirm", "client.users.manage"],
  CLIENT_MANAGER: ["portal.read", "staffrequest.create", "timesheet.client.confirm"],
  CLIENT_VIEWER: ["portal.read"],
  KIOSK: [],
};

export function permissionsFor(role: RoleCode): Permission[] {
  return rolePermissions[role];
}

export function can(perms: Permission[], p: Permission): boolean {
  return perms.includes("*") || perms.includes(p);
}
