import {
  BarChart3,
  Banknote,
  Building2,
  CalendarDays,
  ClipboardCheck,
  Clock3,
  FileText,
  Gift,
  LayoutGrid,
  MessageSquareText,
  Receipt,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

/** Back-office menu (spec 8.4, plus «Мотивация» from 15.2). An item hides without its read permission. */
export interface NavItem {
  key: string;
  to: string;
  icon: LucideIcon;
  /** Any of these permissions shows the item. */
  anyOf: string[];
  counter?: "requests" | "docs";
  /** Spec section for screens not built yet. */
  specRef: string;
}

export const navItems: NavItem[] = [
  { key: "dashboard", to: "/dashboard", icon: LayoutGrid, anyOf: ["dashboard.read"], specRef: "11.1" },
  { key: "schedule", to: "/workforce/projects", icon: CalendarDays, anyOf: ["shift.schedule.read"], specRef: "9.1" },
  { key: "timesheets", to: "/timesheets", icon: Clock3, anyOf: ["timesheet.read"], specRef: "9.2" },
  { key: "workers", to: "/workers", icon: Users, anyOf: ["worker.read"], specRef: "15.7" },
  { key: "sites", to: "/sites", icon: Building2, anyOf: ["site.read"], specRef: "10.1" },
  { key: "contracts", to: "/contracts", icon: FileText, anyOf: ["contract.read"], specRef: "10.3" },
  { key: "requests", to: "/requests", icon: MessageSquareText, anyOf: ["staffrequest.read"], counter: "requests", specRef: "12.1" },
  { key: "billing", to: "/billing/invoices", icon: Receipt, anyOf: ["invoice.read"], specRef: "13.1" },
  { key: "payroll", to: "/payroll/runs", icon: Banknote, anyOf: ["payroll.run.read"], specRef: "13.4" },
  { key: "hr", to: "/hr/documents", icon: ShieldCheck, anyOf: ["worker.document.manage", "worker.document.read", "report.compliance"], counter: "docs", specRef: "15.9" },
  { key: "motivation", to: "/motivation/campaigns", icon: Gift, anyOf: ["motivation.read"], specRef: "15.2" },
  { key: "analytics", to: "/analytics/efficiency", icon: BarChart3, anyOf: ["analytics.read"], specRef: "16.1" },
];

export const settingsItem: NavItem = { key: "settings", to: "/settings", icon: Settings, anyOf: ["settings.manage"], specRef: "13.7" };
export const alertsItem: NavItem = { key: "alerts", to: "/alerts", icon: ClipboardCheck, anyOf: ["alert.read"], specRef: "10.4" };
