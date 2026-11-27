import { NavLink, Outlet } from "react-router-dom";
import type { Me } from "../../../lib/me";
import list from "../ListPage.module.css";
import styles from "./Settings.module.css";

/** The company's settings, for its owner and admins. */
export function SettingsLayout({ me }: { me: Me }) {
  const manageCompany = me.can.includes("manageCompany");
  const sections = [
    ...(manageCompany ? [{ to: "empresa", label: "Empresa" }] : []),
    ...(me.can.includes("manageUsers") ? [{ to: "usuarios", label: "Usuarios" }] : []),
    ...(manageCompany ? [{ to: "recordatorios", label: "Recordatorios" }] : []),
  ];
  return (
    <div className={list.page}>
      <div className={list.heading}>
        <div>
          <h1>Configuración</h1>
          <p>{me.company.name}</p>
        </div>
      </div>
      <nav className={styles.sections} aria-label="Secciones de configuración">
        {sections.map((section) => (
          <NavLink
            key={section.to}
            to={section.to}
            className={({ isActive }) => `${styles.section} ${isActive ? styles.current : ""}`}
          >
            {section.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
