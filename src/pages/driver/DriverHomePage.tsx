import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { CheckIcon, PlusIcon } from "../../components/Icons";
import { CenteredSpinner } from "../../components/Spinner";
import { StatusBadge } from "../../components/StatusBadge";
import { formatLongDate, formatTime, isoDate, startOfDay } from "../../lib/dates";
import { clearDraft, draftHasContent, loadDraft, type Draft } from "../../lib/draft";
import type { Me } from "../../lib/me";
import styles from "./DriverHomePage.module.css";

export function DriverHomePage({ me }: { me: Me }) {
  const navigate = useNavigate();
  const location = useLocation();
  const today = isoDate();
  const deliveries = useQuery(api.deliveries.listMine, { since: startOfDay(today) });

  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    void loadDraft(me._id).then((d) => setDraft(d && draftHasContent(d) ? d : null));
  }, [me._id]);

  // Confirmation toast after saving a delivery.
  const [saved, setSaved] = useState<string | null>(
    (location.state as { saved?: string } | null)?.saved ?? null,
  );
  useEffect(() => {
    if (!saved) return;
    navigate(".", { replace: true, state: null });
    const timer = setTimeout(() => setSaved(null), 4000);
    return () => clearTimeout(timer);
  }, [saved, navigate]);

  return (
    <div className={styles.page}>
      <div className={styles.greeting}>
        <h1>Hola, {me.name.split(" ")[0]}</h1>
        <p>{formatLongDate(Date.now())}</p>
      </div>

      {draft && (
        <div className={styles.draft}>
          <div>
            <strong>Tienes una entrega sin terminar</strong>
            <span>{draft.clientName || "Sin cliente todavía"}</span>
          </div>
          <div className={styles.draftActions}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void clearDraft(me._id).then(() => setDraft(null))}
            >
              Descartar
            </button>
            <Link to="/nueva" className="btn btn-primary">
              Continuar
            </Link>
          </div>
        </div>
      )}

      <h2 className={styles.sectionTitle}>
        Entregas de hoy{deliveries ? ` · ${deliveries.length}` : ""}
      </h2>

      {deliveries === undefined ? (
        <CenteredSpinner />
      ) : deliveries.length === 0 ? (
        <div className={`card ${styles.empty}`}>
          <p>Aún no registras entregas hoy.</p>
          <p>
            Toca <strong>Nueva entrega</strong> para empezar.
          </p>
        </div>
      ) : (
        <ul className={styles.list}>
          {deliveries.map((d) => (
            <li key={d._id}>
              <Link to={`/entregas/${d._id}`} className={`card ${styles.item}`}>
                <strong>{d.clientName}</strong>
                <div className={styles.itemMeta}>
                  <span>
                    {d.invoiceNumber} · {formatTime(d._creationTime)}
                  </span>
                  <StatusBadge status={d.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link to="/nueva" className={styles.fab}>
        <PlusIcon size={24} strokeWidth={2.5} />
        Nueva entrega
      </Link>

      {saved && (
        <div className={styles.toast} role="status">
          <CheckIcon size={20} />
          Entrega guardada · {saved}
        </div>
      )}
    </div>
  );
}
