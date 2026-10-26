import { ToastProvider, TooltipProvider } from "@kadreo/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, Navigate, RouterProvider } from "react-router";
import { SessionProvider } from "./app/session";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { ProjectsPage } from "./features/schedule/ProjectsPage";
import { SchedulePage } from "./features/schedule/SchedulePage";
import { RequestPage } from "./features/requests/RequestPage";
import { RequestsPage } from "./features/requests/RequestsPage";
import { DisputesPage } from "./features/timesheet/DisputesPage";
import { TimesheetListPage } from "./features/timesheet/TimesheetListPage";
import { TimesheetPage } from "./features/timesheet/TimesheetPage";
import "./index.css";
import { alertsItem, navItems, settingsItem } from "./shell/nav";
import { Layout, PlaceholderPage, RequirePermission } from "./shell/Layout";
import { Skeleton } from "@kadreo/ui";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 } },
});

const built = new Set(["dashboard", "schedule", "timesheets", "requests"]);
const placeholders = [...navItems.filter((n) => !built.has(n.key)), settingsItem, alertsItem];

// Hash routing keeps deep links working on any static host and in preview pages.
const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: "dashboard", element: <RequirePermission anyOf={["dashboard.read"]}><DashboardPage /></RequirePermission> },
      { path: "workforce/projects", element: <RequirePermission anyOf={["shift.schedule.read"]}><ProjectsPage /></RequirePermission> },
      { path: "workforce/projects/:projectId/schedule", element: <RequirePermission anyOf={["shift.schedule.read"]}><SchedulePage /></RequirePermission> },
      { path: "timesheets", element: <RequirePermission anyOf={["timesheet.read"]}><TimesheetListPage /></RequirePermission> },
      { path: "timesheets/disputes", element: <RequirePermission anyOf={["timesheet.read"]}><DisputesPage /></RequirePermission> },
      { path: "requests", element: <RequirePermission anyOf={["staffrequest.read"]}><RequestsPage /></RequirePermission> },
      { path: "requests/:id", element: <RequirePermission anyOf={["staffrequest.read"]}><RequestPage /></RequirePermission> },
      { path: "timesheets/projects/:projectId", element: <RequirePermission anyOf={["timesheet.read"]}><TimesheetPage /></RequirePermission> },
      ...placeholders.map((n) => ({
        path: `${n.to.slice(1)}/*`,
        element: (
          <RequirePermission anyOf={n.anyOf}>
            <PlaceholderPage titleKey={`nav.${n.key}`} specRef={n.specRef} />
          </RequirePermission>
        ),
      })),
      { path: "sites/:id", element: <PlaceholderPage titleKey="nav.sites" specRef="10.2" /> },
      { path: "workers/:id", element: <PlaceholderPage titleKey="nav.workers" specRef="15.8" /> },
      { path: "clients/:id", element: <PlaceholderPage titleKey="nav.sites" noSpec /> },
      { path: "contracts/:id", element: <PlaceholderPage titleKey="nav.contracts" specRef="10.3" /> },
      { path: "*", element: <Navigate to="/dashboard" replace /> },
    ],
  },
]);

function BootSkeleton() {
  return (
    <div className="flex min-h-screen">
      <div className="w-[232px] bg-sidebar" />
      <div className="flex-1 p-8">
        <Skeleton className="mb-6 h-10 w-80" />
        <div className="grid grid-cols-5 gap-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-40 rounded-card" />
          ))}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider fallback={<BootSkeleton />}>
        <TooltipProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </TooltipProvider>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
