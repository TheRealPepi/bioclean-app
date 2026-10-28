import { useConvexAuth, useQuery } from "convex/react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api } from "../convex/_generated/api";
import { FullScreenSpinner } from "./components/Spinner";
import type { Me } from "./lib/me";
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

export default function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const result = useQuery(api.users.me, isAuthenticated ? {} : "skip");

  if (isLoading) return <FullScreenSpinner />;
  if (!isAuthenticated) return <LoginPage />;
  if (result === undefined) return <FullScreenSpinner />;
  if (result === null || result.role === null) {
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

  return (
    <Routes>
      <Route path="nueva" element={<NewDeliveryWizard me={me} />} />
      <Route element={<DriverLayout me={me} />}>
        <Route index element={<DriverHomePage me={me} />} />
        <Route path="entregas/:id" element={<DeliveryPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
