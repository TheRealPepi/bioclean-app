import { useAuthToken } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useMemo } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api } from "../convex/_generated/api";
import { FullScreenSpinner } from "./components/Spinner";
import type { Me } from "./lib/me";
import { clearCache, readCache, writeCache } from "./lib/offlineCache";
import { OutboxProvider } from "./lib/OutboxProvider";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { ClientsPage } from "./pages/admin/ClientsPage";
import { DeliveriesPage } from "./pages/admin/DeliveriesPage";
import { DriversPage } from "./pages/admin/DriversPage";
import { DeliveryPage } from "./pages/DeliveryPage";
import { DriverHomePage } from "./pages/driver/DriverHomePage";
import { DriverLayout } from "./pages/driver/DriverLayout";
import { NewDeliveryWizard } from "./pages/driver/NewDeliveryWizard";
import { LoginPage } from "./pages/login/LoginPage";
import { NoAccessPage } from "./pages/login/NoAccessPage";

/** The user id inside a Convex Auth JWT (`sub` is "userId|sessionId"). */
function tokenUserId(token: string): string | null {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { sub } = JSON.parse(atob(payload)) as { sub?: string };
    return sub?.split("|")[0] ?? null;
  } catch {
    return null;
  }
}

export default function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const token = useAuthToken();
  const result = useQuery(api.users.me, isAuthenticated ? {} : "skip");

  // Without signal the server can't confirm the session, so `isLoading` never
  // ends. A driver who was signed in on this phone then gets the app with the
  // last known profile (the session itself stays stored; see Convex Auth).
  const cachedMe = useMemo(() => readCache<Me>("me"), []);
  useEffect(() => {
    if (result?.role === "driver") writeCache("me", result);
    else if (result === null || result?.role === null) clearCache();
  }, [result]);
  useEffect(() => {
    if (!isLoading && !isAuthenticated) clearCache();
  }, [isLoading, isAuthenticated]);

  if (isLoading || (isAuthenticated && result === undefined)) {
    const offlineMe =
      token !== null && cachedMe && tokenUserId(token) === cachedMe._id ? cachedMe : null;
    if (!offlineMe) return <FullScreenSpinner />;
    return <DriverApp me={offlineMe} />;
  }
  if (!isAuthenticated) return <LoginPage />;
  if (result === null || result === undefined || result.role === null) {
    return <NoAccessPage email={result?.email ?? null} />;
  }
  const me: Me = { ...result, role: result.role };

  if (me.role === "admin") {
    return (
      <Routes>
        <Route element={<AdminLayout me={me} />}>
          <Route path="entregas" element={<DeliveriesPage />} />
          <Route path="entregas/:id" element={<DeliveryPage />} />
          <Route path="choferes" element={<DriversPage />} />
          <Route path="clientes" element={<ClientsPage />} />
          <Route path="*" element={<Navigate to="/entregas" replace />} />
        </Route>
      </Routes>
    );
  }

  return <DriverApp me={me} />;
}

function DriverApp({ me }: { me: Me }) {
  return (
    <OutboxProvider me={me}>
      <Routes>
        <Route path="nueva" element={<NewDeliveryWizard me={me} />} />
        <Route element={<DriverLayout me={me} />}>
          <Route index element={<DriverHomePage me={me} />} />
          <Route path="entregas/:id" element={<DeliveryPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </OutboxProvider>
  );
}
