import { Outlet } from "react-router-dom";
import { AppHeader } from "../../components/AppHeader";
import { CloudOffIcon } from "../../components/Icons";
import type { Me } from "../../lib/me";
import { useOnline } from "../../lib/useOnline";
import styles from "./DriverLayout.module.css";

export function DriverLayout({ me }: { me: Me }) {
  const online = useOnline();
  return (
    <>
      <AppHeader me={me} />
      {!online && (
        <div className={styles.offline} role="status">
          <CloudOffIcon size={18} />
          Sin señal · tus entregas se guardan en el teléfono
        </div>
      )}
      <main>
        <Outlet />
      </main>
    </>
  );
}
