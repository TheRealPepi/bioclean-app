import { useEffect, useRef, useState, type ReactNode } from "react";
import SignaturePadLib from "signature_pad";
import { useObjectUrl } from "../lib/useObjectUrl";
import styles from "./SignaturePad.module.css";

/** Ink smaller than this (in CSS pixels, both sides) is a tap, not a signature. */
const MIN_INK_SIZE = 24;
/** The saved PNG is at most this wide. */
const MAX_OUTPUT_WIDTH = 600;
const PADDING = 12;

/**
 * Crops the canvas to the ink (plus a little padding), downscales it and
 * encodes a transparent PNG. Returns null when there's too little ink.
 */
async function exportTrimmed(canvas: HTMLCanvasElement, ratio: number): Promise<Blob | null> {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const alpha = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[(y * width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const inkW = maxX - minX + 1;
  const inkH = maxY - minY + 1;
  if (inkW < MIN_INK_SIZE * ratio && inkH < MIN_INK_SIZE * ratio) return null;

  const pad = PADDING * ratio;
  const sx = Math.max(0, minX - pad);
  const sy = Math.max(0, minY - pad);
  const sw = Math.min(width, maxX + pad + 1) - sx;
  const sh = Math.min(height, maxY + pad + 1) - sy;
  const scale = Math.min(1, MAX_OUTPUT_WIDTH / sw);

  const out = document.createElement("canvas");
  out.width = Math.round(sw * scale);
  out.height = Math.round(sh * scale);
  out.getContext("2d")!.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return await new Promise((resolve) => out.toBlob(resolve, "image/png"));
}

/**
 * Finger-drawn signature. Calls `onChange` with a trimmed PNG after each
 * stroke, or `undefined` when cleared or when the ink is just a tap.
 * While `value` is set and nothing has been drawn here (e.g. coming back to
 * the step), the saved image is shown instead of the canvas.
 */
export function SignaturePad({
  value,
  onChange,
  header,
  className,
  fill,
}: {
  value: Blob | undefined;
  onChange: (image: Blob | undefined) => void;
  /** Shown inside the box, right above where the finger goes. */
  header?: ReactNode;
  /** For the box (e.g. its border color). */
  className?: string;
  /** Grow to fill a flex-column parent instead of a fixed height. */
  fill?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [tooSmall, setTooSmall] = useState(false);
  const savedUrl = useObjectUrl(value);
  // Show the saved signature until the client chooses to sign again.
  const [showSaved, setShowSaved] = useState(value !== undefined);

  useEffect(() => {
    if (showSaved) return;
    const canvas = canvasRef.current!;
    const pad = new SignaturePadLib(canvas, {
      penColor: "#111827",
      minWidth: 1,
      maxWidth: 3,
    });
    padRef.current = pad;

    // Sized for the screen's pixel density, and redrawn when the phone rotates.
    let ratio = 1;
    const resize = () => {
      const data = pad.toData();
      ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      canvas.getContext("2d")!.scale(ratio, ratio);
      pad.clear();
      if (data.length) pad.fromData(data);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const onEnd = () => {
      void exportTrimmed(canvas, ratio).then((blob) => {
        setTooSmall(blob === null);
        onChangeRef.current(blob ?? undefined);
      });
    };
    pad.addEventListener("endStroke", onEnd);

    return () => {
      observer.disconnect();
      pad.removeEventListener("endStroke", onEnd);
      pad.off();
      padRef.current = null;
    };
  }, [showSaved]);

  function clear() {
    padRef.current?.clear();
    setTooSmall(false);
    setShowSaved(false);
    onChange(undefined);
  }

  return (
    <div className={`${styles.root} ${fill ? styles.fill : ""}`}>
      <div className={`${styles.box} ${className ?? ""}`}>
        {header}
        <div className={styles.area}>
          {showSaved && savedUrl ? (
            <img className={styles.saved} src={savedUrl} alt="Firma del cliente" />
          ) : (
            <>
              <canvas ref={canvasRef} className={styles.canvas} aria-label="Firme aquí" />
              <div className={styles.line} aria-hidden>
                <span>✕</span>
                <span>Firme aquí</span>
              </div>
            </>
          )}
          {(showSaved || value !== undefined || tooSmall) && (
            <button type="button" className={styles.clear} onClick={clear}>
              {showSaved ? "Firmar de nuevo" : "Borrar"}
            </button>
          )}
          {tooSmall && (
            <p className={styles.warn} role="alert">
              La firma es muy pequeña. Firme de nuevo.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
