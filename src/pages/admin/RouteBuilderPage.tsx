import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MAX_ROUTE_STOPS } from "../../../convex/lib/routes";
import { normalizeKey } from "../../../convex/lib/text";
import { AddressSearch, type FoundPlace } from "../../components/AddressSearch";
import { ChevronDownIcon, ChevronLeftIcon, CloseIcon, PinIcon } from "../../components/Icons";
import { RouteMap, type MapClient } from "../../components/RouteMap";
import { CenteredSpinner, Spinner } from "../../components/Spinner";
import { HelpTip } from "../../components/Tooltip";
import { formatDay } from "../../lib/dates";
import { errorMessage } from "../../lib/errors";
import { googleMapsKey } from "../../lib/googleMaps";
import { MAPS_STOPS_PER_LINK } from "../../lib/maps";
import { optimizeStops, routeLengthMeters } from "../../lib/routeOrder";
import { routeTemplate, stopsLabel, type RouteTemplate } from "../../lib/routes";
import list from "./ListPage.module.css";
import styles from "./RoutesPage.module.css";

type Client = FunctionReturnType<typeof api.clients.listAdmin>[number];
type Point = { lat: number; lng: number };
/** A client that can be a stop, at the location this route uses for it. */
type Located = Omit<Client, "location"> & {
  location: Point;
  /** Set by the office for this route, instead of the client's saved one. */
  custom: boolean;
};

/** "Nueva ruta" (empty, or from "Usar de nuevo") and "Editar ruta". */
export function RouteBuilderPage() {
  const { routeId } = useParams();
  const template = (useLocation().state as { template?: RouteTemplate } | null)?.template;
  return routeId ? (
    <EditRoute key={routeId} routeId={routeId} />
  ) : (
    <RouteBuilder template={template} />
  );
}

function EditRoute({ routeId }: { routeId: string }) {
  const routes = useQuery(api.routes.listAdmin);
  if (routes === undefined) return <CenteredSpinner />;
  const route = routes.find((r) => r._id === routeId);
  // Deleted, or a link to a route that was purged.
  if (!route) return <Navigate to="/rutas" replace />;
  return <RouteBuilder routeId={route._id} template={routeTemplate(route)} />;
}

/** `template` is only read when the builder opens; with `routeId` it saves over that route. */
function RouteBuilder({ template, routeId }: { template?: RouteTemplate; routeId?: Id<"routes"> }) {
  const navigate = useNavigate();

  const clients = useQuery(api.clients.listAdmin);
  const driverData = useQuery(api.users.listDrivers);
  const settings = useQuery(api.settings.get);
  const create = useMutation(api.routes.create);
  const update = useMutation(api.routes.update);
  const setBase = useMutation(api.settings.setBase);
  const setClientLocation = useMutation(api.clients.setLocation);

  const [driverId, setDriverId] = useState<string>(template?.driverId ?? "");
  // Client ids in visit order.
  const [selected, setSelected] = useState<Id<"clients">[]>(
    () => template?.stops.map((s) => s.clientId) ?? [],
  );
  // Locations the office set for this route only. The client's saved one doesn't change.
  const [custom, setCustom] = useState(() => {
    const map = new Map<Id<"clients">, Point>();
    for (const s of template?.stops ?? []) if (s.location) map.set(s.clientId, s.location);
    return map;
  });
  const [returnToBase, setReturnToBase] = useState(template?.returnToBase ?? false);
  // Once the office orders the stops by hand, the app stops reordering them.
  const [manualOrder, setManualOrder] = useState(Boolean(template));
  const [search, setSearch] = useState("");
  // Setting the base: by address, by clicking the map, or from the browser's location.
  const [editingBase, setEditingBase] = useState(false);
  // The client whose location for this route is being set, the same way.
  const [locating, setLocating] = useState<Id<"clients"> | null>(null);
  // Also save it as the client's location, for every route and their next delivery.
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [picking, setPicking] = useState(false);
  // The point proposed (an address just chosen, or where the stop is now).
  // Nothing is saved yet: the map zooms there with a pin the office can move,
  // and the base or the stop goes wherever they confirm it.
  const [draft, setDraft] = useState<FoundPlace | null>(null);
  const [focus, setFocus] = useState<Point | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mapSide = useRef<HTMLDivElement>(null);

  const base = settings?.base ?? null;
  const searchBounds = settings?.serviceArea?.bounds;
  const baseKey = base ? `${base.lat},${base.lng}` : "";

  // Only clients with a location can be a stop: the one set for this route, or their saved one.
  const located = useMemo(() => {
    const map = new Map<Id<"clients">, Located>();
    for (const c of clients ?? []) {
      const own = custom.get(c._id);
      const location = own ?? c.location;
      if (location) map.set(c._id, { ...c, location, custom: own !== undefined });
    }
    return map;
  }, [clients, custom]);

  const stops = useMemo(
    () => selected.flatMap((id) => located.get(id) ?? []),
    [selected, located],
  );
  // Where the stops are, whatever their order: a stop added or moved changes it.
  const stopsKey = stops
    .map((c) => `${c._id}:${c.location.lat},${c.location.lng}`)
    .sort()
    .join("|");

  const optimized = (ids: Id<"clients">[], back: boolean) =>
    optimizeStops(
      base,
      ids.flatMap((id) => located.get(id) ?? []),
      back && base !== null,
    ).map((c) => c._id);

  // A new base, "volver a la base", or a stop added or moved elsewhere changes which order is shortest.
  useEffect(() => {
    if (clients && !manualOrder) setSelected((ids) => optimized(ids, returnToBase));
    // Only when those change (reordering doesn't change `stopsKey`).
  }, [baseKey, returnToBase, stopsKey, clients === undefined]);

  const drivers = driverData?.drivers;
  useEffect(() => {
    if (drivers?.length === 1) setDriverId((id) => id || drivers[0]._id);
  }, [drivers]);

  const mapStops = useMemo<MapClient[]>(
    () => stops.map((c) => ({ id: c._id, name: c.name, location: c.location })),
    [stops],
  );
  const mapOthers = useMemo<MapClient[]>(() => {
    const chosen = new Set(selected);
    return [...located.values()]
      .filter((c) => !chosen.has(c._id))
      .map((c) => ({ id: c._id, name: c.name, location: c.location }));
  }, [located, selected]);

  if (clients === undefined || drivers === undefined || settings === undefined) {
    return <CenteredSpinner />;
  }

  const full = stops.length >= MAX_ROUTE_STOPS;
  const searchKey = normalizeKey(search);
  const visible = clients.filter((c) => !searchKey || normalizeKey(c.name).includes(searchKey));
  const withoutLocation = clients.length - located.size;
  const position = new Map(stops.map((c, i) => [c._id, i + 1]));
  // Stops of the original route whose client was deleted or lost its location.
  const lost = (template?.stops ?? []).filter((s) => !located.has(s.clientId)).length;
  const locatingClient = clients.find((c) => c._id === locating);

  function toggle(id: Id<"clients">) {
    const adding = !selected.includes(id);
    if (adding && (full || !located.has(id))) return;
    const next = adding ? [...selected, id] : selected.filter((x) => x !== id);
    setSelected(manualOrder ? next : optimized(next, returnToBase));
    setError(null);
  }

  function move(index: number, by: -1 | 1) {
    const ids = stops.map((c) => c._id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    setSelected(ids);
    setManualOrder(true);
  }

  function optimize() {
    setManualOrder(false);
    setSelected(optimized(selected, returnToBase));
  }

  /** Closes whichever is open: the base editor or a client's location. */
  function closeEditor() {
    setEditingBase(false);
    setLocating(null);
    setPicking(false);
    setDraft(null);
  }

  function proposePlace(place: FoundPlace) {
    setDraft(place);
    setFocus(place.location);
    setPicking(true);
  }

  // A click on the map, or the proposed pin dropped somewhere else.
  function pickOnMap(point: Point) {
    if (draft || locating) setDraft({ name: draft?.name ?? "", location: point });
    else void saveBase(point);
  }

  function startLocating(client: Client) {
    closeEditor();
    setLocating(client._id);
    // Without a saved location, this one is usually the right one for every route.
    setSaveAsDefault(!client.location);
    setPicking(true);
    const current = located.get(client._id)?.location;
    if (current) proposePlace({ name: client.name, location: { lat: current.lat, lng: current.lng } });
    // On a phone the map is above the list, out of sight.
    mapSide.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function confirmLocation() {
    if (!locatingClient || !draft) return;
    const id = locatingClient._id;
    const point = { lat: draft.location.lat, lng: draft.location.lng };
    const saved = locatingClient.location;
    if (saveAsDefault) {
      setSavingLocation(true);
      try {
        // Resolves once `clients` has the new location, so the stop is already located.
        await setClientLocation({ clientId: id, location: point });
      } catch (e) {
        alert(errorMessage(e));
        return;
      } finally {
        setSavingLocation(false);
      }
      // It's the client's own location now, not one for this route.
      setCustom((map) => {
        if (!map.has(id)) return map;
        const next = new Map(map);
        next.delete(id);
        return next;
      });
      setSelected((ids) => (ids.includes(id) || ids.length >= MAX_ROUTE_STOPS ? ids : [...ids, id]));
      setError(null);
      closeEditor();
      return;
    }
    // The pin never left the saved location: there's nothing to remember.
    const unchanged =
      !custom.has(id) && saved && saved.lat === point.lat && saved.lng === point.lng;
    if (!unchanged) {
      setCustom((map) => new Map(map).set(id, point));
      // Giving a client a location for the route puts it on the route.
      if (!selected.includes(id) && !full) setSelected((ids) => [...ids, id]);
      setError(null);
    }
    closeEditor();
  }

  /** Back to the client's saved location; without one, the client leaves the route. */
  function clearLocation() {
    if (!locatingClient) return;
    const id = locatingClient._id;
    setCustom((map) => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });
    if (!locatingClient.location) setSelected((ids) => ids.filter((x) => x !== id));
    closeEditor();
  }

  async function saveBase(point: Point & { accuracy?: number }) {
    closeEditor();
    try {
      await setBase({ base: point });
    } catch (e) {
      alert(errorMessage(e));
    }
  }

  function baseFromMyLocation() {
    if (!navigator.geolocation) {
      alert("Este navegador no puede obtener tu ubicación. Márcala en el mapa.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        void saveBase({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      () => alert("No se pudo obtener tu ubicación. Márcala en el mapa."),
      { enableHighAccuracy: true, timeout: 20_000 },
    );
  }

  async function saveRoute() {
    setError(null);
    setSaving(true);
    try {
      const fields = {
        driverId: driverId as Id<"users">,
        stops: stops.map((c) => ({
          clientId: c._id,
          ...(c.custom ? { location: c.location } : {}),
        })),
        returnToBase: returnToBase && base !== null,
      };
      const shareId = routeId ? await update({ routeId, ...fields }) : await create(fields);
      // The list opens the share dialog: an edited route has new Google Maps links.
      navigate("/rutas", { state: { shareId } });
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  const km = routeLengthMeters(
    base,
    stops.map((c) => c.location),
    returnToBase,
  ) / 1000;
  const links = Math.ceil((stops.length + (returnToBase && base ? 1 : 0)) / MAPS_STOPS_PER_LINK);
  const driverChosen = drivers.some((d) => d._id === driverId);
  // Without the Google key there's no map to search or click on.
  const hasMap = googleMapsKey !== null;

  return (
    <div className={list.page}>
      <div className={list.heading}>
        <div>
          <h1>{routeId ? "Editar ruta" : "Nueva ruta"}</h1>
          <p>
            {routeId
              ? "Agrega, quita o reordena paradas, o cambia de chofer. El chofer ve los cambios en su teléfono al guardar; la ruta vence cuando ya iba a vencer y las entregas registradas se conservan."
              : "Marca los clientes que toca visitar. La app ordena las paradas desde la base para recorrer menos; puedes cambiar el orden a mano."}
          </p>
        </div>
        <Link to="/rutas" className="btn btn-ghost">
          <ChevronLeftIcon size={18} /> Rutas
        </Link>
      </div>

      <div className={styles.columns}>
        <div className={styles.side}>
          <section className={`card ${styles.panel}`}>
            <label className="label" htmlFor="route-driver">
              Chofer
            </label>
            <select
              id="route-driver"
              className="input"
              value={driverChosen ? driverId : ""}
              onChange={(e) => setDriverId(e.target.value)}
            >
              <option value="" disabled>
                Elige un chofer
              </option>
              {drivers.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name}
                </option>
              ))}
            </select>
            {drivers.length === 0 && (
              <p className={styles.hint}>
                Ningún chofer ha entrado a la app todavía. La ruta se asigna a un chofer que ya
                inició sesión.
              </p>
            )}
          </section>

          <section className={`card ${styles.panel}`}>
            <div className={styles.panelHeader}>
              <h2>Clientes</h2>
              <span>
                {stops.length} de {MAX_ROUTE_STOPS} máx.
              </span>
            </div>
            <input
              className="input"
              type="search"
              placeholder="Buscar cliente"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {withoutLocation > 0 && (
              <p className={styles.hint}>
                {withoutLocation === 1
                  ? "1 cliente aún no tiene ubicación"
                  : `${withoutLocation} clientes aún no tienen ubicación`}{" "}
                (se guarda en su primera entrega).{" "}
                {hasMap
                  ? "Para agregarlos, dales una con el botón del pin."
                  : "No se pueden agregar."}
              </p>
            )}
            {visible.length === 0 ? (
              <div className={styles.noClients}>
                {clients.length === 0 ? "Aún no hay clientes." : "Ningún cliente coincide."}
              </div>
            ) : (
              <ul className={styles.clients}>
                {visible.map((client) => {
                  const checked = position.has(client._id);
                  const usable = located.get(client._id);
                  const disabled = !usable || (full && !checked);
                  return (
                    <li key={client._id} className={styles.clientRow}>
                      <label
                        className={`${styles.client} ${disabled ? styles.clientDisabled : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggle(client._id)}
                        />
                        <span className={styles.clientName}>
                          {client.name}
                          {usable?.custom && (
                            <small className={styles.customNote}>
                              Otra ubicación para esta ruta
                            </small>
                          )}
                        </span>
                        <span className={styles.clientMeta}>
                          {!usable
                            ? "Sin ubicación"
                            : checked
                              ? `Parada ${position.get(client._id)}`
                              : client.lastDeliveryAt
                                ? formatDay(client.lastDeliveryAt)
                                : ""}
                        </span>
                      </label>
                      {hasMap && (
                        <button
                          type="button"
                          className={`${styles.iconButton} ${usable?.custom ? styles.iconButtonOn : ""}`}
                          aria-label={`Ubicación de ${client.name} para esta ruta`}
                          title={
                            usable?.custom
                              ? "Tiene otra ubicación para esta ruta"
                              : usable
                                ? "Cambiar la ubicación solo para esta ruta"
                                : "Darle una ubicación"
                          }
                          disabled={full && !checked}
                          onClick={() => startLocating(client)}
                        >
                          <PinIcon size={16} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className={`card ${styles.panel}`}>
            <div className={styles.panelHeader}>
              <h2>Orden de la ruta</h2>
              <span>{manualOrder ? "Orden manual" : "Orden automático"}</span>
            </div>
            {lost > 0 && (
              <p className={styles.lost}>
                {lost === 1
                  ? "1 parada de la ruta original ya no está: su cliente se eliminó o ya no tiene ubicación."
                  : `${lost} paradas de la ruta original ya no están: sus clientes se eliminaron o ya no tienen ubicación.`}
              </p>
            )}
            {stops.length === 0 ? (
              <p className={styles.emptyStops}>
                Marca clientes en la lista o toca sus puntos en el mapa.
              </p>
            ) : (
              <ol className={styles.stops}>
                {stops.map((stop, i) => (
                  <li key={stop._id} className={styles.stop}>
                    <span className={styles.stopNumber}>{i + 1}</span>
                    <span className={styles.stopName} title={stop.name}>
                      {stop.name}
                    </span>
                    {stop.custom && (
                      <span className={styles.customMark} title="Otra ubicación para esta ruta">
                        <PinIcon size={16} />
                      </span>
                    )}
                    <span className={styles.stopButtons}>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={`Subir ${stop.name}`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ChevronDownIcon size={18} className={styles.up} />
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={`Bajar ${stop.name}`}
                        disabled={i === stops.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ChevronDownIcon size={18} />
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={`Quitar ${stop.name}`}
                        onClick={() => toggle(stop._id)}
                      >
                        <CloseIcon size={16} />
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
            )}

            <div className={styles.stopTools}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={returnToBase && base !== null}
                  disabled={base === null}
                  onChange={(e) => setReturnToBase(e.target.checked)}
                />
                Volver a la base al final
              </label>
              <button
                type="button"
                className="btn btn-soft"
                disabled={stops.length < 2 || !manualOrder}
                onClick={optimize}
              >
                Optimizar orden
              </button>
            </div>

            {stops.length > 0 && (
              <p className={styles.summary}>
                <strong>{stopsLabel(stops.length)}</strong>
                {stops.length > 1 || base
                  ? ` · unos ${km.toLocaleString("es-MX", { maximumFractionDigits: 1 })} km en línea recta`
                  : ""}
                {links > 1 && (
                  <span className={styles.sub}>
                    <br />
                    Google Maps acepta 10 paradas por enlace: el chofer recibirá {links} enlaces.
                  </span>
                )}
              </p>
            )}

            {error && <p className="error-text">{error}</p>}
            <button
              type="button"
              className={`btn btn-primary ${styles.create}`}
              disabled={!driverChosen || stops.length === 0 || saving}
              onClick={() => void saveRoute()}
            >
              {saving ? (
                <>
                  <Spinner size={18} light /> {routeId ? "Guardando…" : "Creando ruta…"}
                </>
              ) : routeId ? (
                "Guardar cambios"
              ) : (
                "Crear ruta"
              )}
            </button>
            {!driverChosen && stops.length > 0 && (
              <p className={styles.hint}>
                Elige el chofer para {routeId ? "guardar" : "crear"} la ruta.
              </p>
            )}
          </section>
        </div>

        <div className={styles.mapSide} ref={mapSide}>
          <div
            className={`card ${styles.baseBar} ${base || locatingClient ? "" : styles.baseMissing}`}
          >
            {locatingClient ? (
              <div className={styles.baseEditor}>
                <span>
                  <strong>
                    Ubicación de {locatingClient.name}
                    {saveAsDefault ? "." : " para esta ruta."}
                  </strong>{" "}
                  {draft
                    ? "Arrastra el pin, haz clic en el punto exacto o busca la dirección."
                    : "Busca la dirección o haz clic en el mapa donde va la entrega."}
                  {!saveAsDefault &&
                    locatingClient.location &&
                    " La ubicación guardada del cliente no cambia."}
                </span>
                <AddressSearch onSelect={proposePlace} autoFocus={!draft} bounds={searchBounds} />
                <div className={styles.checkRow}>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={saveAsDefault}
                      disabled={savingLocation}
                      onChange={(e) => setSaveAsDefault(e.target.checked)}
                    />
                    {locatingClient.location
                      ? "Reemplazar la ubicación guardada del cliente"
                      : "Guardar como ubicación del cliente (para todas las rutas)"}
                  </label>
                  {/* Outside the label: tapping it mustn't tick the box. */}
                  <HelpTip label="¿Qué hace esta opción?">
                    {locatingClient.location
                      ? "Si la marcas, esta ubicación reemplaza la guardada del cliente (por ejemplo, si se mudó). Las rutas ya creadas no cambian. Si no, solo se usa en esta ruta."
                      : "Este cliente aún no tiene ubicación guardada. Si marcas la casilla, esta queda guardada para todas sus rutas y entregas. Si no, solo se usa en esta ruta."}
                  </HelpTip>
                </div>
                <div className={styles.baseButtons}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!draft || savingLocation}
                    onClick={() => void confirmLocation()}
                  >
                    {savingLocation ? (
                      <>
                        <Spinner size={18} light /> Guardando…
                      </>
                    ) : (
                      "Usar esta ubicación"
                    )}
                  </button>
                  {custom.has(locatingClient._id) && (
                    <button type="button" className="btn btn-ghost" onClick={clearLocation}>
                      {locatingClient.location
                        ? "Volver a la ubicación guardada"
                        : "Quitar ubicación"}
                    </button>
                  )}
                  <button type="button" className="btn btn-ghost" onClick={closeEditor}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : draft ? (
              <>
                <span>
                  <strong>¿Es aquí la bodega?</strong> {draft.name}. Arrastra el pin o haz clic en
                  el punto exacto.
                </span>
                <div className={styles.baseButtons}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void saveBase(draft.location)}
                  >
                    Fijar base aquí
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={closeEditor}>
                    Cancelar
                  </button>
                </div>
              </>
            ) : picking ? (
              <>
                <span>
                  <strong>Haz clic en el mapa</strong> donde está la base.
                </span>
                <div className={styles.baseButtons}>
                  <button type="button" className="btn btn-ghost" onClick={closeEditor}>
                    Cancelar
                  </button>
                </div>
              </>
            ) : base === null || editingBase ? (
              <div className={styles.baseEditor}>
                <span>
                  {base ? (
                    <strong>¿Dónde está la base?</strong>
                  ) : (
                    <>
                      <strong>Falta fijar la base.</strong> Es la bodega de donde salen las rutas.
                    </>
                  )}
                </span>
                {hasMap && (
                  <AddressSearch
                    onSelect={proposePlace}
                    autoFocus={editingBase}
                    bounds={searchBounds}
                  />
                )}
                <div className={styles.baseButtons}>
                  {hasMap && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setPicking(true)}
                    >
                      Marcar en el mapa
                    </button>
                  )}
                  <button type="button" className="btn btn-ghost" onClick={baseFromMyLocation}>
                    Usar mi ubicación
                  </button>
                  {base && (
                    <button type="button" className="btn btn-ghost" onClick={closeEditor}>
                      Cancelar
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <span>
                  Las rutas salen de la <strong>base (B)</strong>.
                </span>
                <div className={styles.baseButtons}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setEditingBase(true)}
                  >
                    Cambiar base
                  </button>
                </div>
              </>
            )}
          </div>

          <div className={`card ${styles.mapCard}`}>
            <RouteMap
              defaultCenter={settings.serviceArea?.center}
              base={base}
              stops={mapStops}
              others={mapOthers}
              returnToBase={returnToBase}
              picking={picking}
              focus={focus}
              draft={draft?.location}
              draftLabel={locating ? String(position.get(locating) ?? "+") : "B"}
              onToggle={(id) => toggle(id as Id<"clients">)}
              onPick={pickOnMap}
            />
          </div>
          <p className={styles.legend}>
            Los números son las paradas en orden; los puntos blancos son los demás clientes (tócalos
            para agregarlos). Las líneas son rectas: la ruta por calles se abre con el enlace que
            recibe el chofer.
          </p>
        </div>
      </div>
    </div>
  );
}
