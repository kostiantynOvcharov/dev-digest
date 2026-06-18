/* HoverPopover — lightweight hover-triggered popover. Renders the trigger inline
   and, on hover, shows `content` in a portal layer positioned from the trigger's
   bounding rect (so it escapes table/row overflow) and clamped to the viewport.
   A short close delay lets the pointer travel into the popover without flicker.
   There is no Tooltip/Popover primitive in vendor/ui — this is the shared one. */
"use client";

import React from "react";
import { createPortal } from "react-dom";

const GAP = 6; // px between trigger and popover
const MARGIN = 8; // px min distance from viewport edges
const CLOSE_DELAY = 120; // ms grace period to move pointer into the popover

export function HoverPopover({
  content,
  children,
  width = 340,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  /** Popover width in px (used for viewport clamping). */
  width?: number;
}) {
  const triggerRef = React.useRef<HTMLSpanElement | null>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = React.useState<{
    top?: number;
    bottom?: number;
    left: number;
  } | null>(null);

  const clearClose = React.useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const open = React.useCallback(() => {
    clearClose();
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Default: below the trigger, left-aligned. Clamp horizontally to viewport;
    // flip above if there isn't room below.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = r.left;
    if (left + width + MARGIN > vw) left = Math.max(MARGIN, vw - width - MARGIN);
    // Prefer below the trigger; if the space below is cramped and there's more
    // room above, anchor the popover's bottom to just above the trigger.
    const spaceBelow = vh - r.bottom;
    const spaceAbove = r.top;
    const top = spaceBelow < 180 && spaceAbove > spaceBelow ? undefined : r.bottom + GAP;
    setPos({ top, left, bottom: top === undefined ? vh - r.top + GAP : undefined });
  }, [clearClose, width]);

  const scheduleClose = React.useCallback(() => {
    clearClose();
    closeTimer.current = setTimeout(() => setPos(null), CLOSE_DELAY);
  }, [clearClose]);

  React.useEffect(() => () => clearClose(), [clearClose]);

  return (
    <span
      ref={triggerRef}
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
      style={{ display: "inline-flex", alignItems: "center" }}
    >
      {children}
      {pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            onMouseEnter={clearClose}
            onMouseLeave={scheduleClose}
            style={{
              position: "fixed",
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              width,
              zIndex: 1000,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
              padding: 12,
              maxHeight: "min(60vh, 420px)",
              overflowY: "auto",
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}

export default HoverPopover;
