import { useEffect, useId, useState } from "react";
import {
  MIN_SEARCH_LENGTH,
  resolvePlace,
  searchPlaces,
  type Place,
  type SearchBounds,
} from "../lib/geocode";
import styles from "./AddressSearch.module.css";
import { PinIcon } from "./Icons";
import { Spinner } from "./Spinner";

// Long enough not to search on every key, short enough to feel immediate.
const TYPING_PAUSE_MS = 300;

/**
 * Why Google didn't answer. With a connection, it's almost always the key:
 * the map can work while the address search is refused, because they are two
 * separate services in Google Cloud.
 */
const failureReason = () =>
  navigator.onLine
    ? "Google no aceptó la búsqueda. Revisa en Google Cloud que Places API (New) esté habilitada en el proyecto y permitida en la llave (el cambio tarda unos minutos). Mientras tanto, marca el punto en el mapa."
    : "Sin conexión. Revisa tu internet o marca el punto en el mapa.";

/** The suggestion the office chose, with where it is. */
export type FoundPlace = { name: string; location: { lat: number; lng: number } };

/** A search box that suggests addresses and places while typing; picking one calls `onSelect`. */
export function AddressSearch({
  onSelect,
  autoFocus,
  bounds,
  placeholder = "Escribe la dirección o el nombre del lugar",
}: {
  onSelect: (place: FoundPlace) => void;
  autoFocus?: boolean;
  /** The company's service area, if it has one: nothing outside it is suggested. */
  bounds?: SearchBounds | null;
  placeholder?: string;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  // null: nothing searched yet (too short, or still waiting for the first answer).
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [state, setState] = useState<"idle" | "searching" | "failed">("idle");
  // Looking up where the chosen suggestion is.
  const [locating, setLocating] = useState<"no" | "yes" | "failed">("no");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const text = query.trim();
  const searchable = text.length >= MIN_SEARCH_LENGTH;

  useEffect(() => {
    if (!searchable) {
      setPlaces(null);
      setState("idle");
      return;
    }
    setState("searching");
    // Set when the office keeps typing: this answer is then out of date.
    let stale = false;
    const timer = setTimeout(() => {
      searchPlaces(text, bounds)
        .then((found) => {
          if (stale) return;
          setPlaces(found);
          setActive(0);
          setState("idle");
        })
        .catch(() => {
          if (!stale) setState("failed");
        });
    }, TYPING_PAUSE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [text, searchable, bounds]);

  async function select(place: Place) {
    setOpen(false);
    setLocating("yes");
    try {
      const location = await resolvePlace(place);
      setQuery("");
      setLocating("no");
      onSelect({ name: place.name, location });
    } catch {
      setLocating("failed");
    }
  }

  const showList = open && searchable && locating !== "yes";

  return (
    <div className={styles.root}>
      <input
        className="input"
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Buscar dirección o lugar"
        placeholder={placeholder}
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={locating === "yes"}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLocating("no");
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
          } else if (places?.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActive((i) => (i + step + places.length) % places.length);
          } else if (e.key === "Enter" && showList && places?.[active]) {
            e.preventDefault();
            void select(places[active]);
          }
        }}
      />
      {(state === "searching" || locating === "yes") && (
        <span className={styles.searching}>
          <Spinner size={18} />
        </span>
      )}
      {locating === "failed" && (
        <p className="error-text">No se pudo ubicar ese lugar. {failureReason()}</p>
      )}

      {showList && (
        <ul id={listId} className={styles.list} role="listbox">
          {places?.map((place, i) => (
            <li key={place.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                tabIndex={-1}
                className={`${styles.option} ${i === active ? styles.active : ""}`}
                // Keeps the focus in the box, so the list doesn't close before the click.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => void select(place)}
              >
                <PinIcon size={18} />
                <span>
                  <strong>{place.name}</strong>
                  {place.detail && <small>{place.detail}</small>}
                </span>
              </button>
            </li>
          ))}
          {state === "failed" ? (
            <li className={styles.note}>{failureReason()}</li>
          ) : places === null ? (
            <li className={styles.note}>Buscando…</li>
          ) : (
            places.length === 0 &&
            state === "idle" && (
              <li className={styles.note}>
                No se encontró. Prueba con la calle y el número, o marca el punto en el mapa.
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}
