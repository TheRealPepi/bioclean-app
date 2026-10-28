import { STATUS_META, statusStyle, type DeliveryStatus } from "../lib/status";
import styles from "./StatusBadge.module.css";

export function StatusBadge({ status, large }: { status: DeliveryStatus; large?: boolean }) {
  return (
    <span className={`${styles.badge} ${large ? styles.large : ""}`} style={statusStyle(status)}>
      <i className={styles.dot} />
      {STATUS_META[status].label}
    </span>
  );
}
