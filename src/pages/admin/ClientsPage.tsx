import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { normalizeKey } from "../../../convex/lib/text";
import { ExternalIcon } from "../../components/Icons";
import { Modal } from "../../components/Modal";
import { CenteredSpinner } from "../../components/Spinner";
import { formatShort, isoDate, shiftDays } from "../../lib/dates";
import { errorMessage } from "../../lib/errors";
import { googleMapsUrl } from "../../lib/maps";
import styles from "./ListPage.module.css";

type Client = {
  _id: Id<"clients">;
  name: string;
  deliveryCount: number;
  lastDeliveryAt: number | null;
  location: { lat: number; lng: number } | null;
};

export function ClientsPage() {
  const clients = useQuery(api.clients.list);
  const clearLocation = useMutation(api.clients.clearLocation);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<Id<"clients"> | null>(null);
  const [merging, setMerging] = useState<Client | null>(null);

  const filtered = useMemo(() => {
    const key = normalizeKey(search);
    return (clients ?? []).filter((c) => !key || normalizeKey(c.name).includes(key));
  }, [clients, search]);

  if (clients === undefined) return <CenteredSpinner />;

  const today = isoDate();
  const deliveriesLink = (name: string) =>
    `/entregas?q=${encodeURIComponent(name)}&desde=${shiftDays(today, -90)}&hasta=${today}`;

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <div>
          <h1>Clientes</h1>
          <p>Los choferes agregan clientes nuevos al registrar una entrega.</p>
        </div>
        <input
          className={`input ${styles.searchBox}`}
          type="search"
          placeholder="Buscar cliente"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <section className={`card ${styles.tableCard}`}>
        {filtered.length === 0 ? (
          <div className={styles.empty}>
            {clients.length === 0 ? "Aún no hay clientes." : "Ningún cliente coincide."}
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Cliente</th>
                <th className={styles.num}>Entregas</th>
                <th className={styles.hideMobile}>Última entrega</th>
                <th className={styles.hideMobile}>Ubicación</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((client) =>
                editingId === client._id ? (
                  <tr key={client._id}>
                    <td colSpan={5}>
                      <RenameRow client={client} onDone={() => setEditingId(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={client._id}>
                    <td>
                      <Link className={styles.clientLink} to={deliveriesLink(client.name)}>
                        {client.name}
                      </Link>
                    </td>
                    <td className={styles.num}>{client.deliveryCount}</td>
                    <td className={`${styles.muted} ${styles.hideMobile}`}>
                      {client.lastDeliveryAt ? formatShort(client.lastDeliveryAt) : "—"}
                    </td>
                    <td className={styles.hideMobile}>
                      {client.location ? (
                        <a
                          className={styles.locationCell}
                          href={googleMapsUrl(client.location)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Ver mapa <ExternalIcon size={14} />
                        </a>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setEditingId(client._id)}
                        >
                          Renombrar
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setMerging(client)}
                          disabled={clients.length < 2}
                        >
                          Fusionar…
                        </button>
                        {client.location && (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => {
                              if (
                                confirm(
                                  `¿Quitar la ubicación guardada de ${client.name}? La próxima entrega guardará una nueva.`,
                                )
                              ) {
                                void clearLocation({ clientId: client._id }).catch((e) =>
                                  alert(errorMessage(e)),
                                );
                              }
                            }}
                          >
                            Quitar ubicación
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}
      </section>

      {merging && (
        <MergeDialog from={merging} clients={clients} onClose={() => setMerging(null)} />
      )}
    </div>
  );
}

function RenameRow({ client, onDone }: { client: Client; onDone: () => void }) {
  const rename = useMutation(api.clients.rename);
  const [name, setName] = useState(client.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await rename({ clientId: client._id, name });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className={styles.renameRow}>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          aria-label="Nuevo nombre"
        />
        <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>
          Guardar
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone} disabled={saving}>
          Cancelar
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}

function MergeDialog({
  from,
  clients,
  onClose,
}: {
  from: Client;
  clients: Client[];
  onClose: () => void;
}) {
  const merge = useMutation(api.clients.merge);
  const [filter, setFilter] = useState("");
  const [intoId, setIntoId] = useState<Id<"clients"> | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = normalizeKey(filter);
  const options = clients.filter(
    (c) => c._id !== from._id && (!key || normalizeKey(c.name).includes(key)),
  );
  const into = clients.find((c) => c._id === intoId);

  async function confirm() {
    if (!intoId) return;
    setSaving(true);
    setError(null);
    try {
      await merge({ fromId: from._id, intoId });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Fusionar cliente"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void confirm()}
            disabled={!intoId || saving}
          >
            Fusionar
          </button>
        </>
      }
    >
      <p>
        Une <strong>{from.name}</strong> con otro cliente cuando es el mismo escrito diferente.
      </p>
      <label>
        <span className="label">Fusionar con</span>
        <input
          className="input"
          type="search"
          placeholder="Buscar cliente"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoFocus
        />
      </label>
      <select
        className={`input ${styles.mergeList}`}
        size={Math.min(8, Math.max(3, options.length))}
        value={intoId}
        onChange={(e) => setIntoId(e.target.value as Id<"clients">)}
        aria-label="Cliente destino"
      >
        {options.map((c) => (
          <option key={c._id} value={c._id}>
            {c.name}
          </option>
        ))}
      </select>
      {into && (
        <p>
          {from.deliveryCount === 1 ? "La entrega" : `Las ${from.deliveryCount} entregas`} de{" "}
          <strong>{from.name}</strong> pasarán a <strong>{into.name}</strong>, y{" "}
          <strong>{from.name}</strong> se eliminará de la lista.
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
    </Modal>
  );
}
