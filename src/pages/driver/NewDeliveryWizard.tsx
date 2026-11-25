import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { Id } from "../../../convex/_generated/dataModel";
import { cleanName, normalizeKey } from "../../../convex/lib/text";
import { ClientCombobox } from "../../components/ClientCombobox";
import { CloseIcon } from "../../components/Icons";
import { PaymentSelect } from "../../components/PaymentSelect";
import { PhotoCapture } from "../../components/PhotoCapture";
import { FullScreenSpinner, Spinner } from "../../components/Spinner";
import {
  clearDraft,
  draftHasContent,
  emptyDraft,
  loadDraft,
  saveDraft,
  type Draft,
} from "../../lib/draft";
import type { Me } from "../../lib/me";
import { readCache, writeCache } from "../../lib/offlineCache";
import { PhotoReadError } from "../../lib/outbox";
import { useOutbox } from "../../lib/OutboxProvider";
import type { ClientList } from "../../lib/useClientList";
import { useEarlierDeliveries } from "../../lib/useEarlierDeliveries";
import { clientStepMissing } from "../../lib/signature";
import { useOnline } from "../../lib/useOnline";
import type { Vehicle } from "../../lib/useVehicleList";
import { isStepValid, PHOTO_STEPS, STEPS, type StepKey } from "../../lib/wizardSteps";
import { SignatureStep, type Attention } from "./SignatureStep";
import { InvoicesStep, LocationStep, ReviewStep, VehicleStep } from "./steps";
import styles from "./NewDeliveryWizard.module.css";

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
  const [attention, setAttention] = useState<Attention | null>(null);

  // Set when the driver tapped "Registrar entrega" on a stop of their route.
  const routeClient = (
    useLocation().state as { client?: { clientId: Id<"clients">; clientName: string } } | null
  )?.client;

  useEffect(() => {
    void loadDraft(me._id).then((saved) => {
      const fresh = emptyDraft(readCache<Vehicle>(lastVehicleKey(me._id)));
      // From a route stop the client is already chosen, so it starts at the
      // next step. An unfinished delivery still wins: the home screen asks
      // before discarding one for another client.
      if (routeClient && !(saved && draftHasContent(saved))) {
        setDraft({ ...fresh, ...routeClient, step: STEPS.findIndex((s) => s.key === "vehicle") });
      } else {
        setDraft(saved ?? fresh);
      }
    });
    // `routeClient` only matters when the wizard opens.
  }, [me._id]);

  useEffect(() => {
    if (draft && draftHasContent(draft)) void saveDraft(me._id, draft);
  }, [draft, me._id]);

  // Looked up on every step, so a factura another driver registers meanwhile
  // still stops this delivery before it's saved.
  const earlier = useEarlierDeliveries(draft);

  if (!draft) return <FullScreenSpinner />;

  const stepIndex = Math.min(draft.step, STEPS.length - 1);
  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const valid = isStepValid(step.key, draft, vehicles, earlier);
  // The client's saved location, from the list saved on the phone.
  const savedLocation =
    (draft.clientId && clients?.find((c) => c._id === draft.clientId)?.location) || null;

  const patch = (changes: Partial<Draft>) =>
    setDraft((d) => d && { ...d, ...changes, updatedAt: Date.now() });

  const goTo = (index: number) => {
    setError(null);
    setAttention(null);
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
  const forClient = step.key === "signature";
  // On the client's screen, what's still missing there (null: ready to save).
  const missing = forClient ? clientStepMissing(draft) : null;

  return (
    <div className={styles.wizard}>
      <header className={styles.header}>
        <div className={styles.headerRow}>
          <Link to="/" className={styles.close} aria-label="Salir (tu avance se guarda)">
            <CloseIcon size={22} />
          </Link>
          <div className={styles.headerText}>
            {forClient ? (
              <>
                <strong>Para el cliente</strong>
                <span>Último paso</span>
              </>
            ) : (
              <>
                <strong>Nueva entrega</strong>
                <span>
                  Paso {stepIndex + 1} de {STEPS.length}
                </span>
              </>
            )}
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
                // A follow-up is of a delivery to that client: ask again.
                invoices: draft.invoices.map(({ followUp: _, ...invoice }) => invoice),
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
          <InvoicesStep
            value={draft.invoices}
            earlier={earlier}
            onChange={(invoices) => patch({ invoices })}
          />
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
            earlier={earlier}
            showVehicle={Boolean(vehicles?.length || draft.vehicleId)}
            onEdit={(key) => goTo(STEPS.findIndex((s) => s.key === key))}
          />
        )}

        {step.key === "signature" && (
          <SignatureStep draft={draft} onChange={patch} attention={attention} />
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
            // Never silently disabled for the client: while something's
            // missing it says what, and a tap takes them there.
            className={`btn btn-primary btn-lg ${styles.next} ${
              missing ? styles.pending : styles.nudge
            }`}
            disabled={!isStepValid("review", draft, vehicles, earlier) || submitting}
            onClick={() => {
              if (missing) setAttention((a) => ({ target: missing, n: (a?.n ?? 0) + 1 }));
              else if (valid) void submit(draft);
            }}
          >
            {submitting ? (
              <>
                <Spinner size={20} light /> Confirmando entrega…
              </>
            ) : missing === "signature" ? (
              "Firme para terminar"
            ) : missing === "answer" ? (
              "Responda la pregunta 1"
            ) : (
              "Confirmar entrega"
            )}
          </button>
        ) : (
          <button
            type="button"
            className={`btn btn-primary btn-lg ${styles.next}`}
            disabled={!valid}
            onClick={() => goTo(stepIndex + 1)}
          >
            {step.key === "review" ? "Pasar al cliente" : "Siguiente"}
          </button>
        )}
      </footer>
    </div>
  );
}

export type { StepKey };
