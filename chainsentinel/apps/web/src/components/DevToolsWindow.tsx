"use client";

import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function DevToolsWindow({ open, onClose, children }: Props) {
  const windowRef = useRef<Window | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const [ready, setReady] = useState(false);

  // Keep ref in sync without triggering effect
  onCloseRef.current = onClose;

  const closeWindow = useCallback(() => {
    if (windowRef.current && !windowRef.current.closed) {
      windowRef.current.close();
    }
    windowRef.current = null;
    containerRef.current = null;
    setReady(false);
  }, []);

  // Only open/close on `open` toggle — not on every parent render
  useEffect(() => {
    if (!open) {
      closeWindow();
      return;
    }

    // Reuse existing window if still open
    if (windowRef.current && !windowRef.current.closed) {
      setReady(true);
      return;
    }

    const popup = window.open("", "ctf-devtools", "width=380,height=640,resizable=yes,scrollbars=yes");
    if (!popup) return;

    windowRef.current = popup;
    popup.document.title = "CTF-Chain Dev Tools";

    // Copy stylesheets from parent
    const parentStyles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'));
    parentStyles.forEach((node) => {
      popup.document.head.appendChild(node.cloneNode(true));
    });

    // Base styles
    const style = popup.document.createElement("style");
    style.textContent = `
      body {
        margin: 0;
        padding: 16px;
        background: #0a0a0f;
        color: #e0e0e0;
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 12px;
      }
    `;
    popup.document.head.appendChild(style);

    const fontLink = popup.document.createElement("link");
    fontLink.rel = "stylesheet";
    fontLink.href = "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap";
    popup.document.head.appendChild(fontLink);

    const container = popup.document.createElement("div");
    popup.document.body.appendChild(container);
    containerRef.current = container;

    popup.addEventListener("beforeunload", () => {
      windowRef.current = null;
      containerRef.current = null;
      setReady(false);
      onCloseRef.current();
    });

    setReady(true);

    return () => {
      closeWindow();
    };
  }, [open, closeWindow]);

  if (!open || !ready || !containerRef.current) return null;

  return createPortal(children, containerRef.current);
}
