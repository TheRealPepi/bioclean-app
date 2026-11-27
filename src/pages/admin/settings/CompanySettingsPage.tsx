import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { boundsAround, sizeKm } from "../../../../convex/lib/geo";
import { AddressSearch } from "../../../components/AddressSearch";
import { CenteredSpinner } from "../../../components/Spinner";
import { TimeZoneSelect } from "../../../components/TimeZoneSelect";
import { errorMessage } from "../../../lib/errors";
import { googleMapsUrl } from "../../../lib/maps";
import styles from "./Settings.module.css";

type Company = FunctionReturnType<typeof api.companies.get>;
type ServiceArea = NonNullable<Company["serviceArea"]>;

/** How far from the chosen place the company delivers, in km. */
const RADII = [5, 10, 25, 50, 100, 250];
const DEFAULT_RADIUS = 25;

export function CompanySettingsPage() {
  const company = useQuery(api.companies.get);
  if (company === undefined) return <CenteredSpinner />;
  return <CompanyForm company={company} />;
}

/** The form starts from what was saved when the page opened. */
function CompanyForm({ company }: { company: Company }) {
  const update = useMutation(api.companies.update);
  const [name, setName] = useState(company.name);
  const [tagline, setTagline] = useState(company.tagline);
  const [timeZone, setTimeZone] = useState(company.timeZone);
  const [phoneCountryCode, setPhoneCountryCode] = useState(company.phoneCountryCode);
  // undefined: not touched, so saving leaves the area as it is.
  const [area, setArea] = useState<ServiceArea | null | undefined>(undefined);
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shownArea = area === undefined ? company.serviceArea : area;
  const size = shownArea && sizeKm(shownArea.bounds);
  const edited = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setSaved(false);
  };

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await update({
        name,
        tagline,
        timeZone,
        phoneCountryCode,
        ...(area === undefined ? {} : { serviceArea: area }),
      });
      setArea(undefined);
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className={styles.stack}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <section className={`card ${styles.panel}`}>
        <h2>Empresa</h2>
        <label>
          <span className="label">Nombre</span>
          <input
            className="input"
            value={name}
            maxLength={80}
            onChange={(e) => edited(setName)(e.target.value)}
          />
          <span className={styles.fieldHint}>
            Aparece en la app, en los comprobantes en PDF y en los recordatorios de pago.
          </span>
        </label>
        <label>
          <span className="label">Lema (opcional)</span>
          <input
            className="input"
            value={tagline}
            maxLength={120}
            placeholder="Por ejemplo: Servicio integral para su negocio"
            onChange={(e) => edited(setTagline)(e.target.value)}
          />
          <span className={styles.fieldHint}>
            Una línea bajo el nombre en los correos de recordatorio.
          </span>
        </label>
        <div className={styles.columns}>
          <label>
            <span className="label">Zona horaria</span>
            <TimeZoneSelect value={timeZone} onChange={edited(setTimeZone)} />
          </label>
          <label>
            <span className="label">Clave de país de los teléfonos</span>
            <input
              className="input"
              inputMode="numeric"
              value={phoneCountryCode}
              onChange={(e) => edited(setPhoneCountryCode)(e.target.value)}
            />
          </label>
        </div>
        {timeZone !== company.timeZone && (
          <p className={styles.warning}>
            Los días y las fechas límite de pago se cuentan en la zona horaria de la empresa. Al
            cambiarla, las entregas hechas cerca de la medianoche pueden pasar al día anterior o al
            siguiente.
          </p>
        )}
      </section>

      <section className={`card ${styles.panel}`}>
        <h2>Zona de servicio</h2>
        <p className={styles.hint}>
          Al armar rutas, la búsqueda de direcciones solo sugiere lugares dentro de esta zona y el
          mapa abre ahí. Sin zona, se busca en todo el país.
        </p>
        {shownArea && size ? (
          <div className={styles.value}>
            Unos {Math.round(size.width)} × {Math.round(size.height)} km alrededor de{" "}
            <a href={googleMapsUrl(shownArea.center)} target="_blank" rel="noreferrer">
              este punto
            </a>
            {area !== undefined && " (sin guardar)"}.
          </div>
        ) : (
          <div className={styles.value}>
            Sin zona de servicio{area === null && company.serviceArea ? " (sin guardar)" : ""}.
          </div>
        )}
        <div className={styles.row}>
          <AddressSearch
            placeholder="Busca la ciudad o la zona donde entregan"
            onSelect={(place) =>
              edited(setArea)({
                center: place.location,
                bounds: boundsAround(place.location, radius),
              })
            }
          />
          <select
            className={`input ${styles.radius}`}
            aria-label="Hasta qué distancia entregan"
            value={radius}
            onChange={(e) => {
              const km = Number(e.target.value);
              setRadius(km);
              // Only resizes an area chosen just now: a saved one keeps its exact shape.
              if (area) edited(setArea)({ center: area.center, bounds: boundsAround(area.center, km) });
            }}
          >
            {RADII.map((km) => (
              <option key={km} value={km}>
                Hasta {km} km
              </option>
            ))}
          </select>
          {shownArea && (
            <button type="button" className="btn btn-ghost" onClick={() => edited(setArea)(null)}>
              Quitar zona
            </button>
          )}
        </div>
      </section>

      <div className={styles.footer}>
        <button type="submit" className="btn btn-primary" disabled={saving || name.trim().length < 2}>
          {saving ? "Guardando…" : "Guardar cambios"}
        </button>
        {saved && <span className={styles.ok}>Guardado</span>}
        {error && <span className="error-text">{error}</span>}
      </div>
    </form>
  );
}
