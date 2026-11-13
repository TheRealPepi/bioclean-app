import { PAYMENT_META, PAYMENTS, paymentStyle, type Payment } from "../lib/payment";
import { CheckIcon } from "./Icons";
import styles from "./PaymentSelect.module.css";

export function PaymentSelect({
  value,
  onChange,
}: {
  value: Payment | undefined;
  onChange: (payment: Payment) => void;
}) {
  return (
    <div className={styles.root} role="radiogroup" aria-label="Pago">
      {PAYMENTS.map((payment) => (
        <button
          key={payment}
          type="button"
          role="radio"
          aria-checked={payment === value}
          className={`${styles.option} ${payment === value ? styles.selected : ""}`}
          style={paymentStyle(payment)}
          onClick={() => onChange(payment)}
        >
          {payment === value && <CheckIcon size={22} />}
          {PAYMENT_META[payment].label}
        </button>
      ))}
    </div>
  );
}
