import { useQuery } from "convex/react";
import { useState, type ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
import { cleanInvoice } from "../../../convex/lib/text";
import { AlertIcon, PinIcon } from "../../components/Icons";
import { Spinner } from "../../components/Spinner";
import { StatusBadge } from "../../components/StatusBadge";
import { formatShort } from "../../lib/dates";
import type { Draft, PhotoKey } from "../../lib/draft";
import { osmEmbedUrl } from "../../lib/maps";
import { useObjectUrl } from "../../lib/useObjectUrl";
import type { StepKey } from "./NewDeliveryWizard";
import styles from "./steps.module.css";

export function InvoiceStep({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const invoice = cleanInvoice(value);
  const existing = useQuery(api.deliveries.findByInvoice, invoice ? { invoiceNumber: invoice } : "skip");

  return (
    <form
      className={styles.stack}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <input
        className={`input ${styles.bigInput}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ej. B-10237"
        autoCapitalize="characters"
        autoComplete="off"
        enterKeyHint="next"
        autoFocus
      />
      {existing && (
        <p className={styles.warning}>
          <AlertIcon size={18} />
          <span>
            Esta factura ya se registró el {formatShort(existing.createdAt)} para{" "}
            <strong>{existing.clientName}</strong>. Revisa que el número sea correcto.
          </span>
        </p>
      )}
    </form>
  );
}

type Location = NonNullable<Draft["location"]>;

function geolocationError(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "Permite el acceso a tu ubicación en el navegador (configuración del sitio) y vuelve a intentar.";
    case error.POSITION_UNAVAILABLE:
      return "No se pudo obtener la ubicación. Revisa que el GPS esté encendido.";
    default:
      return "Tardó demasiado en obtener la ubicación. Inténtalo de nuevo.";
  }
}

export function LocationStep({
  value,
  onChange,
}: {
  value: Location | undefined;
  onChange: (location: Location) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function capture() {
    if (!window.isSecureContext || !("geolocation" in navigator)) {
      setError("Este navegador no permite obtener la ubicación (se requiere HTTPS).");
      return;
    }
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setBusy(false);
      },
      (err) => {
        setError(geolocationError(err));
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  return (
    <div className={styles.stack}>
      {value ? (
        <>
          <iframe className={styles.map} title="Ubicación guardada" src={osmEmbedUrl(value)} />
          <div className={styles.locationInfo}>
            <span>
              {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
            </span>
            {value.accuracy !== undefined && <span>Precisión ±{Math.round(value.accuracy)} m</span>}
          </div>
          {value.accuracy !== undefined && value.accuracy > 100 && (
            <p className={styles.warning}>
              <AlertIcon size={18} />
              <span>La precisión es baja. Si puedes, sal al aire libre y actualiza.</span>
            </p>
          )}
          <button type="button" className="btn btn-ghost btn-lg" onClick={capture} disabled={busy}>
            {busy ? <Spinner size={20} /> : <PinIcon size={20} />}
            Actualizar ubicación
          </button>
        </>
      ) : (
        <button type="button" className={styles.bigAction} onClick={capture} disabled={busy}>
          {busy ? <Spinner size={40} /> : <PinIcon size={44} />}
          <span>{busy ? "Obteniendo ubicación…" : "Guardar ubicación"}</span>
        </button>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function Thumb({ blob, label }: { blob: Blob | undefined; label: string }) {
  const url = useObjectUrl(blob);
  return (
    <figure className={styles.thumb}>
      {url ? <img src={url} alt={label} /> : <div />}
      <figcaption>{label}</figcaption>
    </figure>
  );
}

const PHOTO_LABELS: [PhotoKey, string][] = [
  ["invoice", "Factura"],
  ["receiver", "Quien recibe"],
  ["goods", "Mercancía"],
];

function ReviewRow({
  label,
  onEdit,
  children,
}: {
  label: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <div className={styles.reviewRow}>
      <div className={styles.reviewLabel}>
        <span>{label}</span>
        <button type="button" onClick={onEdit}>
          Editar
        </button>
      </div>
      <div className={styles.reviewValue}>{children}</div>
    </div>
  );
}

export function ReviewStep({ draft, onEdit }: { draft: Draft; onEdit: (key: StepKey) => void }) {
  return (
    <div className={`card ${styles.review}`}>
      <ReviewRow label="Cliente" onEdit={() => onEdit("client")}>
        <strong>{draft.clientName}</strong>
        {!draft.clientId && <span className={styles.newTag}>Nuevo</span>}
      </ReviewRow>
      <ReviewRow label="Factura" onEdit={() => onEdit("invoice")}>
        {cleanInvoice(draft.invoiceNumber)}
      </ReviewRow>
      <ReviewRow label="Fotos" onEdit={() => onEdit("invoicePhoto")}>
        <div className={styles.thumbs}>
          {PHOTO_LABELS.map(([key, label]) => (
            <Thumb key={key} blob={draft.photos[key]} label={label} />
          ))}
        </div>
      </ReviewRow>
      <ReviewRow label="Ubicación" onEdit={() => onEdit("location")}>
        {draft.location
          ? `${draft.location.lat.toFixed(5)}, ${draft.location.lng.toFixed(5)}`
          : "—"}
      </ReviewRow>
      <ReviewRow label="Estatus" onEdit={() => onEdit("status")}>
        {draft.status ? <StatusBadge status={draft.status} /> : "—"}
      </ReviewRow>
      <ReviewRow label="Anotaciones" onEdit={() => onEdit("notes")}>
        <span className={styles.notes}>{draft.notes.trim() || "Sin anotaciones"}</span>
      </ReviewRow>
    </div>
  );
}
