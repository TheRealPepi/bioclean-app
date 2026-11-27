import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { CenteredSpinner } from "../../../components/Spinner";
import { formatIsoLong, isoDate } from "../../../lib/dates";
import { errorMessage } from "../../../lib/errors";
import styles from "./Settings.module.css";

type Company = FunctionReturnType<typeof api.companies.get>;

export function ReminderSettingsPage() {
  const company = useQuery(api.companies.get);
  const [saved, setSaved] = useState(false);
  if (company === undefined) return <CenteredSpinner />;
  return (
    <div className={styles.stack}>
      {/* Starts again from what the server kept (it tidies what was typed). */}
      <RemindersForm
        key={JSON.stringify(company.reminders)}
        company={company}
        justSaved={saved}
        onSaved={setSaved}
      />
      <WhatsAppToken company={company} />
    </div>
  );
}

function RemindersForm({
  company,
  justSaved,
  onSaved,
}: {
  company: Company;
  justSaved: boolean;
  onSaved: (saved: boolean) => void;
}) {
  const saved = company.reminders;
  const update = useMutation(api.companies.updateReminders);
  const testSender = useAction(api.reminders.testSender);

  const [startDate, setStartDate] = useState(saved.startDate);
  const [fromName, setFromName] = useState(saved.fromName);
  const [fromLocalPart, setFromLocalPart] = useState(saved.fromLocalPart);
  const [replyTo, setReplyTo] = useState(saved.replyTo);
  const [useWhatsApp, setUseWhatsApp] = useState(saved.whatsapp !== null);
  const [phoneNumberId, setPhoneNumberId] = useState(saved.whatsapp?.phoneNumberId ?? "");
  const [templateVencimiento, setTemplateVencimiento] = useState(
    saved.whatsapp?.templateVencimiento ?? "",
  );
  const [templateProximo, setTemplateProximo] = useState(saved.whatsapp?.templateProximo ?? "");
  const [lang, setLang] = useState(saved.whatsapp?.lang ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ sending?: boolean; ok?: string; error?: string }>({});

  const edited = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    onSaved(false);
  };
  const dirty =
    startDate !== saved.startDate ||
    fromName !== saved.fromName ||
    fromLocalPart !== saved.fromLocalPart ||
    replyTo !== saved.replyTo ||
    useWhatsApp !== (saved.whatsapp !== null) ||
    phoneNumberId !== (saved.whatsapp?.phoneNumberId ?? "") ||
    templateVencimiento !== (saved.whatsapp?.templateVencimiento ?? "") ||
    templateProximo !== (saved.whatsapp?.templateProximo ?? "") ||
    lang !== (saved.whatsapp?.lang ?? "");

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await update({
        startDate,
        fromName,
        fromLocalPart,
        replyTo,
        whatsapp: useWhatsApp ? { phoneNumberId, templateVencimiento, templateProximo, lang } : null,
      });
      onSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTest({ sending: true });
    try {
      const { to } = await testSender({});
      setTest({ ok: `Enviado a ${to}. Revisa también la carpeta de correo no deseado.` });
    } catch (e) {
      setTest({ error: errorMessage(e) });
    }
  }

  const on = saved.startDate !== "";
  return (
    <form
      className={styles.stack}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <section className={`card ${styles.panel}`}>
        <div className={styles.row}>
          <h2>Recordatorios de pago</h2>
          <span className={`${styles.badge} ${on ? "" : styles.badgeOff}`}>
            {on ? "Encendidos" : "Apagados"}
          </span>
        </div>
        <p className={styles.hint}>
          Cada cliente con días de crédito recibe un aviso una semana antes de la fecha límite de
          pago de sus entregas a crédito y otro el día que vence, por la mañana. A quién y por dónde
          se elige en Clientes.
        </p>
        <label>
          <span className="label">Avisar de las entregas hechas desde el</span>
          <div className={styles.row}>
            <input
              className="input"
              type="date"
              value={startDate}
              onChange={(e) => edited(setStartDate)(e.target.value)}
            />
            {startDate ? (
              <button type="button" className="btn btn-ghost" onClick={() => edited(setStartDate)("")}>
                Apagar
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => edited(setStartDate)(isoDate())}
              >
                Desde hoy
              </button>
            )}
          </div>
          <span className={styles.fieldHint}>
            {startDate
              ? "Las entregas anteriores a ese día nunca reciben avisos."
              : "Sin fecha, no se envía ningún recordatorio."}
            {company.remindersLastRunOn &&
              ` Último envío: ${formatIsoLong(company.remindersLastRunOn)}.`}
          </span>
        </label>
      </section>

      <section className={`card ${styles.panel}`}>
        <h2>Correo</h2>
        <label>
          <span className="label">Nombre del remitente</span>
          <input
            className="input"
            value={fromName}
            maxLength={80}
            placeholder={company.name}
            onChange={(e) => edited(setFromName)(e.target.value)}
          />
        </label>
        {company.senderDomain ? (
          <label>
            <span className="label">Dirección del remitente</span>
            <div className={styles.address}>
              <input
                className="input"
                value={fromLocalPart}
                placeholder={company.defaultLocalPart}
                onChange={(e) => edited(setFromLocalPart)(e.target.value)}
              />
              <span>@{company.senderDomain}</span>
            </div>
          </label>
        ) : (
          <div>
            <span className="label">Dirección del remitente</span>
            <div className={styles.value}>
              {company.sharedAddress ?? "Todavía no está activado el envío por correo."}
            </div>
            <span className={styles.fieldHint}>
              Es una dirección compartida. Para enviar desde el dominio de tu empresa, pídenos
              activarlo.
            </span>
          </div>
        )}
        <label>
          <span className="label">
            Correo de respuesta{company.senderDomain ? " (opcional)" : ""}
          </span>
          <input
            className="input"
            type="email"
            value={replyTo}
            placeholder="cobranza@tuempresa.com"
            onChange={(e) => edited(setReplyTo)(e.target.value)}
          />
          <span className={styles.fieldHint}>
            A donde llega lo que tus clientes contesten al recordatorio.
          </span>
        </label>
        {company.sender.error ? (
          <p className={styles.warning}>{company.sender.error}</p>
        ) : (
          <div>
            <span className="label">Así llegan tus correos</span>
            <div className={styles.value}>{company.sender.from}</div>
          </div>
        )}
        <div className={styles.footer}>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={test.sending || dirty || company.sender.error !== null}
            onClick={() => void sendTest()}
          >
            {test.sending ? "Enviando…" : "Enviarme una prueba"}
          </button>
          {dirty && <span className={styles.hint}>Guarda los cambios para probarlos.</span>}
          {test.ok && <span className={styles.ok}>{test.ok}</span>}
          {test.error && <span className="error-text">{test.error}</span>}
        </div>
      </section>

      <section className={`card ${styles.panel}`}>
        <h2>WhatsApp</h2>
        <p className={styles.hint}>
          Usa la cuenta de WhatsApp Business de tu empresa en Meta, con dos plantillas aprobadas (una
          para el aviso de una semana antes y otra para el día del vencimiento).
        </p>
        <label className={styles.row}>
          <input
            type="checkbox"
            checked={useWhatsApp}
            onChange={(e) => edited(setUseWhatsApp)(e.target.checked)}
          />
          Enviar recordatorios por WhatsApp
        </label>
        {useWhatsApp && (
          <>
            <label>
              <span className="label">Identificador del número de teléfono</span>
              <input
                className="input"
                inputMode="numeric"
                value={phoneNumberId}
                placeholder="Por ejemplo, 123456789012345"
                onChange={(e) => edited(setPhoneNumberId)(e.target.value)}
              />
              <span className={styles.fieldHint}>
                Está en Meta, en WhatsApp › Configuración de la API. No es el número de teléfono.
              </span>
            </label>
            <div className={styles.columns}>
              <label>
                <span className="label">Plantilla del día del vencimiento</span>
                <input
                  className="input"
                  value={templateVencimiento}
                  placeholder={company.defaultTemplates.vencimiento}
                  onChange={(e) => edited(setTemplateVencimiento)(e.target.value)}
                />
              </label>
              <label>
                <span className="label">Plantilla de una semana antes</span>
                <input
                  className="input"
                  value={templateProximo}
                  placeholder={company.defaultTemplates.proximo}
                  onChange={(e) => edited(setTemplateProximo)(e.target.value)}
                />
              </label>
            </div>
            <label>
              <span className="label">Idioma de las plantillas</span>
              <input
                className="input"
                value={lang}
                placeholder={company.defaultTemplates.lang}
                onChange={(e) => edited(setLang)(e.target.value)}
              />
            </label>
            {!company.hasWhatsAppToken && (
              <p className={styles.warning}>Falta guardar el token de acceso, aquí abajo.</p>
            )}
          </>
        )}
      </section>

      <div className={styles.footer}>
        <button type="submit" className="btn btn-primary" disabled={saving || !dirty}>
          {saving ? "Guardando…" : "Guardar cambios"}
        </button>
        {justSaved && !dirty && <span className={styles.ok}>Guardado</span>}
        {error && <span className="error-text">{error}</span>}
      </div>
    </form>
  );
}

/** Apart from the form: the token is saved on its own and is never shown again. */
function WhatsAppToken({ company }: { company: Company }) {
  const setWhatsAppToken = useMutation(api.companies.setWhatsAppToken);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(value: string) {
    setSaving(true);
    setError(null);
    try {
      await setWhatsAppToken({ token: value });
      setToken("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className={`card ${styles.panel}`}
      onSubmit={(e) => {
        e.preventDefault();
        void save(token);
      }}
    >
      <div className={styles.row}>
        <h2>Token de acceso de WhatsApp</h2>
        <span className={`${styles.badge} ${company.hasWhatsAppToken ? "" : styles.badgeOff}`}>
          {company.hasWhatsAppToken ? "Guardado" : "Sin guardar"}
        </span>
      </div>
      <p className={styles.hint}>
        Es el token permanente de un usuario del sistema en Meta. Se guarda aparte y no se vuelve a
        mostrar: para cambiarlo, pega uno nuevo.
      </p>
      <div className={styles.row}>
        <input
          className="input"
          type="password"
          value={token}
          autoComplete="off"
          placeholder={company.hasWhatsAppToken ? "Pega un token nuevo para reemplazarlo" : "Pega el token"}
          aria-label="Token de acceso de WhatsApp"
          onChange={(e) => setToken(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={saving || !token.trim()}>
          Guardar token
        </button>
        {company.hasWhatsAppToken && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={saving}
            onClick={() => {
              if (confirm("¿Quitar el token? Los recordatorios por WhatsApp dejarán de enviarse.")) {
                void save("");
              }
            }}
          >
            Quitar
          </button>
        )}
      </div>
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}
