import { PAYMENT_META, paymentStyle, type Payment } from "../lib/payment";
import styles from "./StatusBadge.module.css";

export function PaymentBadge({ payment, large }: { payment: Payment; large?: boolean }) {
  return (
    <span className={`${styles.badge} ${large ? styles.large : ""}`} style={paymentStyle(payment)}>
      <i className={styles.dot} />
      {PAYMENT_META[payment].label}
    </span>
  );
}
