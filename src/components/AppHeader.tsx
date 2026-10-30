import { useAuthActions } from "@convex-dev/auth/react";
import { NavLink } from "react-router-dom";
import type { Me } from "../lib/me";
import { useOutbox } from "../lib/OutboxProvider";
import { useOnline } from "../lib/useOnline";
import styles from "./AppHeader.module.css";

type Tab = { to: string; label: string; end?: boolean };

export function AppHeader({ me, tabs }: { me: Me; tabs?: Tab[] }) {
  const { signOut } = useAuthActions();
  const online = useOnline();
  const waiting = useOutbox()?.items.length ?? 0;
  const roleLabel = me.role === "admin" ? "Administrador" : "Chofer";

  function handleSignOut() {
    // Signing out needs the server, and deliveries waiting on the phone only
    // upload once this same driver signs in again.
    if (!online) {
      alert("Necesitas señal para salir de la cuenta.");
      return;
    }
    if (
      waiting > 0 &&
      !confirm(
        `Tienes ${waiting} ${waiting === 1 ? "entrega" : "entregas"} sin subir. Se quedarán en este teléfono y se subirán cuando vuelvas a entrar con tu cuenta. ¿Salir de todos modos?`,
      )
    ) {
      return;
    }
    void signOut();
  }

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
          <button type="button" className={styles.signOut} onClick={handleSignOut}>
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
