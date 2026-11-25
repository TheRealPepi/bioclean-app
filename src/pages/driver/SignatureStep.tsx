import { useEffect, useRef, useState } from "react";
import { cleanInvoice } from "../../../convex/lib/text";
import { AlertIcon, CheckIcon, LockIcon } from "../../components/Icons";
import { PaymentBadge } from "../../components/PaymentBadge";
import { SignaturePad } from "../../components/SignaturePad";
import { formatDay, formatTime } from "../../lib/dates";
import type { Draft } from "../../lib/draft";
import { answerComplete, signatureIsCurrent, signedContentKey } from "../../lib/signature";
import { useNow } from "../../lib/useNow";
import { OutcomeStep } from "./OutcomeStep";
import styles from "./SignatureStep.module.css";

type Section = "answer" | "signature";

/** Set by the wizard when the client taps "save" with something missing. */
export type Attention = { target: Section; n: number };

/**
 * The one screen the driver hands to the client: what is being delivered,
 * ① how it went, ② their signature. Signing comes last on purpose: people
 * hand the phone back right after signing, so nothing important comes after
 * it but the save button. The signature also confirms the client's answer.
 */
export function SignatureStep({
  draft,
  onChange,
  attention,
}: {
  draft: Draft;
  onChange: (changes: Partial<Draft>) => void;
  attention: Attention | null;
}) {
  const now = useNow(30_000);
  const answered = answerComplete(draft);
  const signed = signatureIsCurrent(draft);
  // Signed earlier, but the driver went back and changed what was signed.
  // Kept for as long as the screen is open: if it disappeared on the first
  // stroke, the pad would jump up under the client's finger.
  const [stale] = useState(draft.signature !== undefined && !signed);
  const invoices = draft.invoices.map((i) => cleanInvoice(i.number));
  const notes = draft.notes.trim();

  const refs = {
    answer: useRef<HTMLElement>(null),
    signature: useRef<HTMLElement>(null),
  };
  // Bumped to start the pad over empty when the client changes their answer.
  const [padKey, setPadKey] = useState(0);

  function show(target: Section, flash: boolean) {
    const el = refs[target].current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "center",
    });
    if (flash && !reduce) {
      el.animate(
        [
          { boxShadow: "0 0 0 0 rgb(180 83 9 / 0)" },
          { boxShadow: "0 0 0 6px rgb(180 83 9 / 0.55)" },
          { boxShadow: "0 0 0 0 rgb(180 83 9 / 0)" },
        ],
        { duration: 600, iterations: 2 },
      );
    }
  }

  useEffect(() => {
    if (attention) show(attention.target, true);
    // Only a new tap (a new `n`) should scroll.
  }, [attention?.n]);

  return (
    <div className={styles.stack}>
      <p className={styles.banner} role="note">
        <AlertIcon size={20} />
        <span>
          Responda, firme y toque <strong>Confirmar entrega</strong> antes de devolver el teléfono al
          conductor.
        </span>
      </p>

      <section className={`card ${styles.summary}`}>
        <strong className={styles.client}>{draft.clientName}</strong>
        <div className={styles.row}>
          <span>
            <span className={styles.muted}>{invoices.length === 1 ? "Factura" : "Facturas"}</span>{" "}
            {invoices.join(", ")}
          </span>
          {draft.payment && <PaymentBadge payment={draft.payment} />}
        </div>
        {notes && <p className={styles.notes}>{notes}</p>}
        <span className={styles.when}>
          {formatDay(now)} · {formatTime(now)}
        </span>
      </section>

      <section ref={refs.answer} className={styles.section}>
        <SectionHead n={1} done={answered} title="¿Cómo llegó la entrega?" />
        <OutcomeStep
          draft={draft}
          onChange={(changes) => {
            // The signature confirms this answer: a different answer clears
            // it, and the pad starts over empty.
            if (
              signed &&
              signedContentKey({ ...draft, ...changes }) !== draft.signature!.signedFor
            ) {
              setPadKey((k) => k + 1);
              onChange({ ...changes, signature: undefined });
            } else {
              onChange(changes);
            }
          }}
          // Wait for the pad to unlock before scrolling to it.
          onAnswered={() => requestAnimationFrame(() => show("signature", false))}
        />
      </section>

      <section ref={refs.signature} className={styles.section}>
        <SectionHead n={2} done={signed} title="Firme para confirmar" />

        {stale && (
          <p className={styles.stale}>
            <AlertIcon size={18} />
            <span>La entrega cambió después de la firma anterior. Firme de nuevo.</span>
          </p>
        )}

        <div className={styles.padWrap}>
          <SignaturePad
            key={padKey}
            // Same text before and after signing, so the pad never moves
            // between strokes. "Signed" shows as ✓ on ② and on the button.
            header={
              <p className={styles.padHeader}>Al firmar confirma esta entrega y su respuesta.</p>
            }
            // A signature that's no longer current was made before the driver
            // went back: the pad then starts empty (it shows the saved one
            // only on mount).
            value={signed ? draft.signature!.image : undefined}
            onChange={(image) =>
              onChange({
                signature: image && {
                  image,
                  signedAt: Date.now(),
                  signedFor: signedContentKey(draft),
                },
              })
            }
          />
          {!answered && (
            <button type="button" className={styles.lock} onClick={() => show("answer", true)}>
              <LockIcon size={26} />
              <span>Primero responda la pregunta 1</span>
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function SectionHead({ n, done, title }: { n: number; done: boolean; title: string }) {
  return (
    <h2 className={styles.sectionHead}>
      <span className={`${styles.badge} ${done ? styles.badgeDone : ""}`}>
        {done ? <CheckIcon size={16} /> : n}
      </span>
      {title}
    </h2>
  );
}
