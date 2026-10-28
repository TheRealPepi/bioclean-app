import { Outlet } from "react-router-dom";
import { AppHeader } from "../../components/AppHeader";
import type { Me } from "../../lib/me";

export function DriverLayout({ me }: { me: Me }) {
  return (
    <>
      <AppHeader me={me} />
      <main>
        <Outlet />
      </main>
    </>
  );
}
