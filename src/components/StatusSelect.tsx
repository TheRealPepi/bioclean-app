import { useEffect, useRef, useState } from "react";
import { STATUS_META, STATUSES, statusStyle, type DeliveryStatus } from "../lib/status";
import { CheckIcon, ChevronDownIcon } from "./Icons";
import styles from "./StatusSelect.module.css";

/** Dropdown where each status shows in its color (a native <select> can't do that). */
export function StatusSelect({
  value,
  onChange,
}: {
  value: DeliveryStatus | undefined;
  onChange: (status: DeliveryStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={`${styles.trigger} ${value ? styles.filled : ""}`}
        style={value ? statusStyle(value) : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {value ? (
          <span className={styles.value}>
            <i className={styles.dot} />
            {STATUS_META[value].label}
          </span>
        ) : (
          <span className={styles.placeholder}>Selecciona el estatus</span>
        )}
        <ChevronDownIcon className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} />
      </button>

      {open && (
        <ul className={styles.menu} role="listbox">
          {STATUSES.map((status) => (
            <li key={status}>
              <button
                type="button"
                role="option"
                aria-selected={status === value}
                className={styles.option}
                style={statusStyle(status)}
                onClick={() => {
                  onChange(status);
                  setOpen(false);
                }}
              >
                <i className={styles.dot} />
                <span>{STATUS_META[status].label}</span>
                {status === value && <CheckIcon className={styles.check} size={18} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
