import styles from "./Login.module.css";

/** For a role this copy of the app doesn't know: a newer version does. */
export function UpdateAppPage() {
  return (
    <main className={styles.page}>
      <div className={`card ${styles.card}`}>
        <h1 className={styles.title}>Actualiza la app</h1>
        <p className={styles.subtitle}>
          Tu cuenta usa una función que esta versión todavía no tiene. Cierra la app por completo y
          vuelve a abrirla con conexión a internet.
        </p>
        <button type="button" className="btn btn-primary btn-lg" onClick={() => location.reload()}>
          Volver a cargar
        </button>
      </div>
    </main>
  );
}
