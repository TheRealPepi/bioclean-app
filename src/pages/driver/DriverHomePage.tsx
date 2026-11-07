import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { cleanInvoice } from "../../../convex/lib/text";
import { InstallBanner } from "../../components/InstallBanner";
import { CheckIcon, PlusIcon, UploadIcon } from "../../components/Icons";
import { CenteredSpinner, Spinner } from "../../components/Spinner";
import { StatusBadge } from "../../components/StatusBadge";
import { formatLongDate, formatShort, formatTime, isoDate, startOfDay } from "../../lib/dates";
import { clearDraft, draftHasContent, loadDraft, type Draft } from "../../lib/draft";
import type { Me } from "../../lib/me";
import type { OutboxItem } from "../../lib/outbox";
import { useOutbox } from "../../lib/OutboxProvider";
import { useCachedQuery } from "../../lib/useCachedQuery";
import type { ClientListState } from "../../lib/useClientList";
import { useOnline } from "../../lib/useOnline";
import styles from "./DriverHomePage.module.css";

type SavedToast = { saved: string; queued?: boolean };

export function DriverHomePage({ me, clientList }: { me: Me; clientList: ClientListState }) {
  const navigate = useNavigate();
  const location = useLocation();
  const online = useOnline();
  const outbox = useOutbox()!;
  const today = isoDate();
  const deliveries = useCachedQuery(
    api.deliveries.listMine,
    { since: startOfDay(today) },
    `listMine:${me._id}:${today}`,
  );

  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    void loadDraft(me._id).then((d) => setDraft(d && draftHasContent(d) ? d : null));
  }, [me._id]);

  // Confirmation toast after saving a delivery.
  const [saved, setSaved] = useState<SavedToast | null>(
    (location.state as SavedToast | null)?.saved ? (location.state as SavedToast) : null,
  );
  useEffect(() => {
    if (!saved) return;
    navigate(".", { replace: true, state: null });
    const timer = setTimeout(() => setSaved(null), saved.queued ? 6000 : 4000);
    return () => clearTimeout(timer);
  }, [saved, navigate]);

  const waiting = outbox.items;
  const hasFailed = waiting.some((i) => i.error);

  return (
    <div className={styles.page}>
      <div className={styles.greeting}>
        <h1>Hola, {me.name.split(" ")[0]}</h1>
        <p>{formatLongDate(Date.now())}</p>
        <ClientListInfo {...clientList} online={online} today={today} />
      </div>

      <InstallBanner />

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

      {waiting.length > 0 && (
        <>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Por subir · {waiting.length}</h2>
            {online && (hasFailed || !outbox.uploadingId) && (
              <button type="button" className="btn btn-ghost" onClick={outbox.syncNow}>
                <UploadIcon size={18} /> {hasFailed ? "Reintentar" : "Subir ahora"}
              </button>
            )}
          </div>
          <p className={styles.waitingHint}>
            {online
              ? "Guardadas en el teléfono. Se están subiendo; deja la app abierta."
              : "Guardadas en el teléfono. Se subirán solas cuando haya señal y abras la app."}
          </p>
          <ul className={styles.list}>
            {waiting.map((item) => (
              <WaitingItem
                key={item.id}
                item={item}
                uploading={outbox.uploadingId === item.id}
                today={today}
              />
            ))}
          </ul>
        </>
      )}

      <h2 className={styles.sectionTitle}>
        Entregas de hoy{deliveries ? ` · ${deliveries.length}` : ""}
      </h2>

      {deliveries === undefined ? (
        online ? (
          <CenteredSpinner />
        ) : (
          <div className={`card ${styles.empty}`}>
            <p>Sin señal. La lista aparecerá cuando vuelva la conexión.</p>
          </div>
        )
      ) : deliveries.length === 0 ? (
        <div className={`card ${styles.empty}`}>
          {waiting.length > 0 ? (
            <p>Aún no se sube ninguna entrega de hoy.</p>
          ) : (
            <>
              <p>Aún no registras entregas hoy.</p>
              <p>
                Toca <strong>Nueva entrega</strong> para empezar.
              </p>
            </>
          )}
        </div>
      ) : (
        <ul className={styles.list}>
          {deliveries.map((d) => (
            <li key={d._id}>
              <Link to={`/entregas/${d._id}`} className={`card ${styles.item}`}>
                <strong>{d.clientName}</strong>
                <div className={styles.itemMeta}>
                  <span>
                    {d.invoiceNumber} · {formatTime(d.deliveredAt)}
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
          {saved.queued
            ? "Guardada en el teléfono · se subirá cuando haya señal"
            : `Entrega guardada · ${saved.saved}`}
        </div>
      )}
    </div>
  );
}

/** Lets the driver check, before leaving the signal area, that the client list is on the phone. */
function ClientListInfo({
  clients,
  syncedAt,
  online,
  today,
}: ClientListState & { online: boolean; today: string }) {
  if (clients === undefined) {
    return online ? null : (
      <p className={styles.clientsInfo}>
        Abre la app con señal para descargar la lista de clientes.
      </p>
    );
  }
  const count = `${clients.length} ${clients.length === 1 ? "cliente disponible" : "clientes disponibles"} sin señal`;
  const when =
    syncedAt === undefined
      ? ""
      : ` · actualizada ${isoDate(syncedAt) === today ? `hoy ${formatTime(syncedAt)}` : formatShort(syncedAt)}`;
  return (
    <p className={styles.clientsInfo}>
      {count}
      {when}
    </p>
  );
}

function WaitingItem({
  item,
  uploading,
  today,
}: {
  item: OutboxItem;
  uploading: boolean;
  today: string;
}) {
  const when =
    isoDate(item.deliveredAt) === today ? formatTime(item.deliveredAt) : formatShort(item.deliveredAt);
  return (
    <li className={`card ${styles.item} ${item.error ? styles.itemFailed : ""}`}>
      <strong>{item.clientName}</strong>
      <div className={styles.itemMeta}>
        <span>
          {cleanInvoice(item.invoiceNumber)} · {when}
        </span>
        {uploading ? (
          <span className={`${styles.syncBadge} ${styles.syncUploading}`}>
            <Spinner size={12} /> Subiendo…
          </span>
        ) : item.error ? (
          <span className={`${styles.syncBadge} ${styles.syncFailed}`}>No se pudo subir</span>
        ) : (
          <span className={styles.syncBadge}>Pendiente de subir</span>
        )}
      </div>
      {item.error && <p className={styles.itemError}>{item.error}</p>}
    </li>
  );
}
