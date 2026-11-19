import { Outlet } from "react-router-dom";
import { AppHeader } from "../../components/AppHeader";
import type { Me } from "../../lib/me";

const TABS = [
  { to: "/entregas", label: "Entregas" },
  { to: "/rutas", label: "Rutas" },
  { to: "/choferes", label: "Choferes" },
  { to: "/clientes", label: "Clientes" },
  { to: "/vehiculos", label: "Vehículos" },
];

export function AdminLayout({ me }: { me: Me }) {
  return (
    <>
      <AppHeader me={me} tabs={TABS} />
      <main>
        <Outlet />
      </main>
    </>
  );
}
