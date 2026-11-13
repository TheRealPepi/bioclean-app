import { useQuery } from "convex/react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
import { distanceMeters, SAME_PLACE_METERS } from "../../../convex/lib/geo";
import { cleanInvoice } from "../../../convex/lib/text";
import { AlertIcon, CheckIcon, PinIcon, PlusIcon } from "../../components/Icons";
import { PaymentBadge } from "../../components/PaymentBadge";
import { PhotoCapture } from "../../components/PhotoCapture";
import { Spinner } from "../../components/Spinner";
import { StatusBadge } from "../../components/StatusBadge";
import { formatShort } from "../../lib/dates";
import type { Draft, DraftInvoice, LatLng } from "../../lib/draft";
import { osmEmbedUrl } from "../../lib/maps";
import { itemInvoices } from "../../lib/outbox";
import { useOutbox } from "../../lib/OutboxProvider";
import { LOCATION_SOURCE_LABEL } from "../../lib/payment";
import { useObjectUrl } from "../../lib/useObjectUrl";
import { useOnline } from "../../lib/useOnline";
import type { Vehicle } from "../../lib/useVehicleList";
import type { StepKey } from "./NewDeliveryWizard";
import styles from "./steps.module.css";

// ---------------------------------------------------------------- Vehículo

export function VehicleStep({
  vehicles,
  value,
  onChange,
}: {
  vehicles: Vehicle[] | undefined;
  value: string | undefined;
  onChange: (vehicle: Vehicle) => void;
}) {
  const online = useOnline();

  if (vehicles === undefined) {
    return online ? (
      <div className={styles.centered}>
        <Spinner size={28} />
      </div>
    ) : (
      <p className={styles.warning}>
        <AlertIcon size={18} />
        <span>
          Sin señal: la lista de vehículos aún no se ha descargado en este teléfono. Puedes
          continuar sin elegir vehículo.
        </span>
      </p>
    );
  }
  if (vehicles.length === 0) {
    return (
      <p className={styles.info}>
        El administrador aún no ha agregado vehículos. Puedes continuar.
      </p>
    );
  }
  return (
    <div className={styles.choices} role="radiogroup" aria-label="Vehículo">
      {vehicles.map((vehicle) => {
        const selected = vehicle._id === value;
        return (
          <button
            key={vehicle._id}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`${styles.choice} ${selected ? styles.choiceSelected : ""}`}
            onClick={() => onChange(vehicle)}
          >
            <span>{vehicle.name}</span>
            {selected && <CheckIcon size={20} />}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Facturas

/** Warns (doesn't block) when a factura number was already registered. */
function InvoiceDuplicateWarning({ number }: { number: string }) {
  const invoice = cleanInvoice(number);
  const onServer = useQuery(
    api.deliveries.findByInvoice,
    invoice ? { invoiceNumber: invoice } : "skip",
  );
  // Also deliveries saved on this phone and not uploaded yet (no signal).
  const waiting = useOutbox()?.items.find(
    (item) => invoice && itemInvoices(item).some((i) => cleanInvoice(i.number) === invoice),
  );
  const existing =
    onServer ?? (waiting && { clientName: waiting.clientName, createdAt: waiting.deliveredAt });
  if (!existing) return null;
  return (
    <p className={styles.warning}>
      <AlertIcon size={18} />
      <span>
        Esta factura ya se registró el {formatShort(existing.createdAt)} para{" "}
        <strong>{existing.clientName}</strong>. Revisa que el número sea correcto.
      </span>
    </p>
  );
}

export function InvoicesStep({
  value,
  onChange,
}: {
  value: DraftInvoice[];
  onChange: (invoices: DraftInvoice[]) => void;
}) {
  const update = (index: number, changes: Partial<DraftInvoice>) =>
    onChange(value.map((inv, i) => (i === index ? { ...inv, ...changes } : inv)));

  const lastComplete = value.every((i) => cleanInvoice(i.number) && i.photo);

  return (
    <div className={styles.stack}>
      {value.map((invoice, index) => {
        const number = cleanInvoice(invoice.number);
        const repeated =
          number !== "" && value.some((other, j) => j < index && cleanInvoice(other.number) === number);
        return (
          <section key={index} className={`card ${styles.invoiceCard}`}>
            <div className={styles.invoiceHeader}>
              <strong>Factura {index + 1}</strong>
              {value.length > 1 && (
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => onChange(value.filter((_, i) => i !== index))}
                >
                  Quitar
                </button>
              )}
            </div>
            <input
              className={`input ${styles.bigInput}`}
              value={invoice.number}
              onChange={(e) => update(index, { number: e.target.value })}
              placeholder="Número, ej. B-10237"
              aria-label={`Número de la factura ${index + 1}`}
              autoCapitalize="characters"
              autoComplete="off"
              enterKeyHint="done"
              autoFocus={index === value.length - 1 && !invoice.number}
            />
            {repeated ? (
              <p className="error-text">Este número ya está en otra factura de esta entrega.</p>
            ) : (
              <InvoiceDuplicateWarning number={invoice.number} />
            )}
            <PhotoCapture
              compact
              alt={`Foto de la factura ${index + 1}`}
              value={invoice.photo}
              onChange={(photo) => update(index, { photo })}
            />
          </section>
        );
      })}
      <button
        type="button"
        className="btn btn-ghost btn-lg"
        onClick={() => onChange([...value, { number: "" }])}
        disabled={!lastComplete}
      >
        <PlusIcon size={20} /> Agregar otra factura
      </button>
      {!lastComplete && value.length > 0 && (
        <p className={styles.hintSmall}>
          Completa el número y la foto de cada factura para agregar otra.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Ubicación

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

function getPosition(maximumAge: number): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext || !("geolocation" in navigator)) {
      reject(new Error("Este navegador no permite obtener la ubicación (se requiere HTTPS)."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => reject(new Error(geolocationError(err))),
      // Without mobile data the first GPS fix can take a while.
      { enableHighAccuracy: true, timeout: 45000, maximumAge },
    );
  });
}

function MapPreview({ point, title }: { point: LatLng; title: string }) {
  const online = useOnline();
  return (
    <>
      {online ? (
        <iframe className={styles.map} title={title} src={osmEmbedUrl(point)} />
      ) : (
        <div className={`${styles.map} ${styles.mapOffline}`}>
          <PinIcon size={28} />
          <span>El mapa aparecerá cuando haya señal.</span>
        </div>
      )}
      <div className={styles.locationInfo}>
        <span>
          {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
        </span>
        {point.accuracy !== undefined && <span>Precisión ±{Math.round(point.accuracy)} m</span>}
      </div>
      {point.accuracy !== undefined && point.accuracy > 100 && (
        <p className={styles.warning}>
          <AlertIcon size={18} />
          <span>La precisión es baja. Si puedes, sal al aire libre y actualiza.</span>
        </p>
      )}
    </>
  );
}

type LocationValue = Pick<Draft, "location" | "locationSource" | "driverPosition">;

export function LocationStep({
  saved,
  value,
  onChange,
  onDriverPosition,
  onContinue,
}: {
  /** The client's saved location, if it has one. */
  saved: LatLng | null;
  value: LocationValue;
  onChange: (changes: LocationValue) => void;
  /** Background GPS position taken while the client's saved location is in use. */
  onDriverPosition: (position: LatLng) => void;
  onContinue: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [atSaved, setAtSaved] = useState(false);

  // Quietly record where the driver is, as proof; never blocks or shows errors.
  const hasDriverPosition = value.driverPosition !== undefined;
  useEffect(() => {
    if (!saved || hasDriverPosition) return;
    getPosition(60_000).then(onDriverPosition, () => {});
    // Once per visit to this step.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function capture() {
    setBusy(true);
    setError(null);
    setAtSaved(false);
    try {
      const point = await getPosition(0);
      if (!saved) {
        onChange({ location: point, locationSource: "nueva", driverPosition: undefined });
      } else if (distanceMeters(saved, point) <= SAME_PLACE_METERS) {
        // Same place: keep the saved location, with this point as proof.
        onChange({ location: saved, locationSource: "guardada", driverPosition: point });
        setAtSaved(true);
      } else {
        onChange({ location: point, locationSource: "modificada", driverPosition: undefined });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const errorText = error && <p className="error-text">{error}</p>;

  // The client has no saved location yet: capture it, as before.
  if (!saved) {
    return (
      <div className={styles.stack}>
        <p className={styles.info}>
          Este cliente aún no tiene ubicación guardada. Guárdala estando en el lugar de la entrega;
          se usará en las próximas entregas.
        </p>
        {value.location ? (
          <>
            <MapPreview point={value.location} title="Ubicación guardada" />
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
        {errorText}
      </div>
    );
  }

  if (value.locationSource === "modificada" && value.location) {
    return (
      <div className={styles.stack}>
        <p className={styles.warning}>
          <AlertIcon size={18} />
          <span>
            Ubicación modificada solo para esta entrega · a{" "}
            {Math.round(distanceMeters(saved, value.location))} m de la ubicación guardada del
            cliente.
          </span>
        </p>
        <MapPreview point={value.location} title="Ubicación de esta entrega" />
        <button type="button" className="btn btn-ghost btn-lg" onClick={capture} disabled={busy}>
          {busy ? <Spinner size={20} /> : <PinIcon size={20} />}
          Actualizar ubicación
        </button>
        <button
          type="button"
          className={styles.linkButton}
          onClick={() =>
            onChange({ location: saved, locationSource: "guardada", driverPosition: undefined })
          }
          disabled={busy}
        >
          Usar la ubicación guardada del cliente
        </button>
        {errorText}
      </div>
    );
  }

  const confirmed = value.locationSource === "guardada";
  return (
    <div className={styles.stack}>
      <MapPreview point={saved} title="Ubicación guardada del cliente" />
      {atSaved && (
        <p className={styles.info}>
          <CheckIcon size={18} /> Estás en la ubicación guardada del cliente.
        </p>
      )}
      <button
        type="button"
        className="btn btn-primary btn-lg"
        disabled={busy}
        onClick={() => {
          if (!confirmed) onChange({ ...value, location: saved, locationSource: "guardada" });
          onContinue();
        }}
      >
        {confirmed && <CheckIcon size={20} />}
        Continuar con esta ubicación
      </button>
      <button type="button" className="btn btn-ghost btn-lg" onClick={capture} disabled={busy}>
        {busy ? <Spinner size={20} /> : <PinIcon size={20} />}
        {busy ? "Obteniendo ubicación…" : "Modificar ubicación para esta entrega"}
      </button>
      {errorText}
    </div>
  );
}

// ---------------------------------------------------------------- Revisión

function Thumb({ blob, label }: { blob: Blob | undefined; label: string }) {
  const url = useObjectUrl(blob);
  return (
    <figure className={styles.thumb}>
      {url ? <img src={url} alt={label} /> : <div />}
      <figcaption>{label}</figcaption>
    </figure>
  );
}

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

export function ReviewStep({
  draft,
  showVehicle,
  onEdit,
}: {
  draft: Draft;
  showVehicle: boolean;
  onEdit: (key: StepKey) => void;
}) {
  return (
    <div className={`card ${styles.review}`}>
      <ReviewRow label="Cliente" onEdit={() => onEdit("client")}>
        <strong>{draft.clientName}</strong>
        {!draft.clientId && <span className={styles.newTag}>Nuevo</span>}
      </ReviewRow>
      {showVehicle && (
        <ReviewRow label="Vehículo" onEdit={() => onEdit("vehicle")}>
          {draft.vehicleName ?? "Sin vehículo"}
        </ReviewRow>
      )}
      <ReviewRow
        label={draft.invoices.length === 1 ? "Factura" : `Facturas (${draft.invoices.length})`}
        onEdit={() => onEdit("invoices")}
      >
        <div className={styles.thumbs}>
          {draft.invoices.map((invoice, i) => (
            <Thumb key={i} blob={invoice.photo} label={cleanInvoice(invoice.number)} />
          ))}
        </div>
      </ReviewRow>
      <ReviewRow label="Fotos" onEdit={() => onEdit("receiverPhoto")}>
        <div className={styles.thumbs}>
          <Thumb blob={draft.photos.receiver} label="Quien recibe" />
          <Thumb blob={draft.photos.goods} label="Mercancía" />
        </div>
      </ReviewRow>
      <ReviewRow label="Ubicación" onEdit={() => onEdit("location")}>
        {draft.location ? (
          <div className={styles.reviewStacked}>
            {draft.locationSource && <span>{LOCATION_SOURCE_LABEL[draft.locationSource]}</span>}
            <span className={styles.muted}>
              {draft.location.lat.toFixed(5)}, {draft.location.lng.toFixed(5)}
            </span>
          </div>
        ) : (
          "—"
        )}
      </ReviewRow>
      <ReviewRow label="Estatus" onEdit={() => onEdit("status")}>
        {draft.status ? <StatusBadge status={draft.status} /> : "—"}
      </ReviewRow>
      <ReviewRow label="Pago" onEdit={() => onEdit("payment")}>
        {draft.payment ? <PaymentBadge payment={draft.payment} /> : "—"}
      </ReviewRow>
      <ReviewRow label="Anotaciones" onEdit={() => onEdit("notes")}>
        <span className={styles.notes}>{draft.notes.trim() || "Sin anotaciones"}</span>
      </ReviewRow>
    </div>
  );
}
