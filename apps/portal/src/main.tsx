import { Skeleton, ToastProvider, TooltipProvider } from "@kadreo/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, Navigate, RouterProvider } from "react-router";
import { SessionProvider } from "./app/session";
import { NewRequestPage } from "./features/NewRequestPage";
import { OverviewPage } from "./features/OverviewPage";
import { RequestPage, RequestsPage } from "./features/RequestsPage";
import { TimesheetPage } from "./features/TimesheetPage";
import { TimesheetsPage } from "./features/TimesheetsPage";
import "./index.css";
import { Placeholder, PortalLayout } from "./shell/PortalLayout";

// Statuses change on the contractor's side (request accepted, dispute answered): every screen
// refetches when opened; dictionaries and the profile keep their own longer lifetime.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 0 } } });

// Hash routing keeps deep links working on any static host and in preview pages.
const router = createHashRouter([
  {
    element: <PortalLayout />,
    children: [
      { index: true, element: <Navigate to="/overview" replace /> },
      { path: "overview", element: <OverviewPage /> },
      { path: "requests", element: <RequestsPage /> },
      { path: "requests/new", element: <NewRequestPage /> },
      { path: "requests/:id", element: <RequestPage /> },
      { path: "requests/:id/edit", element: <NewRequestPage /> },
      { path: "timesheets", element: <TimesheetsPage /> },
      { path: "timesheets/:id", element: <TimesheetPage /> },
      { path: "reports", element: <Placeholder titleKey="nav.reports" /> },
      { path: "documents", element: <Placeholder titleKey="nav.documents" /> },
      { path: "messages", element: <Placeholder titleKey="nav.messages" /> },
      { path: "*", element: <Navigate to="/overview" replace /> },
    ],
  },
]);

function Boot() {
  return (
    <div className="min-h-screen bg-bg">
      <div className="h-16 border-b border-border bg-surface" />
      <div className="mx-auto max-w-[1280px] p-8">
        <Skeleton className="mb-6 h-10 w-72" />
        <Skeleton className="h-64 rounded-card" />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ToastProvider>
          <SessionProvider fallback={<Boot />}>
            <RouterProvider router={router} />
          </SessionProvider>
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
