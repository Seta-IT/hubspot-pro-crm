import { ErpCommercialProposal, ErpProposalItem } from '../../db/types';

export interface CompactProposalPayload {
  i: string; // id
  c: string; // code
  t: string; // title
  cn: string; // companyName
  cc: string; // companyCnpj
  ct: string; // contactName
  s: string; // sellerName
  st: string; // status
  m: number; // contractMonths
  pc: string; // paymentCondition
  vu: string; // validUntil
  mr: number; // monthlyRecurringTotal
  ot: number; // oneTimeSetupTotal
  tv: number; // totalContractValue
  no: string; // commercialNotes
  tc: string; // technicalClauses
  ca: string; // createdAt
  it: Array<{
    k: string; // sku
    d: string; // description
    fn: string; // fiscalNature
    nc: string; // ncmOrServiceCode
    q: number; // quantity
    u: number; // unitPrice
    r: number; // isRecurring (1 or 0)
    tm: number; // totalMonthly
  }>;
}

export function encodeProposalToQueryParam(prop: ErpCommercialProposal): string {
  try {
    const compact: CompactProposalPayload = {
      i: prop.id,
      c: prop.code,
      t: prop.title,
      cn: prop.companyName,
      cc: prop.companyCnpj || '00.000.000/0001-00',
      ct: prop.contactName || 'Decisor Comercial',
      s: prop.sellerName || 'Marcelo Lopes Mira',
      st: prop.status,
      m: prop.contractMonths || 24,
      pc: prop.paymentCondition || 'Boleto / PIX — Vencimento dia 10',
      vu: prop.validUntil || new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
      mr: prop.monthlyRecurringTotal,
      ot: prop.oneTimeSetupTotal || 0,
      tv: prop.totalContractValue,
      no: (prop.commercialNotes || '').slice(0, 500),
      tc: (prop.technicalClauses || '').slice(0, 500),
      ca: prop.createdAt || new Date().toISOString(),
      it: (prop.items || []).map((item) => ({
        k: item.sku,
        d: item.description,
        fn: item.fiscalNature,
        nc: item.ncmOrServiceCode,
        q: item.quantity,
        u: item.unitPrice,
        r: item.isRecurring ? 1 : 0,
        tm: item.totalMonthly,
      })),
    };
    const jsonStr = JSON.stringify(compact);
    if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
      return window.btoa(unescape(encodeURIComponent(jsonStr)));
    }
    return Buffer.from(jsonStr, 'utf-8').toString('base64');
  } catch {
    return '';
  }
}

export function decodeProposalFromQueryParam(encoded: string | null | undefined): ErpCommercialProposal | null {
  if (!encoded) return null;
  try {
    let jsonStr = '';
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
      jsonStr = decodeURIComponent(escape(window.atob(encoded)));
    } else {
      jsonStr = Buffer.from(encoded, 'base64').toString('utf-8');
    }
    const p = JSON.parse(jsonStr) as CompactProposalPayload;
    if (!p || !p.t || !p.cn) return null;

    const items: ErpProposalItem[] = Array.isArray(p.it)
      ? p.it.map((it, idx) => ({
          id: `item-${idx + 1}`,
          sku: it.k || `GC-${idx + 1}`,
          description: it.d || 'Item da Proposta',
          fiscalNature: (it.fn as ErpProposalItem['fiscalNature']) || 'LOCACAO_BENS_MOVEIS',
          ncmOrServiceCode: it.nc || 'NCM 8517.62.59',
          quantity: Number(it.q || 1),
          unitPrice: Number(it.u || 0),
          discountPercent: 0,
          isRecurring: it.r !== 0,
          totalMonthly: Number(it.tm || Number(it.q || 1) * Number(it.u || 0)),
        }))
      : [];

    return {
      id: p.i || 'prop-shared',
      code: p.c || 'PROP-SETA',
      title: p.t,
      companyId: null,
      companyName: p.cn,
      companyCnpj: p.cc || '00.000.000/0001-00',
      contactId: null,
      contactName: p.ct || 'Decisor Comercial',
      dealId: null,
      sellerName: p.s || 'Marcelo Lopes Mira',
      status: (p.st as ErpCommercialProposal['status']) || 'ENVIADA',
      contractMonths: Number(p.m || 24),
      paymentCondition: p.pc || 'Boleto / PIX — Vencimento dia 10',
      validUntil: p.vu || new Date().toISOString().slice(0, 10),
      items,
      monthlyRecurringTotal: Number(p.mr || 0),
      oneTimeSetupTotal: Number(p.ot || 0),
      totalContractValue: Number(p.tv || 0),
      commercialNotes:
        p.no ||
        'Faturamento mensal mediante Fatura/Recibo de Locação de Bens Móveis (dispensa legal de ISS conforme LC 116/2003 e Súmula Vinculante 31 do STF).',
      technicalClauses:
        p.tc ||
        'SLA 99,95% Seta Telecom com substituição expressa de hardware e suporte especializado.',
      convertedContractId: null,
      convertedInvoiceId: null,
      createdAt: p.ca || new Date().toISOString(),
      updatedAt: p.ca || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function buildPublicProposalUrl(
  prop: ErpCommercialProposal,
  options?: { autoPrint?: boolean; origin?: string }
): string {
  const baseOrigin =
    options?.origin ||
    (typeof window !== 'undefined' ? window.location.origin : 'https://hubspot-pro-crm-nu.vercel.app');
  const encoded = encodeProposalToQueryParam(prop);
  const params = new URLSearchParams();
  if (encoded) params.set('d', encoded);
  if (options?.autoPrint) params.set('print', '1');
  const qs = params.toString();
  return `${baseOrigin}/proposta/${encodeURIComponent(prop.id)}${qs ? `?${qs}` : ''}`;
}
