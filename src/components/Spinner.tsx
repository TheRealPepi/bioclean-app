import styles from "./Spinner.module.css";

/** `light` is for use on dark/green backgrounds such as primary buttons. */
export function Spinner({ size = 28, light }: { size?: number; light?: boolean }) {
  return (
    <span
      className={`${styles.spinner} ${light ? styles.light : ""}`}
      style={{ width: size, height: size }}
      role="status"
      aria-label="Cargando"
    />
  );
}

export function FullScreenSpinner() {
  return (
    <div className={styles.fullScreen}>
      <Spinner size={36} />
    </div>
  );
}

export function CenteredSpinner() {
  return (
    <div className={styles.centered}>
      <Spinner />
    </div>
  );
}
