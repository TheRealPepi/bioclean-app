import { REPEAT_META, repeatStyle, type InvoiceRepeat } from "../lib/repeat";
import styles from "./StatusBadge.module.css";

/** Marks a delivery with a factura that was already in an earlier delivery. */
export function RepeatBadge({ repeat }: { repeat: InvoiceRepeat }) {
  return (
    <span className={styles.badge} style={repeatStyle(repeat)}>
      <i className={styles.dot} />
      {REPEAT_META[repeat].label}
    </span>
  );
}
