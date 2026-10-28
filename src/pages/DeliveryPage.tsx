import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import {
  ChevronLeftIcon,
  CloseIcon,
  DownloadIcon,
  ExternalIcon,
} from "../components/Icons";
import { CenteredSpinner, Spinner } from "../components/Spinner";
import { StatusBadge } from "../components/StatusBadge";
import { formatLongDate, formatTime } from "../lib/dates";
import { googleMapsUrl, osmEmbedUrl } from "../lib/maps";
import { downloadDeliveryPdf, type DeliveryDetails } from "../lib/pdf";
import styles from "./DeliveryPage.module.css";

export function DeliveryPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const backTo = (location.state as { from?: string } | null)?.from ?? "/";
  const delivery = useQuery(api.deliveries.get, { id });
  const [lightbox, setLightbox] = useState<{ url: string; caption: string } | null>(null);

  const back = (
    <Link to={backTo} className={styles.back}>
      <ChevronLeftIcon size={18} /> Volver
    </Link>
  );

  if (delivery === undefined) return <CenteredSpinner />;
  if (delivery === null) {
    return (
      <div className={styles.page}>
        {back}
        <div className={`card ${styles.missing}`}>No se encontró esta entrega.</div>
      </div>
    );
  }

  const photos = [
    { caption: "Factura", url: delivery.photos.invoice },
    { caption: "Quien recibe", url: delivery.photos.receiver },
    { caption: "Mercancía", url: delivery.photos.goods },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        {back}
        <PdfButton delivery={delivery} />
      </div>

      <section className={`card ${styles.hero}`}>
        <div>
          <div className={styles.eyebrow}>Factura {delivery.invoiceNumber}</div>
          <h1 className={styles.client}>{delivery.clientName}</h1>
          <div className={styles.meta}>
            <span>{formatLongDate(delivery._creationTime)}</span>
            <span>{formatTime(delivery._creationTime)}</span>
            <span>Chofer: {delivery.driverName}</span>
          </div>
        </div>
        <StatusBadge status={delivery.status} large />
      </section>

      <div className={styles.grid}>
        <section className={`card ${styles.section}`}>
          <h2 className={styles.sectionTitle}>Anotaciones</h2>
          <p className={delivery.notes ? styles.notes : styles.empty}>
            {delivery.notes || "Sin anotaciones."}
          </p>
        </section>

        <section className={`card ${styles.section}`}>
          <h2 className={styles.sectionTitle}>Ubicación de entrega</h2>
          <iframe
            className={styles.map}
            title="Mapa de la ubicación de entrega"
            src={osmEmbedUrl(delivery.location)}
            loading="lazy"
          />
          <div className={styles.mapFooter}>
            <a href={googleMapsUrl(delivery.location)} target="_blank" rel="noreferrer">
              Abrir en Google Maps <ExternalIcon size={14} />
            </a>
            {delivery.location.accuracy !== undefined && (
              <span className={styles.accuracy}>
                Precisión ±{Math.round(delivery.location.accuracy)} m
              </span>
            )}
          </div>
        </section>
      </div>

      <section className={`card ${styles.section}`}>
        <h2 className={styles.sectionTitle}>Fotos</h2>
        <div className={styles.photos}>
          {photos.map(({ caption, url }) => (
            <figure key={caption} className={styles.photo}>
              {url ? (
                <button type="button" onClick={() => setLightbox({ url, caption })}>
                  <img src={url} alt={caption} loading="lazy" />
                </button>
              ) : (
                <div className={styles.photoMissing}>No disponible</div>
              )}
              <figcaption>{caption}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      {lightbox && <Lightbox {...lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function PdfButton({ delivery }: { delivery: DeliveryDetails }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  return (
    <div className={styles.pdf}>
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(false);
          try {
            await downloadDeliveryPdf(delivery);
          } catch {
            setError(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner size={18} light /> : <DownloadIcon size={18} />}
        {busy ? "Generando PDF…" : "Descargar PDF"}
      </button>
      {error && <span className="error-text">No se pudo generar el PDF.</span>}
    </div>
  );
}

function Lightbox({ url, caption, onClose }: { url: string; caption: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={styles.lightbox} role="dialog" aria-label={caption} onClick={onClose}>
      <button type="button" className={styles.lightboxClose} aria-label="Cerrar" onClick={onClose}>
        <CloseIcon size={24} />
      </button>
      <img src={url} alt={caption} onClick={(e) => e.stopPropagation()} />
      <div className={styles.lightboxCaption}>
        {caption} ·{" "}
        <a href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          Abrir original
        </a>
      </div>
    </div>
  );
}
