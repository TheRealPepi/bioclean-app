import { useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { CenteredSpinner } from "../../components/Spinner";
import { formatShort, isoDate, shiftDays } from "../../lib/dates";
import styles from "./ListPage.module.css";

export function DriversPage() {
  const navigate = useNavigate();
  const data = useQuery(api.users.listDrivers);

  if (data === undefined) return <CenteredSpinner />;

  const openDriver = (id: string) => {
    const today = isoDate();
    navigate(`/entregas?chofer=${id}&desde=${shiftDays(today, -30)}&hasta=${today}`);
  };

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <h1>Choferes</h1>
        <p>
          Para dar acceso a un chofer, agrega su correo de Google a <code>ALLOWED_EMAILS</code> en
          Convex.
        </p>
      </div>

      <section className={`card ${styles.tableCard}`}>
        {data.drivers.length === 0 ? (
          <div className={styles.empty}>Ningún chofer ha entrado todavía.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Chofer</th>
                <th className={styles.hideMobile}>Correo</th>
                <th className={styles.num}>Entregas</th>
                <th>Última entrega</th>
              </tr>
            </thead>
            <tbody>
              {data.drivers.map((d) => (
                <tr
                  key={d._id}
                  className={styles.clickable}
                  tabIndex={0}
                  onClick={() => openDriver(d._id)}
                  onKeyDown={(e) => e.key === "Enter" && openDriver(d._id)}
                >
                  <td>
                    <div className={styles.person}>
                      {d.image ? (
                        <img src={d.image} alt="" referrerPolicy="no-referrer" />
                      ) : (
                        <span className={styles.avatar}>{d.name.charAt(0).toUpperCase()}</span>
                      )}
                      <strong>{d.name}</strong>
                    </div>
                  </td>
                  <td className={`${styles.muted} ${styles.hideMobile}`}>{d.email}</td>
                  <td className={styles.num}>{d.deliveryCount}</td>
                  <td className={styles.muted}>
                    {d.lastDeliveryAt ? formatShort(d.lastDeliveryAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {data.pendingEmails.length > 0 && (
        <section className={styles.pending}>
          <h2>Autorizados que aún no han entrado</h2>
          <ul>
            {data.pendingEmails.map((email) => (
              <li key={email}>{email}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
