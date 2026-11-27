import { useAuthToken } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { lazy, Suspense, useEffect, useMemo } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api } from "../convex/_generated/api";
import { CenteredSpinner, FullScreenSpinner } from "./components/Spinner";
import { setTimeZone } from "./lib/dates";
import { memberFrom, upgradeCachedMe, type Me } from "./lib/me";
import { clearCache, readCache, writeCache } from "./lib/offlineCache";
import { OutboxProvider } from "./lib/OutboxProvider";
import { useClientList } from "./lib/useClientList";
import { useVehicleList } from "./lib/useVehicleList";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { ClientsPage } from "./pages/admin/ClientsPage";
import { DeliveriesPage } from "./pages/admin/DeliveriesPage";
import { DriversPage } from "./pages/admin/DriversPage";
import { RoutesPage } from "./pages/admin/RoutesPage";
import { CompanySettingsPage } from "./pages/admin/settings/CompanySettingsPage";
import { ReminderSettingsPage } from "./pages/admin/settings/ReminderSettingsPage";
import { SettingsLayout } from "./pages/admin/settings/SettingsLayout";
import { UsersPage } from "./pages/admin/settings/UsersPage";
import { VehiclesPage } from "./pages/admin/VehiclesPage";
import { DeliveryPage } from "./pages/DeliveryPage";
import { DriverHomePage } from "./pages/driver/DriverHomePage";
import { DriverLayout } from "./pages/driver/DriverLayout";
import { NewDeliveryWizard } from "./pages/driver/NewDeliveryWizard";
import { CreateCompanyPage } from "./pages/login/CreateCompanyPage";
import { LoginPage } from "./pages/login/LoginPage";
import { NoAccessPage } from "./pages/login/NoAccessPage";
import { UpdateAppPage } from "./pages/login/UpdateAppPage";

// Loaded on demand: it brings the map library, which drivers never need.
const RouteBuilderPage = lazy(() =>
  import("./pages/admin/RouteBuilderPage").then((m) => ({ default: m.RouteBuilderPage })),
);

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
  const cachedMe = useMemo(() => upgradeCachedMe(readCache("me")), []);
  useEffect(() => {
    if (result === undefined) return;
    const member = memberFrom(result);
    const stored = readCache<{ company?: { _id?: string } | null }>("me")?.company?._id;
    // What the phone keeps is one driver's view of one company: anything else
    // (no access any more, another role, another company) starts clean.
    if (!member?.can.includes("deliver") || (stored && stored !== member.company._id)) clearCache();
    if (member?.can.includes("deliver")) writeCache("me", result);
  }, [result]);
  useEffect(() => {
    if (!isLoading && !isAuthenticated) clearCache();
  }, [isLoading, isAuthenticated]);

  if (isLoading || (isAuthenticated && result === undefined)) {
    const offlineMe =
      token !== null && cachedMe && tokenUserId(token) === cachedMe._id ? cachedMe : null;
    if (!offlineMe) return <FullScreenSpinner />;
    setTimeZone(offlineMe.company.timeZone);
    return <DriverApp me={offlineMe} />;
  }
  if (!isAuthenticated) return <LoginPage />;

  const me = memberFrom(result);
  if (!me) {
    return result?.canCreateCompany ? (
      <CreateCompanyPage email={result.email} />
    ) : (
      <NoAccessPage email={result?.email ?? null} />
    );
  }
  // Before any screen is rendered: they all show dates in the company's time.
  setTimeZone(me.company.timeZone);

  switch (me.memberRole) {
    case "owner":
    case "admin":
    case "office":
      return <OfficeApp me={me} />;
    case "driver":
      return <DriverApp me={me} />;
    default:
      // A role added after this copy of the app was installed.
      me.memberRole satisfies never;
      return <UpdateAppPage />;
  }
}

function OfficeApp({ me }: { me: Me }) {
  const manageCompany = me.can.includes("manageCompany");
  const manageUsers = me.can.includes("manageUsers");
  const settingsHome = manageCompany ? "/configuracion/empresa" : "/configuracion/usuarios";
  return (
    // Remounted if the company's zone changes, so every date is shown again.
    <Routes key={me.company.timeZone}>
      <Route element={<AdminLayout me={me} />}>
        <Route path="entregas" element={<DeliveriesPage />} />
        <Route path="entregas/:id" element={<DeliveryPage />} />
        <Route path="rutas" element={<RoutesPage />} />
        {["rutas/nueva", "rutas/:routeId/editar"].map((path) => (
          <Route
            key={path}
            path={path}
            element={
              <Suspense fallback={<CenteredSpinner />}>
                <RouteBuilderPage />
              </Suspense>
            }
          />
        ))}
        <Route path="choferes" element={<DriversPage />} />
        <Route path="clientes" element={<ClientsPage />} />
        <Route path="vehiculos" element={<VehiclesPage />} />
        {(manageCompany || manageUsers) && (
          <Route path="configuracion" element={<SettingsLayout me={me} />}>
            {manageCompany && <Route path="empresa" element={<CompanySettingsPage />} />}
            {manageUsers && <Route path="usuarios" element={<UsersPage />} />}
            {manageCompany && <Route path="recordatorios" element={<ReminderSettingsPage />} />}
            <Route path="*" element={<Navigate to={settingsHome} replace />} />
            <Route index element={<Navigate to={settingsHome} replace />} />
          </Route>
        )}
        <Route path="*" element={<Navigate to="/entregas" replace />} />
      </Route>
    </Routes>
  );
}

function DriverApp({ me }: { me: Me }) {
  const clientList = useClientList();
  const vehicles = useVehicleList();
  return (
    <OutboxProvider me={me}>
      <Routes key={me.company.timeZone}>
        <Route path="nueva" element={<NewDeliveryWizard me={me} clients={clientList.clients} vehicles={vehicles} />} />
        <Route element={<DriverLayout me={me} />}>
          <Route index element={<DriverHomePage me={me} clientList={clientList} vehicles={vehicles} />} />
          <Route path="entregas/:id" element={<DeliveryPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </OutboxProvider>
  );
}
