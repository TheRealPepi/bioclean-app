import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { cleanInvoice, cleanName, normalizeKey } from "../../../convex/lib/text";
import { ClientCombobox } from "../../components/ClientCombobox";
import { CloseIcon } from "../../components/Icons";
import { PaymentSelect } from "../../components/PaymentSelect";
import { PhotoCapture } from "../../components/PhotoCapture";
import { FullScreenSpinner, Spinner } from "../../components/Spinner";
import { StatusSelect } from "../../components/StatusSelect";
import {
  clearDraft,
  draftHasContent,
  emptyDraft,
  loadDraft,
  saveDraft,
  type Draft,
  type PhotoKey,
} from "../../lib/draft";
import type { Me } from "../../lib/me";
import { readCache, writeCache } from "../../lib/offlineCache";
import { PhotoReadError } from "../../lib/outbox";
import { useOutbox } from "../../lib/OutboxProvider";
import type { ClientList } from "../../lib/useClientList";
import { useOnline } from "../../lib/useOnline";
import type { Vehicle } from "../../lib/useVehicleList";
import { InvoicesStep, LocationStep, ReviewStep, VehicleStep } from "./steps";
import styles from "./NewDeliveryWizard.module.css";

type StepKey =
  | "client"
  | "vehicle"
  | "invoices"
  | "receiverPhoto"
  | "goodsPhoto"
  | "location"
  | "status"
  | "payment"
  | "notes"
  | "review";

const STEPS: { key: StepKey; title: string; hint?: string }[] = [
  { key: "client", title: "Cliente", hint: "Elige el cliente de la lista o escribe uno nuevo." },
  { key: "vehicle", title: "Vehículo", hint: "¿En qué vehículo haces esta entrega?" },
  {
    key: "invoices",
    title: "Facturas",
    hint: "Número y foto de cada factura. Que se lean el número y la firma.",
  },
  { key: "receiverPhoto", title: "Foto de quien recibe", hint: "La persona que recibe la mercancía." },
  { key: "goodsPhoto", title: "Foto de la mercancía", hint: "La mercancía entregada." },
  { key: "location", title: "Ubicación de entrega" },
  { key: "status", title: "Estatus de la entrega" },
  { key: "payment", title: "Pago", hint: "¿La entrega quedó pagada o es a crédito?" },
  { key: "notes", title: "Anotaciones" },
  { key: "review", title: "Revisa y guarda" },
];

const PHOTO_STEPS: Partial<Record<StepKey, PhotoKey>> = {
  receiverPhoto: "receiver",
  goodsPhoto: "goods",
};

function invoicesValid(d: Draft): boolean {
  const numbers = d.invoices.map((i) => cleanInvoice(i.number));
  return (
    d.invoices.length > 0 &&
    d.invoices.every((i) => i.photo !== undefined) &&
    numbers.every(Boolean) &&
    new Set(numbers).size === numbers.length
  );
}

function isStepValid(key: StepKey, d: Draft, vehicles: Vehicle[] | undefined): boolean {
  switch (key) {
    case "client":
      return d.clientName.trim() !== "";
    case "vehicle":
      // Never blocks when there's no list (not downloaded yet, or none added).
      return !vehicles?.length || vehicles.some((v) => v._id === d.vehicleId);
    case "invoices":
      return invoicesValid(d);
    case "receiverPhoto":
    case "goodsPhoto":
      return d.photos[PHOTO_STEPS[key]!] !== undefined;
    case "location":
      return d.location !== undefined && d.locationSource !== undefined;
    case "status":
      return d.status !== undefined;
    case "payment":
      return d.payment !== undefined;
    case "notes":
      return d.status === "exitosa" || d.notes.trim() !== "";
    case "review":
      return STEPS.slice(0, -1).every((s) => isStepValid(s.key, d, vehicles));
  }
}

const lastVehicleKey = (userId: string) => `lastVehicle:${userId}`;

export function NewDeliveryWizard({
  me,
  clients,
  vehicles,
}: {
  me: Me;
  clients: ClientList | undefined;
  vehicles: Vehicle[] | undefined;
}) {
  const navigate = useNavigate();
  const online = useOnline();
  const outbox = useOutbox()!;

  // New clients typed in deliveries still waiting to upload, so the driver can
  // pick them again without signal. The server matches them by name on upload.
  const clientOptions = useMemo(() => {
    if (!clients) return undefined;
    const known = new Set(clients.map((c) => normalizeKey(c.name)));
    const pending: { name: string }[] = [];
    for (const item of outbox.items) {
      const key = normalizeKey(item.clientName);
      if (item.clientId || !key || known.has(key)) continue;
      known.add(key);
      pending.push({ name: cleanName(item.clientName) });
    }
    if (pending.length === 0) return clients;
    return [...clients, ...pending].sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [clients, outbox.items]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadDraft(me._id).then(
      (saved) => setDraft(saved ?? emptyDraft(readCache<Vehicle>(lastVehicleKey(me._id)))),
    );
  }, [me._id]);

  useEffect(() => {
    if (draft && draftHasContent(draft)) void saveDraft(me._id, draft);
  }, [draft, me._id]);

  if (!draft) return <FullScreenSpinner />;

  const stepIndex = Math.min(draft.step, STEPS.length - 1);
  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const valid = isStepValid(step.key, draft, vehicles);
  // The client's saved location, from the list saved on the phone.
  const savedLocation =
    (draft.clientId && clients?.find((c) => c._id === draft.clientId)?.location) || null;

  const patch = (changes: Partial<Draft>) =>
    setDraft((d) => d && { ...d, ...changes, updatedAt: Date.now() });

  const goTo = (index: number) => {
    setError(null);
    patch({ step: index });
    window.scrollTo(0, 0);
  };

  // Saved on the phone first, with or without signal; OutboxProvider uploads it.
  async function submit(d: Draft) {
    setError(null);
    setSubmitting(true);
    try {
      await outbox.enqueue(d);
    } catch (e) {
      setError(
        e instanceof PhotoReadError
          ? "No se pudo leer una de las fotos. Vuelve a tomar las fotos e inténtalo de nuevo."
          : "No se pudo guardar en el teléfono. Revisa que tenga espacio libre e inténtalo de nuevo.",
      );
      setSubmitting(false);
      return;
    }
    if (d.vehicleId && d.vehicleName) {
      writeCache(lastVehicleKey(me._id), { _id: d.vehicleId, name: d.vehicleName });
    }
    await clearDraft(me._id);
    navigate("/", { replace: true, state: { saved: d.clientName, queued: !online } });
  }

  const photoKey = PHOTO_STEPS[step.key];
  const notesRequired = draft.status !== undefined && draft.status !== "exitosa";

  return (
    <div className={styles.wizard}>
      <header className={styles.header}>
        <div className={styles.headerRow}>
          <Link to="/" className={styles.close} aria-label="Salir (tu avance se guarda)">
            <CloseIcon size={22} />
          </Link>
          <div className={styles.headerText}>
            <strong>Nueva entrega</strong>
            <span>
              Paso {stepIndex + 1} de {STEPS.length}
            </span>
          </div>
        </div>
        <div className={styles.progress}>
          <div style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }} />
        </div>
      </header>

      <main className={styles.body}>
        <h1 className={styles.title}>{step.title}</h1>
        {step.key === "location" ? (
          savedLocation && (
            <p className={styles.hint}>
              Ubicación guardada de este cliente. Continúa con ella o modifícala si la entrega es en
              otro lugar.
            </p>
          )
        ) : step.key === "notes" ? (
          <p className={styles.hint}>
            {notesRequired
              ? "Obligatorio: explica qué pasó (qué faltó, qué se cambió, quién lo autorizó…)."
              : "Opcional: cualquier detalle que quieras dejar registrado."}
          </p>
        ) : (
          step.hint && <p className={styles.hint}>{step.hint}</p>
        )}

        {step.key === "client" && (
          <ClientCombobox
            clients={clientOptions}
            offline={!online}
            value={{ clientId: draft.clientId, clientName: draft.clientName }}
            onChange={(v) =>
              patch({
                clientId: v.clientId,
                clientName: v.clientName,
                // The location depends on the client.
                location: undefined,
                locationSource: undefined,
                driverPosition: undefined,
              })
            }
          />
        )}

        {step.key === "vehicle" && (
          <VehicleStep
            vehicles={vehicles}
            value={draft.vehicleId}
            onChange={(v) => patch({ vehicleId: v._id, vehicleName: v.name })}
          />
        )}

        {step.key === "invoices" && (
          <InvoicesStep value={draft.invoices} onChange={(invoices) => patch({ invoices })} />
        )}

        {photoKey && (
          <PhotoCapture
            key={photoKey}
            alt={step.title}
            value={draft.photos[photoKey]}
            onChange={(photo) => patch({ photos: { ...draft.photos, [photoKey]: photo } })}
          />
        )}

        {step.key === "location" && (
          <LocationStep
            saved={savedLocation}
            value={draft}
            onChange={(changes) => patch(changes)}
            onDriverPosition={(driverPosition) =>
              setDraft(
                (d) =>
                  d && (d.locationSource === "modificada" ? d : { ...d, driverPosition }),
              )
            }
            onContinue={() => goTo(stepIndex + 1)}
          />
        )}

        {step.key === "status" && (
          <StatusSelect value={draft.status} onChange={(status) => patch({ status })} />
        )}

        {step.key === "payment" && (
          <PaymentSelect value={draft.payment} onChange={(payment) => patch({ payment })} />
        )}

        {step.key === "notes" && (
          <textarea
            className="input"
            value={draft.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            placeholder="Escribe aquí tus anotaciones"
            rows={6}
          />
        )}

        {step.key === "review" && (
          <ReviewStep
            draft={draft}
            showVehicle={Boolean(vehicles?.length || draft.vehicleId)}
            onEdit={(key) => goTo(STEPS.findIndex((s) => s.key === key))}
          />
        )}

        {error && <p className={styles.error}>{error}</p>}
      </main>

      <footer className={styles.footer}>
        {stepIndex > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-lg"
            onClick={() => goTo(stepIndex - 1)}
            disabled={submitting}
          >
            Atrás
          </button>
        )}
        {isLast ? (
          <button
            type="button"
            className={`btn btn-primary btn-lg ${styles.next}`}
            disabled={!valid || submitting}
            onClick={() => void submit(draft)}
          >
            {submitting ? (
              <>
                <Spinner size={20} light /> Guardando entrega…
              </>
            ) : (
              "Guardar entrega"
            )}
          </button>
        ) : (
          <button
            type="button"
            className={`btn btn-primary btn-lg ${styles.next}`}
            disabled={!valid}
            onClick={() => goTo(stepIndex + 1)}
          >
            Siguiente
          </button>
        )}
      </footer>
    </div>
  );
}

export type { StepKey };
