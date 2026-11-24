import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { HelpIcon } from "./Icons";
import styles from "./Tooltip.module.css";

/** Space between the trigger and the bubble. */
const GAP = 6;
/** The bubble never gets closer than this to the edge of the screen. */
const MARGIN = 8;
/** Time to move the mouse from the trigger onto the bubble without it closing. */
const CLOSE_DELAY = 100;

type Position = { top: number; left: number };

/**
 * A tooltip for any button: spread `triggerProps` on it and render `tooltip`
 * next to it. It opens on mouse hover, on a tap (a phone has no hover) and on
 * keyboard focus, and closes on Escape, a tap elsewhere or leaving the trigger.
 * The bubble goes in `document.body`, so lists that scroll don't cut it off.
 */
export function useTooltip(content: ReactNode) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  // How the trigger was last pressed: a mouse click doesn't close what hovering opened.
  const lastPointer = useRef("mouse");

  const cancelClose = () => window.clearTimeout(closeTimer.current);
  const show = () => {
    cancelClose();
    setOpen(true);
  };
  const hide = () => {
    cancelClose();
    setOpen(false);
  };
  const hideSoon = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY);
  };

  useEffect(() => cancelClose, []);

  // Above the trigger, or below when there's no room; always inside the screen.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const bubble = bubbleRef.current;
      if (!trigger || !bubble) return;
      const width = bubble.offsetWidth;
      const height = bubble.offsetHeight;
      const screenWidth = document.documentElement.clientWidth;
      const above = trigger.top - GAP - height;
      const centered = trigger.left + trigger.width / 2 - width / 2;
      setPosition({
        top: above >= MARGIN ? above : trigger.bottom + GAP,
        left: Math.max(MARGIN, Math.min(centered, screenWidth - MARGIN - width)),
      });
    };
    place();
    // Capture: a list scrolling inside the page moves the trigger too.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    const onPointerDown = (e: globalThis.PointerEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !bubbleRef.current?.contains(target)) hide();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const triggerProps = {
    ref: triggerRef,
    "aria-describedby": open ? id : undefined,
    "data-open": open || undefined,
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      lastPointer.current = e.pointerType;
    },
    onPointerEnter: (e: PointerEvent<HTMLButtonElement>) => {
      if (e.pointerType === "mouse") show();
    },
    onPointerLeave: (e: PointerEvent<HTMLButtonElement>) => {
      if (e.pointerType === "mouse") hideSoon();
    },
    // Only focus from the keyboard: a tap also focuses, and its click toggles.
    onFocus: (e: FocusEvent<HTMLButtonElement>) => {
      if (e.currentTarget.matches(":focus-visible")) show();
    },
    onBlur: hide,
    onClick: (e: MouseEvent<HTMLButtonElement>) => {
      // `detail` is 0 for Enter or Space: those toggle, like a tap.
      if (e.detail > 0 && lastPointer.current === "mouse") show();
      else setOpen((o) => !o);
    },
  };

  const tooltip = open
    ? createPortal(
        <div
          ref={bubbleRef}
          id={id}
          role="tooltip"
          className={styles.bubble}
          // Measured hidden first, then placed.
          style={position ?? { visibility: "hidden" }}
          onPointerEnter={(e) => e.pointerType === "mouse" && cancelClose()}
          onPointerLeave={(e) => e.pointerType === "mouse" && hideSoon()}
        >
          {content}
        </div>,
        document.body,
      )
    : null;

  return { triggerProps, tooltip };
}

/** A "?" that explains what's next to it. `label` is what screen readers announce. */
export function HelpTip({
  label = "Más información",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  const { triggerProps, tooltip } = useTooltip(children);
  return (
    <>
      <button type="button" className={styles.help} aria-label={label} {...triggerProps}>
        <HelpIcon size={18} />
      </button>
      {tooltip}
    </>
  );
}
