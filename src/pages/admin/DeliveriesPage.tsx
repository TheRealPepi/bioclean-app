import { useQuery } from "convex/react";
import { useMemo, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { normalizeKey } from "../../../convex/lib/text";
import { DownloadIcon } from "../../components/Icons";
import { PaymentBadge } from "../../components/PaymentBadge";
import { CenteredSpinner } from "../../components/Spinner";
import { StatusBadge } from "../../components/StatusBadge";
import { DAY_MS, formatShort, formatTime, isoDate, startOfDay } from "../../lib/dates";
import { downloadCsv } from "../../lib/csv";
import { googleMapsUrl } from "../../lib/maps";
import { isPayment, LOCATION_SOURCE_SHORT, PAYMENT_META, PAYMENTS } from "../../lib/payment";
import {
  isStatus,
  STATUS_META,
  STATUSES,
  statusStyle,
  type DeliveryStatus,
} from "../../lib/status";
import styles from "./DeliveriesPage.module.css";

const compact = (text: string) => normalizeKey(text).replace(/ /g, "");

export function DeliveriesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();

  const today = isoDate();
  const from = params.get("desde") || today;
  const to = params.get("hasta") || today;
  const driverId = params.get("chofer") ?? "";
  const search = params.get("q") ?? "";
  const statusParam = params.get("estatus");
  const status = isStatus(statusParam) ? statusParam : null;
  const paymentParam = params.get("pago");
  const payment = isPayment(paymentParam) ? paymentParam : null;

  const update = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const result = useQuery(api.deliveries.list, {
    from: startOfDay(lo),
    to: startOfDay(hi) + DAY_MS,
  });
  // Keep showing the previous results while a new date range loads.
  const lastResult = useRef(result);
  if (result !== undefined) lastResult.current = result;
  const deliveries = result ?? lastResult.current;

  const driverData = useQuery(api.users.listDrivers);

  const driverOptions = useMemo(() => {
    const names = new Map<string, string>();
    driverData?.drivers.forEach((d) => names.set(d._id, d.name));
    deliveries?.forEach((d) => names.has(d.driverId) || names.set(d.driverId, d.driverName));
    return [...names].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [driverData, deliveries]);

  const { counts, rows } = useMemo(() => {
    const key = normalizeKey(search);
    const compactKey = compact(search);
    const matching = (deliveries ?? []).filter(
      (d) =>
        (!driverId || d.driverId === driverId) &&
        (!payment || d.payment === payment) &&
        (!key ||
          normalizeKey(d.clientName).includes(key) ||
          compact(d.invoiceNumber).includes(compactKey)),
    );
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<DeliveryStatus, number>;
    matching.forEach((d) => counts[d.status]++);
    return {
      counts: { ...counts, all: matching.length },
      rows: status ? matching.filter((d) => d.status === status) : matching,
    };
  }, [deliveries, driverId, payment, search, status]);

  function exportCsv() {
    downloadCsv(
      lo === hi ? `entregas_${lo}.csv` : `entregas_${lo}_a_${hi}.csv`,
      [
        "Fecha",
        "Hora",
        "Cliente",
        "Factura",
        "Chofer",
        "Vehículo",
        "Estatus",
        "Pago",
        "Anotaciones",
        "Ubicación",
        "Tipo de ubicación",
      ],
      rows.map((d) => [
        isoDate(d.deliveredAt),
        formatTime(d.deliveredAt),
        d.clientName,
        d.invoiceNumber,
        d.driverName,
        d.vehicleName ?? "",
        STATUS_META[d.status].label,
        d.payment ? PAYMENT_META[d.payment].label : "",
        d.notes,
        googleMapsUrl(d.location),
        d.locationSource ? LOCATION_SOURCE_SHORT[d.locationSource] : "",
      ]),
    );
  }

  const openDelivery = (id: string) =>
    navigate(`/entregas/${id}`, { state: { from: location.pathname + location.search } });

  return (
    <div className={styles.page}>
      <section className={`card ${styles.filters}`}>
        <label>
          <span className="label">Desde</span>
          <input
            className="input"
            type="date"
            value={from}
            max={today}
            onChange={(e) => update("desde", e.target.value)}
          />
        </label>
        <label>
          <span className="label">Hasta</span>
          <input
            className="input"
            type="date"
            value={to}
            max={today}
            onChange={(e) => update("hasta", e.target.value)}
          />
        </label>
        <label className={styles.driverFilter}>
          <span className="label">Chofer</span>
          <select
            className="input"
            value={driverId}
            onChange={(e) => update("chofer", e.target.value)}
          >
            <option value="">Todos</option>
            {driverOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Pago</span>
          <select
            className="input"
            value={payment ?? ""}
            onChange={(e) => update("pago", e.target.value)}
          >
            <option value="">Todos</option>
            {PAYMENTS.map((p) => (
              <option key={p} value={p}>
                {PAYMENT_META[p].label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.search}>
          <span className="label">Buscar</span>
          <input
            className="input"
            type="search"
            placeholder="Cliente o factura"
            value={search}
            onChange={(e) => update("q", e.target.value)}
          />
        </label>
      </section>

      <div className={styles.chips} role="group" aria-label="Filtrar por estatus">
        <button
          type="button"
          className={`${styles.chip} ${styles.chipAll} ${status === null ? styles.chipActive : ""}`}
          onClick={() => update("estatus", null)}
          aria-pressed={status === null}
        >
          <strong>{counts.all}</strong>
          <span>Todas</span>
        </button>
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className={`${styles.chip} ${status === s ? styles.chipActive : ""}`}
            style={statusStyle(s)}
            onClick={() => update("estatus", status === s ? null : s)}
            aria-pressed={status === s}
          >
            <strong>{counts[s]}</strong>
            <span>{STATUS_META[s].label}</span>
          </button>
        ))}
      </div>

      <div className={styles.toolbar}>
        <span className={styles.count}>
          {rows.length} {rows.length === 1 ? "entrega" : "entregas"}
        </span>
        <button
          type="button"
          className="btn btn-soft"
          onClick={exportCsv}
          disabled={rows.length === 0}
        >
          <DownloadIcon size={16} />
          Descargar Excel (CSV)
        </button>
      </div>

      <section className={`card ${styles.tableCard}`}>
        {deliveries === undefined ? (
          <CenteredSpinner />
        ) : rows.length === 0 ? (
          <div className={styles.empty}>No hay entregas con estos filtros.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Factura</th>
                <th>Chofer</th>
                <th>Estatus</th>
                <th>Pago</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr
                  key={d._id}
                  tabIndex={0}
                  onClick={() => openDelivery(d._id)}
                  onKeyDown={(e) => e.key === "Enter" && openDelivery(d._id)}
                >
                  <td className={styles.date}>{formatShort(d.deliveredAt)}</td>
                  <td className={styles.client}>{d.clientName}</td>
                  <td className={styles.invoice}>{d.invoiceNumber}</td>
                  <td className={styles.driver}>
                    {d.driverName}
                    {d.vehicleName && <span className={styles.vehicle}>{d.vehicleName}</span>}
                  </td>
                  <td className={styles.status}>
                    <StatusBadge status={d.status} />
                  </td>
                  <td className={styles.payment}>
                    {d.payment ? <PaymentBadge payment={d.payment} /> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
