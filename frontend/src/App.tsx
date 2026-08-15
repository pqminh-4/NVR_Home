import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { auth, api } from "./lib/api";
import { ToastProvider } from "./components/ui/toast";
import { Spinner } from "./components/ui/misc";
import AppShell from "./components/layout/AppShell";
import LoginPage from "./features/auth/LoginPage";

const DashboardPage = lazy(() => import("./features/dashboard/DashboardPage"));
const LivePage = lazy(() => import("./features/live/LivePage"));
const TimelinePage = lazy(() => import("./features/timeline/TimelinePage"));
const EventsPage = lazy(() => import("./features/events/EventsPage"));
const FacesPage = lazy(() => import("./features/faces/FacesPage"));
const SettingsPage = lazy(() => import("./features/settings/SettingsPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: false },
  },
});

function Gate({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);

  useEffect(() => {
    const token = auth.getToken();
    if (!token) {
      setChecking(false);
      return;
    }
    api
      .get("/auth/me")
      .then(() => setValid(true))
      .catch(() => auth.clear())
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }
  if (!valid) return <LoginPage />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <Gate>
                  <AppShell />
                </Gate>
              }
            >
              <Route index element={<Navigate to="/live" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="live" element={<LivePage />} />
              <Route path="timeline" element={<TimelinePage />} />
              <Route path="events" element={<EventsPage />} />
              <Route path="faces" element={<FacesPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
