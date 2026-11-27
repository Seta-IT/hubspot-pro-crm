'use client';

// Menu ⋮ > Emitir > NF-e / NFC-e / NFS-e no padrão GestãoClick, para a lista de
// Vendas de produtos. O módulo de Vendas pode reutilizar este componente.
// A ação de NF-e deve chamar GET /api/erp/vendas/:vendaId/nfe e abrir o
// ProductNfeForm com initialDraft / sourceSaleOrderId (ver sale-to-product-nfe.ts).

import React, { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import type { ErpFiscalInvoice, ErpSaleOrder } from '../../db/types';
import { findActiveProductNfeForSale } from '../../modules/erp/sale-to-product-nfe';

export function nfeLabelForSale(invoices: ErpFiscalInvoice[], sale: ErpSaleOrder): { invoice: ErpFiscalInvoice; label: string } | null {
  const inv = findActiveProductNfeForSale(invoices, sale.id, sale.code);
  if (!inv?.productNfe) return null;
  return { invoice: inv, label: `#${inv.productNfe.nNF}` };
}

export interface SaleEmitFiscalMenuProps {
  sale: ErpSaleOrder;
  invoices?: ErpFiscalInvoice[];
  onEmitNfe: (sale: ErpSaleOrder) => void;
  onSoon?: (kind: 'NFCE' | 'NFSE') => void;
  disabled?: boolean;
}

export default function SaleEmitFiscalMenu({ sale, onEmitNfe, onSoon, disabled }: SaleEmitFiscalMenuProps) {
  const [open, setOpen] = useState(false);
  const [emitOpen, setEmitOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setEmitOpen(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div className="relative inline-block text-left" ref={ref} data-testid={`sale-emit-menu-${sale.id}`}>
      <button
        type="button"
        aria-label={`Ações da venda #${sale.code}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setOpen((v) => !v);
          setEmitOpen(false);
        }}
        className="p-1 rounded hover:bg-slate-100 text-slate-600 cursor-pointer disabled:opacity-50"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-52 bg-white border border-slate-200 rounded shadow-lg py-1 text-xs"
        >
          <div className="relative">
            <button
              type="button"
              role="menuitem"
              className="w-full text-left px-3 py-1.5 hover:bg-slate-50 font-semibold text-slate-800"
              onMouseEnter={() => setEmitOpen(true)}
              onClick={() => setEmitOpen((v) => !v)}
            >
              Emitir
            </button>
            {emitOpen && (
              <div
                className="absolute right-full top-0 mr-0.5 w-44 bg-white border border-slate-200 rounded shadow-lg py-1"
                data-testid="sale-emit-submenu"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-50 font-semibold text-slate-800"
                  onClick={() => {
                    setOpen(false);
                    onEmitNfe(sale);
                  }}
                >
                  NF-e
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-50 text-slate-600"
                  onClick={() => {
                    setOpen(false);
                    onSoon?.('NFCE');
                  }}
                >
                  NFC-e <span className="text-[10px] text-slate-400">Em breve</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-50 text-slate-600"
                  onClick={() => {
                    setOpen(false);
                    onSoon?.('NFSE');
                  }}
                >
                  NFS-e <span className="text-[10px] text-slate-400">Em breve</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
