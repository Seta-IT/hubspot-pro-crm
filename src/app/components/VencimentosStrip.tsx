'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ExpirationItem, ExpirationNavTarget, UpcomingExpirationsResult } from '../../modules/erp/upcoming-expirations';

interface VencimentosStripProps {
  onNavigate: (target: ExpirationNavTarget) => void;
}

export default function VencimentosStrip({ onNavigate }: VencimentosStripProps) {
  const [data, setData] = useState<UpcomingExpirationsResult | null>(null);

  const load = useCallback(() => {
    fetch('/api/erp/vencimentos', { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const next = j && j.data && typeof j.data === 'object' ? (j.data as UpcomingExpirationsResult) : null;
        setData(next && Array.isArray(next.items) ? next : null);
      })
      .catch(() => {
        setData(null);
      });
  }, []);

  useEffect(() => {
    let alive = true;
    const run = () => {
      if (alive) load();
    };
    run();
    const id = window.setInterval(run, 60_000);
    const onFocus = () => run();
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  if (!data || !data.text || data.items.length === 0) return null;

  return (
    <div
      data-testid="sti-vencimentos-strip"
      role="status"
      className="border-b px-3 sm:px-5 py-1.5 text-[12px] leading-snug"
      style={{ backgroundColor: '#fff8eb', borderColor: '#e6d2a8', color: '#1e3a6e' }}
    >
      <div className="max-w-[1680px] mx-auto flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="font-semibold shrink-0">Vencimentos nos próximos {data.windowDays} dias:</span>
        {data.items.map((item: ExpirationItem, index: number) => (
          <span key={item.kind} className="inline-flex items-center gap-x-1.5">
            {index > 0 ? <span aria-hidden="true" className="text-[#1e3a6e]/35">•</span> : null}
            <button
              type="button"
              onClick={() => onNavigate(item.target)}
              className="font-medium underline decoration-[#1e3a6e]/30 underline-offset-2 hover:decoration-[#1e3a6e] cursor-pointer"
            >
              {item.label}
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
