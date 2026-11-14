import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { normalizeKey } from "../../../convex/lib/text";
import { ExternalIcon } from "../../components/Icons";
import { Modal } from "../../components/Modal";
import { CenteredSpinner } from "../../components/Spinner";
import { formatDay, formatShort, isoDate, shiftDays, startOfDay } from "../../lib/dates";
import { errorMessage } from "../../lib/errors";
import { googleMapsUrl } from "../../lib/maps";
import {
  NOTIFY_LABEL,
  REMINDER_CHANNEL_LABEL,
  REMINDER_KIND_LABEL,
  type NotifyChannel,
} from "../../lib/payment";
import styles from "./ListPage.module.css";

type Client = FunctionReturnType<typeof api.clients.listAdmin>[number];

const days = (n: number) => (n === 1 ? "1 día" : `${n} días`);

export function ClientsPage() {
  const clients = useQuery(api.clients.listAdmin);
  const clearLocation = useMutation(api.clients.clearLocation);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<Id<"clients"> | null>(null);
  const [merging, setMerging] = useState<Client | null>(null);
  const [billingId, setBillingId] = useState<Id<"clients"> | null>(null);

  const filtered = useMemo(() => {
    const key = normalizeKey(search);
    return (clients ?? []).filter((c) => !key || normalizeKey(c.name).includes(key));
  }, [clients, search]);

  if (clients === undefined) return <CenteredSpinner />;

  // Looked up on every render so the dialog shows what was just saved.
  const billing = clients.find((c) => c._id === billingId);
  const today = isoDate();
  const deliveriesLink = (name: string) =>
    `/entregas?q=${encodeURIComponent(name)}&desde=${shiftDays(today, -90)}&hasta=${today}`;

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <div>
          <h1>Clientes</h1>
          <p>
            Los choferes agregan clientes nuevos al registrar una entrega. En{" "}
            <strong>Recordatorios…</strong> se configuran los avisos de pago de las entregas a
            crédito.
          </p>
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
                <th className={styles.hideMobile}>Recordatorios de pago</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((client) =>
                editingId === client._id ? (
                  <tr key={client._id}>
                    <td colSpan={6}>
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
                    <td className={styles.hideMobile}>
                      {client.notifyBy ? (
                        <>
                          {NOTIFY_LABEL[client.notifyBy]}
                          {client.creditDays !== null && (
                            <span className={styles.muted}> · {days(client.creditDays)}</span>
                          )}
                        </>
                      ) : (
                        <span className={styles.muted}>
                          {client.creditDays !== null
                            ? `Sin avisos · ${days(client.creditDays)}`
                            : "—"}
                        </span>
                      )}
                    </td>
                    <td>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setBillingId(client._id)}
                        >
                          Recordatorios…
                        </button>
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
      {billing && <BillingDialog client={billing} onClose={() => setBillingId(null)} />}
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

const CHANNEL_OPTIONS: { value: NotifyChannel | ""; label: string }[] = [
  { value: "", label: "No avisar" },
  { value: "email", label: "Correo" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "ambos", label: "Ambos" },
];

/** Contact data, credit days and channel for a client's payment reminders. */
function BillingDialog({ client, onClose }: { client: Client; onClose: () => void }) {
  const update = useMutation(api.clients.updateBilling);
  const sendTest = useMutation(api.reminders.sendTest);
  const history = useQuery(api.reminders.listForClient, { clientId: client._id });
  const [email, setEmail] = useState(client.email ?? "");
  const [whatsapp, setWhatsapp] = useState(client.whatsapp ? `+${client.whatsapp}` : "");
  const [creditDays, setCreditDays] = useState(client.creditDays?.toString() ?? "");
  const [notifyBy, setNotifyBy] = useState<NotifyChannel | "">(client.notifyBy ?? "");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The test goes to what is saved, not to what is typed.
  const dirty =
    email.trim().toLowerCase() !== (client.email ?? "") ||
    whatsapp.replace(/\D/g, "") !== (client.whatsapp ?? "") ||
    creditDays.trim() !== (client.creditDays?.toString() ?? "") ||
    notifyBy !== (client.notifyBy ?? "");

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await update({
        clientId: client._id,
        email,
        whatsapp,
        creditDays: creditDays.trim() === "" ? null : Number(creditDays),
        notifyBy: notifyBy || null,
      });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTested(false);
    setError(null);
    try {
      await sendTest({ clientId: client._id });
      setTested(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTesting(false);
    }
  }

  return (
    <Modal
      title="Recordatorios de pago"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            type="submit"
            form="billing-form"
            className="btn btn-primary"
            disabled={saving || !dirty}
          >
            Guardar
          </button>
        </>
      }
    >
      <form
        id="billing-form"
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className={styles.formIntro}>
          <strong>{client.name}</strong> recibe un aviso una semana antes de la fecha límite de pago
          de cada entrega a crédito, y otro el día que vence.
        </p>
        <label>
          <span className="label">Días de crédito (de la entrega a la fecha límite de pago)</span>
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            step={1}
            placeholder="Por ejemplo, 30"
            value={creditDays}
            onChange={(e) => setCreditDays(e.target.value)}
          />
        </label>
        <label>
          <span className="label">Correo</span>
          <input
            className="input"
            type="email"
            placeholder="pagos@cliente.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          <span className="label">WhatsApp (con clave de país)</span>
          <input
            className="input"
            type="tel"
            placeholder="+52 987 123 4567"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
          />
        </label>
        <div>
          <span className="label">Avisar por</span>
          <div className={styles.channels} role="radiogroup" aria-label="Avisar por">
            {CHANNEL_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={option.value === notifyBy}
                className={`${styles.channel} ${
                  option.value === notifyBy ? styles.channelSelected : ""
                }`}
                onClick={() => setNotifyBy(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
      </form>

      <div className={styles.history}>
        <div className={styles.historyHeader}>
          <span className="label">Últimos avisos</span>
          <button
            type="button"
            className="btn btn-soft"
            onClick={() => void test()}
            disabled={testing || dirty || !client.notifyBy}
            title={dirty ? "Guarda los cambios antes de enviar la prueba" : undefined}
          >
            Enviar prueba
          </button>
        </div>
        {tested && (
          <p className={styles.muted}>Prueba en camino: el resultado aparece aquí en unos segundos.</p>
        )}
        {history === undefined ? null : history.length === 0 ? (
          <p className={styles.muted}>Aún no se le ha enviado ningún aviso.</p>
        ) : (
          <ul className={styles.historyList}>
            {history.map((r) => (
              <li key={r._id}>
                <div>
                  <strong>{REMINDER_KIND_LABEL[r.kind]}</strong> por{" "}
                  {REMINDER_CHANNEL_LABEL[r.channel]} · {formatShort(r.sentAt)}
                </div>
                <div className={styles.muted}>
                  {r.invoiceNumbers.length === 1 ? "Factura" : "Facturas"}{" "}
                  {r.invoiceNumbers.join(", ")} · vence el {formatDay(startOfDay(r.dueDate))}
                </div>
                {r.status === "error" ? (
                  <div className="error-text">No se envió: {r.error}</div>
                ) : (
                  <div className={styles.sent}>Enviado a {r.to}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
