import { useState } from "react";
import { normalizeKey } from "../../../convex/lib/text";
import { CheckIcon, ChevronDownIcon, ExternalIcon, PinIcon } from "../../components/Icons";
import { formatShort, formatTime, isoDate } from "../../lib/dates";
import { googleMapsNavUrl, googleMapsRouteUrls, MAPS_STOPS_PER_LINK } from "../../lib/maps";
import type { OutboxItem } from "../../lib/outbox";
import type { DriverRoute } from "../../lib/routes";
import styles from "./RouteCard.module.css";

type Stop = DriverRoute["stops"][number];
type StopState = "delivered" | "queued" | "pending";

/**
 * The route the office planned for this driver, as a checklist. A stop ticks
 * itself off when a delivery to that client is registered: "Por subir" while
 * it's still on the phone, "Entregada" once the server has it.
 */
export function RouteCard({
  route,
  waiting,
  onRegister,
}: {
  route: DriverRoute;
  /** Deliveries saved on the phone and not uploaded yet. */
  waiting: OutboxItem[];
  onRegister: (stop: Stop) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const stateOf = (stop: Stop): StopState => {
    if (stop.delivered) return "delivered";
    const key = normalizeKey(stop.clientName);
    const queued = waiting.some(
      (item) =>
        item.deliveredAt >= route.createdAt &&
        (item.clientId === stop.clientId || normalizeKey(item.clientName) === key),
    );
    return queued ? "queued" : "pending";
  };
  const stops = route.stops.map((stop) => ({ stop, state: stateOf(stop) }));
  const pending = stops.filter((s) => s.state === "pending").map((s) => s.stop);
  const done = stops.length - pending.length;
  // The next stop is open unless the driver opened another pending one.
  const open = pending.find((s) => s.clientId === openId) ?? pending[0];

  // Only what's left, so the link never sends the driver back to a finished stop.
  const mapsUrl = googleMapsRouteUrls(
    pending.map((s) => s.location),
    route.returnToBase ? route.base : null,
  )[0];
  const expires =
    isoDate(route.expiresAt) === isoDate()
      ? `hoy ${formatTime(route.expiresAt)}`
      : formatShort(route.expiresAt);

  return (
    <section>
      <div className={styles.header}>
        <h2 className={styles.title}>
          Tu ruta · {done} de {stops.length}
        </h2>
        <span className={styles.expires}>Vence {expires}</span>
      </div>
      <div className={styles.progress} aria-hidden="true">
        <div style={{ width: `${(done / stops.length) * 100}%` }} />
      </div>

      {pending.length === 0 ? (
        <p className={`card ${styles.finished}`}>
          <CheckIcon size={20} /> Ruta terminada. ¡Buen trabajo!
        </p>
      ) : (
        <a className={`btn btn-soft ${styles.wholeRoute}`} href={mapsUrl} target="_blank" rel="noreferrer">
          <ExternalIcon size={18} />
          {pending.length > MAPS_STOPS_PER_LINK
            ? `Abrir las próximas ${MAPS_STOPS_PER_LINK} paradas en Google Maps`
            : pending.length === 1
              ? "Abrir en Google Maps"
              : `Abrir las ${pending.length} paradas en Google Maps`}
        </a>
      )}

      <ol className={styles.stops}>
        {stops.map(({ stop, state }, i) => {
          const isOpen = state === "pending" && stop.clientId === open?.clientId;
          return (
            <li
              key={stop.clientId}
              className={`card ${styles.stop} ${isOpen ? styles.stopOpen : ""} ${state === "pending" ? "" : styles.stopDone}`}
            >
              <button
                type="button"
                className={styles.stopRow}
                disabled={state !== "pending"}
                aria-expanded={state === "pending" ? isOpen : undefined}
                onClick={() => setOpenId(stop.clientId)}
              >
                <span className={styles.number}>
                  {state === "pending" ? i + 1 : <CheckIcon size={16} strokeWidth={3} />}
                </span>
                <strong className={styles.name}>{stop.clientName}</strong>
                {state === "delivered" && <span className={styles.badge}>Entregada</span>}
                {state === "queued" && (
                  <span className={`${styles.badge} ${styles.badgeQueued}`}>Por subir</span>
                )}
                {state === "pending" && !isOpen && <ChevronDownIcon size={18} />}
              </button>
              {isOpen && stop.customLocation && (
                <p className={styles.customLocation}>
                  <PinIcon size={16} /> La oficina indicó otra ubicación para esta ruta.
                </p>
              )}
              {isOpen && (
                <div className={styles.actions}>
                  <a
                    className="btn btn-soft"
                    href={googleMapsNavUrl(stop.location)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <PinIcon size={18} /> Navegar
                  </a>
                  <button type="button" className="btn btn-primary" onClick={() => onRegister(stop)}>
                    Registrar entrega
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
