import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CheckIcon, ExternalIcon, PlusIcon } from "../../components/Icons";
import { Modal } from "../../components/Modal";
import { CenteredSpinner } from "../../components/Spinner";
import { copyText } from "../../lib/clipboard";
import { formatShort } from "../../lib/dates";
import { errorMessage } from "../../lib/errors";
import {
  legLabel,
  routeMapsUrls,
  routeMessage,
  routeTemplate,
  stopsLabel,
  type AdminRoute,
} from "../../lib/routes";
import { useNow } from "../../lib/useNow";
import list from "./ListPage.module.css";
import styles from "./RoutesPage.module.css";

export function RoutesPage() {
  const routes = useQuery(api.routes.listAdmin);
  const remove = useMutation(api.routes.remove);
  const navigate = useNavigate();
  const location = useLocation();
  const now = useNow();

  // The builder sends the new route's id so its share dialog opens right away.
  const [sharingId, setSharingId] = useState<Id<"routes"> | null>(
    (location.state as { shareId?: Id<"routes"> } | null)?.shareId ?? null,
  );
  useEffect(() => {
    if (location.state) navigate(".", { replace: true, state: null });
  }, [location.state, navigate]);

  if (routes === undefined) return <CenteredSpinner />;

  const sharing = routes.find((r) => r._id === sharingId);

  return (
    <div className={list.page}>
      <div className={list.heading}>
        <div>
          <h1>Rutas</h1>
          <p>
            Elige los clientes del día y la app ordena las paradas. El chofer ve la ruta en su
            teléfono durante 24 horas; después aparece aquí como vencida y se borra sola a los 30
            días.
          </p>
        </div>
        <Link to="/rutas/nueva" className="btn btn-primary">
          <PlusIcon size={18} /> Nueva ruta
        </Link>
      </div>

      <section className={`card ${list.tableCard}`}>
        {routes.length === 0 ? (
          <div className={list.empty}>
            Aún no hay rutas. Toca <strong>Nueva ruta</strong> para armar la primera.
          </div>
        ) : (
          <table className={list.table}>
            <thead>
              <tr>
                <th>Chofer</th>
                <th>Paradas</th>
                <th>Avance</th>
                <th className={list.hideMobile}>Vigencia</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {routes.map((route) => {
                const expired = route.expiresAt <= now;
                const done = route.stops.filter((s) => s.deliveryId).length;
                return (
                  <tr key={route._id} className={expired ? styles.expired : undefined}>
                    <td>
                      <strong>{route.driverName}</strong>
                      <div className={styles.sub}>Creada {formatShort(route.createdAt)}</div>
                    </td>
                    <td>
                      {stopsLabel(route.stops.length)}
                      <div className={styles.sub}>
                        {route.stops
                          .slice(0, 3)
                          .map((s) => s.clientName)
                          .join(", ")}
                        {route.stops.length > 3 && "…"}
                      </div>
                    </td>
                    <td>
                      <span className={done === route.stops.length ? styles.complete : undefined}>
                        {done} de {route.stops.length}
                      </span>
                      <div className={styles.sub}>
                        {done === 1 ? "entregada" : "entregadas"}
                      </div>
                    </td>
                    <td className={list.hideMobile}>
                      {expired ? (
                        <span className={styles.badgeExpired}>Vencida</span>
                      ) : (
                        <>
                          <span className={styles.badgeActive}>Activa</span>
                          <div className={styles.sub}>Vence {formatShort(route.expiresAt)}</div>
                        </>
                      )}
                    </td>
                    <td>
                      <div className={list.actions}>
                        {!expired && (
                          <button
                            type="button"
                            className="btn btn-soft"
                            onClick={() => setSharingId(route._id)}
                          >
                            Compartir
                          </button>
                        )}
                        {!expired && (
                          <Link to={`/rutas/${route._id}/editar`} className="btn btn-ghost">
                            Editar
                          </Link>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() =>
                            navigate("/rutas/nueva", { state: { template: routeTemplate(route) } })
                          }
                        >
                          Usar de nuevo
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            if (
                              confirm(
                                expired
                                  ? "¿Eliminar esta ruta vencida?"
                                  : `¿Eliminar la ruta de ${route.driverName}? Dejará de verla en su teléfono. Las entregas ya registradas no se borran.`,
                              )
                            ) {
                              void remove({ routeId: route._id }).catch((e) =>
                                alert(errorMessage(e)),
                              );
                            }
                          }}
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {sharing && <ShareDialog route={sharing} onClose={() => setSharingId(null)} />}
    </div>
  );
}

function ShareDialog({ route, onClose }: { route: AdminRoute; onClose: () => void }) {
  const urls = routeMapsUrls(route);
  const message = routeMessage(route, window.location.origin);
  // Which button was just used, to confirm it on the button itself.
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(key: string, text: string) {
    if (!(await copyText(text))) {
      alert("No se pudo copiar. Selecciona el texto y cópialo a mano.");
      return;
    }
    setCopied(key);
    setTimeout(() => setCopied((current) => (current === key ? null : current)), 2000);
  }

  const copyLabel = (key: string, label: string) =>
    copied === key ? (
      <>
        <CheckIcon size={16} /> Copiado
      </>
    ) : (
      label
    );

  return (
    <Modal
      title={`Ruta de ${route.driverName.split(" ")[0]}`}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void copy("message", message)}
          >
            {copyLabel("message", "Copiar mensaje")}
          </button>
          <a
            className="btn btn-primary"
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noreferrer"
          >
            Abrir WhatsApp
          </a>
        </>
      }
    >
      <p className={list.formIntro}>
        Envíale este mensaje al chofer. También verá la ruta en la app, en <strong>Tu ruta</strong>{" "}
        (vence el {formatShort(route.expiresAt)}).
      </p>

      <textarea
        className={`input ${styles.message}`}
        value={message}
        readOnly
        rows={9}
        aria-label="Mensaje para el chofer"
        onFocus={(e) => e.target.select()}
      />

      <span className="label">
        {urls.length === 1 ? "Enlace de Google Maps" : "Enlaces de Google Maps"}
      </span>
      {urls.length > 1 && (
        <p className={styles.legsHint}>
          Google Maps acepta 10 paradas por enlace, así que la ruta va en {urls.length} tramos.
        </p>
      )}
      <ul className={styles.links}>
        {urls.map((url, i) => (
          <li key={url}>
            <a href={url} target="_blank" rel="noreferrer">
              {urls.length === 1 ? "Abrir la ruta" : legLabel(i, route)} <ExternalIcon size={14} />
            </a>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void copy(`link${i}`, url)}
            >
              {copyLabel(`link${i}`, "Copiar enlace")}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
