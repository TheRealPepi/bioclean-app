import { useAuthActions } from "@convex-dev/auth/react";
import { NavLink } from "react-router-dom";
import type { Me } from "../lib/me";
import styles from "./AppHeader.module.css";

type Tab = { to: string; label: string; end?: boolean };

export function AppHeader({ me, tabs }: { me: Me; tabs?: Tab[] }) {
  const { signOut } = useAuthActions();
  const roleLabel = me.role === "admin" ? "Administrador" : "Chofer";

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <div>
            <div className={styles.brand}>Bioclean Green Cozumel</div>
            <div className={styles.user}>
              {me.name.split(" ")[0]} · {roleLabel}
            </div>
          </div>
          <button type="button" className={styles.signOut} onClick={() => void signOut()}>
            Salir
          </button>
        </div>
        {tabs && (
          <nav className={styles.tabs}>
            {tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) => `${styles.tab} ${isActive ? styles.active : ""}`}
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
