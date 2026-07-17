/* A11yModal — a focus-trapping dialog (WCAG 2.1 AA).

   The vendor `Modal` renders the right chrome but neither traps focus nor closes
   on Escape; SPEC-04's Compare modal (AC-10 UI) requires both plus a visible
   Close. This wrapper adds: focus moved into the dialog on open, Tab/Shift-Tab
   cycled within it, Escape → onClose, focus restored to the opener on unmount,
   and a labelled `role="dialog" aria-modal`. Reused by the eval-case editor and
   the run-comparison modal. */
"use client";

import React from "react";
import { IconBtn } from "@devdigest/ui";

const FOCUSABLE =
  'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function A11yModal({
  title,
  subtitle,
  onClose,
  width = 720,
  children,
  footer,
}: {
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  width?: number;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const dialogRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const opener = document.activeElement as HTMLElement | null;

    const focusables = () => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
    (focusables()[0] ?? el).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (f.length === 0) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", zIndex: 50, padding: 28 }}>
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", animation: "ddfadein .15s ease" }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{
          position: "relative",
          width,
          maxWidth: "100%",
          maxHeight: "92%",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
          borderRadius: 14,
          boxShadow: "var(--shadow-modal)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          animation: "ddpop .18s ease",
          outline: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 14,
            padding: "18px 24px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>{subtitle}</div>
            )}
          </div>
          <IconBtn icon="X" label="Close" onClick={onClose} />
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>{children}</div>
        {footer && (
          <div style={{ borderTop: "1px solid var(--border)", padding: "16px 24px", background: "var(--bg-surface)" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
