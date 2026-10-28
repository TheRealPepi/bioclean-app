import { useMemo, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { cleanName, normalizeKey } from "../../convex/lib/text";
import { CheckIcon, PlusIcon } from "./Icons";
import styles from "./ClientCombobox.module.css";
import { Spinner } from "./Spinner";

type Client = { _id: Id<"clients">; name: string };
export type ClientValue = { clientId?: Id<"clients">; clientName: string };

const MAX_RESULTS = 40;

export function ClientCombobox({
  clients,
  value,
  onChange,
}: {
  clients: Client[] | undefined;
  value: ClientValue;
  onChange: (value: ClientValue) => void;
}) {
  const [query, setQuery] = useState("");
  const key = normalizeKey(query);

  const { matches, exact } = useMemo(() => {
    if (!clients) return { matches: [], exact: undefined };
    const matches = key ? clients.filter((c) => normalizeKey(c.name).includes(key)) : clients;
    const exact = key ? clients.find((c) => normalizeKey(c.name) === key) : undefined;
    return { matches: matches.slice(0, MAX_RESULTS), exact };
  }, [clients, key]);

  if (value.clientName) {
    return (
      <div className={styles.selected}>
        <div>
          <div className={styles.selectedName}>{value.clientName}</div>
          <div className={styles.selectedHint}>
            {value.clientId ? "Cliente existente" : "Cliente nuevo · se guardará para la próxima entrega"}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setQuery("");
            onChange({ clientName: "" });
          }}
        >
          Cambiar
        </button>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <input
        className="input"
        type="search"
        placeholder="Buscar o escribir nombre del cliente"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
        autoCapitalize="characters"
        enterKeyHint="done"
        autoFocus
      />

      <ul className={styles.list} role="listbox">
        {key && !exact && (
          <li>
            <button
              type="button"
              className={`${styles.option} ${styles.add}`}
              onClick={() => onChange({ clientName: cleanName(query) })}
            >
              <PlusIcon size={18} />
              <span>
                Agregar <strong>{cleanName(query)}</strong>
              </span>
            </button>
          </li>
        )}
        {matches.map((client) => (
          <li key={client._id}>
            <button
              type="button"
              className={styles.option}
              onClick={() => onChange({ clientId: client._id, clientName: client.name })}
            >
              <span>{client.name}</span>
              {exact?._id === client._id && <CheckIcon size={18} className={styles.match} />}
            </button>
          </li>
        ))}
        {clients === undefined && (
          <li className={styles.empty}>
            <Spinner size={22} />
          </li>
        )}
        {clients !== undefined && !key && clients.length === 0 && (
          <li className={styles.empty}>Aún no hay clientes. Escribe el nombre para agregarlo.</li>
        )}
      </ul>
    </div>
  );
}
