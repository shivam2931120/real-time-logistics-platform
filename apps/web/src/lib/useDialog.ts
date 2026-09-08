import { useEffect, useRef } from "react";

/** Keep keyboard focus within an open dialog and return it to its trigger. */
export function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    const root = ref.current;
    if (!root) return;
    const focusable = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        ),
      ).filter((element) => !element.closest("details:not([open])"));
    const frame = requestAnimationFrame(() => {
      (
        root.querySelector<HTMLElement>("[data-dialog-autofocus]") ??
        focusable()[0] ??
        root
      ).focus();
    });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0],
        last = elements[elements.length - 1];
      if (!first) {
        event.preventDefault();
        root.focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !root.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !root.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open]);
  return ref;
}
