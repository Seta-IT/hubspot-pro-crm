'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface FixedMenuCoords {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  openUp: boolean;
}

/** Returns true when a scroll event should close the portal menu (page/table
 *  scroll). Scroll originating inside the menu itself must be ignored so the
 *  dropdown's overflow scrollbar can actually move. */
export function shouldClosePortalMenuOnScroll(
  eventTarget: EventTarget | null,
  menuEl: { contains?: (node: any) => boolean } | null
): boolean {
  if (!menuEl || eventTarget == null) return true;
  if (eventTarget === (menuEl as unknown)) return false;
  return typeof menuEl.contains !== 'function' || !menuEl.contains(eventTarget);
}

export function computeFixedMenuPosition(
  anchor: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>,
  opts?: {
    width?: number;
    estimatedHeight?: number;
    gap?: number;
    viewportWidth?: number;
    viewportHeight?: number;
    /** end = kebab (alinha à direita do âncora). stretch = mesma largura e alinhado à esquerda. */
    align?: 'end' | 'stretch';
    minWidth?: number;
  }
): FixedMenuCoords {
  const align = opts?.align ?? 'end';
  const vwDefault = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vhDefault = typeof window !== 'undefined' ? window.innerHeight : 800;
  const vw = opts?.viewportWidth ?? vwDefault;
  const vh = opts?.viewportHeight ?? vhDefault;
  const anchorWidth = Math.max(0, anchor.right - anchor.left);
  const minWidth = opts?.minWidth ?? (align === 'stretch' ? 0 : 200);
  const desiredWidth =
    align === 'stretch'
      ? Math.max(minWidth, opts?.width ?? anchorWidth, anchorWidth)
      : Math.max(minWidth, opts?.width ?? 240);
  const width = Math.min(desiredWidth, Math.max(80, vw - 16));
  const estHeight = opts?.estimatedHeight ?? 320;
  const gap = opts?.gap ?? 4;
  const spaceBelow = vh - anchor.bottom;
  const spaceAbove = anchor.top;
  const desiredHeight = Math.min(estHeight, vh * 0.7);
  const openUp = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
  const usable = Math.max(120, (openUp ? spaceAbove : spaceBelow) - 8);
  const maxHeight = Math.min(desiredHeight, usable);
  const top = openUp
    ? Math.max(8, anchor.top - maxHeight - gap)
    : Math.min(anchor.bottom + gap, Math.max(8, vh - maxHeight - 8));
  const left =
    align === 'stretch'
      ? Math.min(Math.max(8, anchor.left), Math.max(8, vw - width - 8))
      : Math.min(Math.max(8, anchor.right - width), Math.max(8, vw - width - 8));
  return { top, left, width, maxHeight, openUp };
}

export function FixedPortalMenu({
  open,
  onClose,
  anchorRef,
  children,
  width = 240,
  estimatedHeight = 320,
  testId,
  className = '',
  align = 'end',
  lockWidth = false,
  role = 'menu',
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  width?: number;
  estimatedHeight?: number;
  testId?: string;
  className?: string;
  align?: 'end' | 'stretch';
  lockWidth?: boolean;
  role?: React.AriaRole;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<FixedMenuCoords | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCoords(
      computeFixedMenuPosition(rect, {
        width: align === 'stretch' ? rect.width : width,
        estimatedHeight,
        align,
      })
    );
  }, [open, width, estimatedHeight, anchorRef, align]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onScrollOrResize = (e: Event) => {
      if (e.type === 'scroll' && !shouldClosePortalMenuOnScroll(e.target, menuRef.current)) {
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !coords || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={menuRef}
      role={role}
      data-testid={testId}
      className={`fixed max-h-[70vh] bg-white border border-slate-200 rounded-md shadow-xl py-1.5 text-left z-[1000] ${className}`}
      style={{
        top: coords.top,
        left: coords.left,
        width: lockWidth ? coords.width : undefined,
        minWidth: lockWidth ? undefined : coords.width,
        maxHeight: coords.maxHeight,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
      }}
    >
      {children}
    </div>,
    document.body
  );
}

export function RowKebabMenu({
  open,
  onOpenChange,
  children,
  width = 240,
  estimatedHeight = 320,
  testId,
  className = '',
  title = 'Mais ações',
  ariaLabel,
  triggerClassName,
  renderTrigger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  width?: number;
  estimatedHeight?: number;
  testId?: string;
  className?: string;
  title?: string;
  ariaLabel?: string;
  triggerClassName?: string;
  renderTrigger?: (args: {
    ref: React.Ref<HTMLButtonElement>;
    open: boolean;
    toggle: () => void;
  }) => React.ReactNode;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const toggle = () => onOpenChange(!open);
  const trigger = renderTrigger ? (
    renderTrigger({ ref: btnRef, open, toggle })
  ) : (
    <button
      ref={btnRef}
      type="button"
      title={title}
      aria-label={ariaLabel || title}
      aria-expanded={open}
      aria-haspopup="menu"
      onClick={toggle}
      className={
        triggerClassName ||
        'w-7 h-7 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 inline-flex items-center justify-center font-semibold transition cursor-pointer'
      }
    >
      ⋮
    </button>
  );

  return (
    <div className="inline-flex" onClick={(e) => e.stopPropagation()}>
      {trigger}
      <FixedPortalMenu
        open={open}
        onClose={() => onOpenChange(false)}
        anchorRef={btnRef}
        width={width}
        estimatedHeight={estimatedHeight}
        testId={testId}
        className={className}
      >
        {children}
      </FixedPortalMenu>
    </div>
  );
}
