import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cleanInvoice } from "../../../convex/lib/text";
import { ClientCombobox } from "../../components/ClientCombobox";
import { CloseIcon } from "../../components/Icons";
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
import { errorMessage } from "../../lib/errors";
import type { Me } from "../../lib/me";
import { InvoiceStep, LocationStep, ReviewStep } from "./steps";
import styles from "./NewDeliveryWizard.module.css";

type StepKey =
  | "client"
  | "invoice"
  | "invoicePhoto"
  | "receiverPhoto"
  | "goodsPhoto"
  | "location"
  | "status"
  | "notes"
  | "review";

const STEPS: { key: StepKey; title: string; hint?: string }[] = [
  { key: "client", title: "Cliente", hint: "Elige el cliente de la lista o escribe uno nuevo." },
  { key: "invoice", title: "Número de factura" },
  {
    key: "invoicePhoto",
    title: "Foto de la factura",
    hint: "Que se lean el número de factura y la firma.",
  },
  { key: "receiverPhoto", title: "Foto de quien recibe", hint: "La persona que recibe la mercancía." },
  { key: "goodsPhoto", title: "Foto de la mercancía", hint: "La mercancía entregada." },
  {
    key: "location",
    title: "Ubicación de entrega",
    hint: "Guárdala estando en el lugar de la entrega.",
  },
  { key: "status", title: "Estatus de la entrega" },
  { key: "notes", title: "Anotaciones" },
  { key: "review", title: "Revisa y guarda" },
];

const PHOTO_STEPS: Partial<Record<StepKey, PhotoKey>> = {
  invoicePhoto: "invoice",
  receiverPhoto: "receiver",
  goodsPhoto: "goods",
};

function isStepValid(key: StepKey, d: Draft): boolean {
  switch (key) {
    case "client":
      return d.clientName.trim() !== "";
    case "invoice":
      return cleanInvoice(d.invoiceNumber) !== "";
    case "invoicePhoto":
    case "receiverPhoto":
    case "goodsPhoto":
      return d.photos[PHOTO_STEPS[key]!] !== undefined;
    case "location":
      return d.location !== undefined;
    case "status":
      return d.status !== undefined;
    case "notes":
      return d.status === "exitosa" || d.notes.trim() !== "";
    case "review":
      return STEPS.slice(0, -1).every((s) => isStepValid(s.key, d));
  }
}

export function NewDeliveryWizard({ me }: { me: Me }) {
  const navigate = useNavigate();
  const clients = useQuery(api.clients.list);
  const generateUploadUrl = useMutation(api.deliveries.generateUploadUrl);
  const createDelivery = useMutation(api.deliveries.create);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Photos already uploaded in this session, so a retry doesn't upload them again.
  const uploaded = useRef(new Map<Blob, Id<"_storage">>());

  useEffect(() => {
    void loadDraft(me._id).then((saved) => setDraft(saved ?? emptyDraft()));
  }, [me._id]);

  useEffect(() => {
    if (draft && draftHasContent(draft)) void saveDraft(me._id, draft);
  }, [draft, me._id]);

  if (!draft) return <FullScreenSpinner />;

  const stepIndex = Math.min(draft.step, STEPS.length - 1);
  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const valid = isStepValid(step.key, draft);

  const patch = (changes: Partial<Draft>) =>
    setDraft((d) => d && { ...d, ...changes, updatedAt: Date.now() });

  const goTo = (index: number) => {
    setError(null);
    patch({ step: index });
    window.scrollTo(0, 0);
  };

  async function upload(photo: Blob): Promise<Id<"_storage">> {
    const cached = uploaded.current.get(photo);
    if (cached) return cached;
    const url = await generateUploadUrl();
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": photo.type || "image/jpeg" },
      body: photo,
    });
    if (!response.ok) throw new Error("Upload failed");
    const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
    uploaded.current.set(photo, storageId);
    return storageId;
  }

  async function submit(d: Draft) {
    setError(null);
    try {
      const keys: PhotoKey[] = ["invoice", "receiver", "goods"];
      const ids: Id<"_storage">[] = [];
      for (const [i, key] of keys.entries()) {
        setSubmitting(`Subiendo fotos (${i + 1} de 3)…`);
        ids.push(await upload(d.photos[key]!));
      }
      setSubmitting("Guardando entrega…");
      await createDelivery({
        clientId: d.clientId,
        clientName: d.clientName,
        invoiceNumber: d.invoiceNumber,
        invoicePhotoId: ids[0],
        receiverPhotoId: ids[1],
        goodsPhotoId: ids[2],
        location: d.location!,
        status: d.status!,
        notes: d.notes,
      });
      await clearDraft(me._id);
      navigate("/", { replace: true, state: { saved: d.clientName } });
    } catch (e) {
      setError(errorMessage(e));
      setSubmitting(null);
    }
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
        {step.key === "notes" ? (
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
            clients={clients}
            value={{ clientId: draft.clientId, clientName: draft.clientName }}
            onChange={(v) => patch({ clientId: v.clientId, clientName: v.clientName })}
          />
        )}

        {step.key === "invoice" && (
          <InvoiceStep
            value={draft.invoiceNumber}
            onChange={(invoiceNumber) => patch({ invoiceNumber })}
            onSubmit={() => valid && goTo(stepIndex + 1)}
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
          <LocationStep value={draft.location} onChange={(location) => patch({ location })} />
        )}

        {step.key === "status" && (
          <StatusSelect value={draft.status} onChange={(status) => patch({ status })} />
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
            disabled={submitting !== null}
          >
            Atrás
          </button>
        )}
        {isLast ? (
          <button
            type="button"
            className={`btn btn-primary btn-lg ${styles.next}`}
            disabled={!valid || submitting !== null}
            onClick={() => void submit(draft)}
          >
            {submitting ? (
              <>
                <Spinner size={20} light /> {submitting}
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
