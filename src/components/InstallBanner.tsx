import { useEffect, useState } from "react";
import { CloseIcon } from "./Icons";
import styles from "./InstallBanner.module.css";

// Chrome/Android offers installing the app through this event. It can fire
// before the driver home mounts, so it's captured as soon as the app loads.
type InstallPromptEvent = Event & { prompt: () => Promise<void> };
let installPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e as InstallPromptEvent;
  listeners.forEach((l) => l());
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  listeners.forEach((l) => l());
});

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const DISMISS_KEY = "bioclean-install-dismissed";
const DISMISS_DAYS = 3;

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

/**
 * Asks drivers to add the app to the home screen: it then opens without
 * signal, and on iPhone its saved data isn't erased after a week without use.
 */
export function InstallBanner() {
  const [, rerender] = useState(0);
  const [dismissed, setDismissed] = useState(recentlyDismissed);
  useEffect(() => {
    const listener = () => rerender((n) => n + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);

  if (dismissed || isStandalone()) return null;
  const ios = isIos();
  if (!ios && !installPrompt) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    setDismissed(true);
  }

  return (
    <div className={styles.banner}>
      <div className={styles.text}>
        <strong>Instala la app en tu teléfono</strong>
        {ios ? (
          <span>
            Así funciona sin señal. Toca <b>Compartir</b> (el cuadro con la flecha) y luego{" "}
            <b>Agregar a pantalla de inicio</b>. Después ábrela desde el ícono e inicia sesión ahí.
          </span>
        ) : (
          <span>Así se abre desde un ícono y funciona sin señal.</span>
        )}
      </div>
      {!ios && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            void installPrompt?.prompt();
            installPrompt = null;
            rerender((n) => n + 1);
          }}
        >
          Instalar
        </button>
      )}
      <button type="button" className={styles.close} aria-label="Ahora no" onClick={dismiss}>
        <CloseIcon size={18} />
      </button>
    </div>
  );
}
