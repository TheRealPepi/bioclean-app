import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { TimeZoneSelect } from "../../components/TimeZoneSelect";
import { APP_NAME } from "../../lib/brand";
import { errorMessage } from "../../lib/errors";
import { browserTimeZone } from "../../lib/timeZones";
import styles from "./Login.module.css";

/**
 * For someone who signed in, isn't in any company and was invited to open one.
 * Once it's created `users.me` says they own it and the app opens.
 */
export function CreateCompanyPage({ email }: { email: string | null }) {
  const { signOut } = useAuthActions();
  const create = useMutation(api.companies.create);
  const [name, setName] = useState("");
  const [timeZone, setTimeZone] = useState(browserTimeZone);
  const [phoneCountryCode, setPhoneCountryCode] = useState("52");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await create({ name, timeZone, phoneCountryCode });
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={`card ${styles.card}`}>
        <div className={styles.logo} aria-hidden="true">
          <img src="/favicon.svg" alt="" />
        </div>
        <h1 className={styles.title}>Crea tu empresa</h1>
        <p className={styles.subtitle}>
          Bienvenido a {APP_NAME}. Serás el dueño de la cuenta
          {email ? (
            <>
              {" "}
              con <strong>{email}</strong>
            </>
          ) : null}
          ; después podrás agregar a tu equipo.
        </p>
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            <span className="label">Nombre de la empresa</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Como lo verán tus clientes"
              maxLength={80}
              autoFocus
            />
          </label>
          <label>
            <span className="label">Zona horaria (donde entregan)</span>
            <TimeZoneSelect value={timeZone} onChange={setTimeZone} />
          </label>
          <label>
            <span className="label">Clave de país de los teléfonos</span>
            <input
              className="input"
              inputMode="numeric"
              value={phoneCountryCode}
              onChange={(e) => setPhoneCountryCode(e.target.value)}
              placeholder="52"
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={saving || name.trim().length < 2}
          >
            {saving ? "Creando…" : "Crear empresa"}
          </button>
        </form>
        <button type="button" className={styles.link} onClick={() => void signOut()}>
          Entrar con otra cuenta
        </button>
      </div>
    </main>
  );
}
