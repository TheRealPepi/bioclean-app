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
  // Users and settings are only for whoever manages the company.
  const manages = me.can.includes("manageUsers") || me.can.includes("manageCompany");
  const tabs = manages ? [...TABS, { to: "/configuracion", label: "Configuración" }] : TABS;
  return (
    <>
      <AppHeader me={me} tabs={tabs} />
      <main>
        <Outlet />
      </main>
    </>
  );
}
