import { useState } from "react";
import { AlertIcon, CheckIcon } from "../../components/Icons";
import type { Draft } from "../../lib/draft";
import { STATUS_META, STATUSES, statusStyle } from "../../lib/status";
import styles from "./OutcomeStep.module.css";

const PROBLEMS = STATUSES.filter((s) => STATUS_META[s].alert);

/**
 * The client says whether the delivery went well, right before signing. If
 * not, they pick what went wrong. Only taps: clients don't have to type.
 * The signature covers this answer: changing it after signing asks for a new
 * signature (see SignatureStep).
 */
export function OutcomeStep({
  draft,
  onChange,
  onAnswered,
}: {
  draft: Draft;
  onChange: (changes: Partial<Draft>) => void;
  /** Called when a tap completes the answer (so the parent can move on to the signature). */
  onAnswered?: () => void;
}) {
  const [problem, setProblem] = useState(
    draft.status !== undefined && draft.status !== "exitosa",
  );
  const ok = draft.status === "exitosa";

  return (
    <div className={styles.stack}>
      <div className={styles.choices} role="radiogroup" aria-label="¿Cómo llegó la entrega?">
        <button
          type="button"
          role="radio"
          aria-checked={ok}
          className={`${styles.choice} ${ok ? styles.selected : ""}`}
          style={statusStyle("exitosa")}
          onClick={() => {
            setProblem(false);
            onChange({ status: "exitosa", clientNotes: "" });
            onAnswered?.();
          }}
        >
          <span className={styles.choiceIcon}>
            <CheckIcon size={24} />
          </span>
          <span className={styles.choiceText}>
            <strong>Todo llegó bien</strong>
            <span>Recibí la entrega completa</span>
          </span>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={problem}
          className={`${styles.choice} ${styles.problemChoice} ${problem ? styles.selected : ""}`}
          onClick={() => {
            setProblem(true);
            if (ok) onChange({ status: undefined });
          }}
        >
          <span className={styles.choiceIcon}>
            <AlertIcon size={24} />
          </span>
          <span className={styles.choiceText}>
            <strong>Hubo un problema</strong>
            <span>Algo faltó o no fue lo esperado</span>
          </span>
        </button>
      </div>

      {problem && (
        <>
          <fieldset className={styles.problems}>
            <legend className={styles.label}>¿Qué problema hubo?</legend>
            {PROBLEMS.map((status) => (
              <button
                key={status}
                type="button"
                role="radio"
                aria-checked={draft.status === status}
                className={styles.option}
                style={statusStyle(status)}
                // Also drops any explanation left from an older version of the app.
                onClick={() => onChange({ status, clientNotes: "" })}
              >
                <i className={styles.dot} />
                <span>{STATUS_META[status].label}</span>
                {draft.status === status && <CheckIcon className={styles.check} size={18} />}
              </button>
            ))}
          </fieldset>
        </>
      )}
    </div>
  );
}
