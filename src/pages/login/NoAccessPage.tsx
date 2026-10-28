import { useAuthActions } from "@convex-dev/auth/react";
import styles from "./Login.module.css";

export function NoAccessPage({ email }: { email: string | null }) {
  const { signOut } = useAuthActions();

  return (
    <main className={styles.page}>
      <div className={`card ${styles.card}`}>
        <h1 className={styles.title}>Tu correo no tiene acceso</h1>
        <p className={styles.subtitle}>
          {email ? (
            <>
              La cuenta <strong>{email}</strong> no está autorizada.
            </>
          ) : (
            "Esta cuenta no está autorizada."
          )}{" "}
          Pide al administrador que la agregue.
        </p>
        <button type="button" className="btn btn-primary btn-lg" onClick={() => void signOut()}>
          Entrar con otra cuenta
        </button>
      </div>
    </main>
  );
}
