import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CenteredSpinner } from "../../components/Spinner";
import { errorMessage } from "../../lib/errors";
import type { Vehicle } from "../../lib/useVehicleList";
import styles from "./ListPage.module.css";

export function VehiclesPage() {
  const vehicles = useQuery(api.vehicles.list);
  const setActive = useMutation(api.vehicles.setActive);
  const [editingId, setEditingId] = useState<Id<"vehicles"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (vehicles === undefined) return <CenteredSpinner />;

  const active = vehicles.filter((v) => v.active);
  const removed = vehicles.filter((v) => !v.active);

  async function toggle(vehicle: Vehicle, value: boolean) {
    if (
      !value &&
      !confirm(
        `¿Eliminar "${vehicle.name}"? Los choferes ya no podrán elegirlo. Las entregas anteriores lo conservan y puedes restaurarlo después.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await setActive({ vehicleId: vehicle._id, active: value });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <div>
          <h1>Vehículos</h1>
          <p>Los choferes eligen uno de estos vehículos en cada entrega.</p>
        </div>
        <AddVehicle />
      </div>

      {error && <p className="error-text">{error}</p>}

      <section className={`card ${styles.tableCard}`}>
        {active.length === 0 ? (
          <div className={styles.empty}>
            Aún no hay vehículos. Agrega el primero para que los choferes puedan elegirlo.
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Vehículo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {active.map((vehicle) =>
                editingId === vehicle._id ? (
                  <tr key={vehicle._id}>
                    <td colSpan={2}>
                      <RenameRow vehicle={vehicle} onDone={() => setEditingId(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={vehicle._id}>
                    <td>
                      <strong>{vehicle.name}</strong>
                    </td>
                    <td>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setEditingId(vehicle._id)}
                        >
                          Renombrar
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => void toggle(vehicle, false)}
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}
      </section>

      {removed.length > 0 && (
        <details className={styles.pending}>
          <summary>Eliminados · {removed.length}</summary>
          <section className={`card ${styles.tableCard} ${styles.removed}`}>
            <table className={styles.table}>
              <tbody>
                {removed.map((vehicle) => (
                  <tr key={vehicle._id}>
                    <td className={styles.muted}>{vehicle.name}</td>
                    <td>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => void toggle(vehicle, true)}
                        >
                          Restaurar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </details>
      )}
    </div>
  );
}

function AddVehicle() {
  const create = useMutation(api.vehicles.create);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await create({ name });
      setName("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className={styles.addForm}
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
          placeholder="Ej. CAMIONETA NISSAN BLANCA"
          aria-label="Nombre del vehículo"
        />
        <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>
          Agregar vehículo
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}

function RenameRow({ vehicle, onDone }: { vehicle: Vehicle; onDone: () => void }) {
  const rename = useMutation(api.vehicles.rename);
  const [name, setName] = useState(vehicle.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await rename({ vehicleId: vehicle._id, name });
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
