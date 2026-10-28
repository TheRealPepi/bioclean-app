import { useRef, useState, type ChangeEvent } from "react";
import { compressImage } from "../lib/image";
import { useObjectUrl } from "../lib/useObjectUrl";
import { CameraIcon } from "./Icons";
import styles from "./PhotoCapture.module.css";
import { Spinner } from "./Spinner";

export function PhotoCapture({
  value,
  onChange,
  alt,
}: {
  value: Blob | undefined;
  onChange: (photo: Blob) => void;
  alt: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewUrl = useObjectUrl(value);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { blob } = await compressImage(file);
      onChange(blob);
    } catch {
      setError("No se pudo leer la foto. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  const openCamera = () => inputRef.current?.click();

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => void handleFile(e)}
      />

      {previewUrl ? (
        <div className={styles.preview}>
          <img src={previewUrl} alt={alt} />
          <button type="button" className="btn btn-ghost" onClick={openCamera} disabled={busy}>
            {busy ? <Spinner size={18} /> : <CameraIcon size={18} />}
            Tomar de nuevo
          </button>
        </div>
      ) : (
        <button type="button" className={styles.capture} onClick={openCamera} disabled={busy}>
          {busy ? <Spinner size={40} /> : <CameraIcon size={44} />}
          <span className={styles.captureLabel}>{busy ? "Procesando…" : "Tomar foto"}</span>
        </button>
      )}

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
