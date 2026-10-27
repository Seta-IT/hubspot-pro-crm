import {
  ErpCommercialProposal,
  ErpProposalInstallment,
  ErpProposalItem,
} from '../../db/types';

export function inferProposalItemType(item: Partial<ErpProposalItem>): 'PRODUCT' | 'SERVICE' {
  if (item.itemType === 'PRODUCT' || item.itemType === 'SERVICE') {
    return item.itemType;
  }
  if (
    item.fiscalNature === 'SERVICO_TECNICO_TI_TELECOM' ||
    item.fiscalNature === 'SERVICO_COMUNICACAO_SCM_SVA'
  ) {
    return 'SERVICE';
  }
  return 'PRODUCT';
}

export function computeProposalTotals(next: ErpCommercialProposal): ErpCommercialProposal {
  const items: ErpProposalItem[] = (next.items || []).map((it) => {
    const itemType = inferProposalItemType(it);
    const qty = Math.max(1, Number(it.quantity || 1));
    const unitPrice = Math.max(0, Number(it.unitPrice || 0));
    const discPct = Math.max(0, Math.min(100, Number(it.discountPercent || 0)));
    const discAmt = Math.max(0, Number(it.discountAmount || 0));
    const gross = qty * unitPrice;
    const net = Math.max(0, Math.round((gross * (1 - discPct / 100) - discAmt) * 100) / 100);
    return {
      ...it,
      itemType,
      unit: it.unit || (itemType === 'SERVICE' ? 'SV' : it.isRecurring !== false ? 'MÊS' : 'UN'),
      quantity: qty,
      unitPrice,
      discountPercent: discPct,
      discountAmount: discAmt,
      subtotal: net,
      totalMonthly: net,
    };
  });

  const productsSubtotal = Math.round(
    items
      .filter((i) => inferProposalItemType(i) === 'PRODUCT')
      .reduce((s, i) => s + Number(i.subtotal ?? i.totalMonthly ?? 0), 0) * 100
  ) / 100;

  const servicesSubtotal = Math.round(
    items
      .filter((i) => inferProposalItemType(i) === 'SERVICE')
      .reduce((s, i) => s + Number(i.subtotal ?? i.totalMonthly ?? 0), 0) * 100
  ) / 100;

  const recGross = items
    .filter((i) => i.isRecurring !== false)
    .reduce((s, i) => s + Number(i.totalMonthly || 0), 0);
  const setupGross = items
    .filter((i) => i.isRecurring === false)
    .reduce((s, i) => s + Number(i.totalMonthly || 0), 0);

  const discountAmount = Math.max(0, Number(next.discountAmount || 0));
  const discountPercentGlobal = Math.max(0, Math.min(100, Number(next.discountPercentGlobal || 0)));
  const shippingCost = Math.max(0, Number(next.shippingCost || 0));
  const contractMonths = Math.max(1, Number(next.contractMonths || 24));

  const monthlyRecurringTotal =
    recGross > 0
      ? Math.max(
          0,
          Math.round((recGross - discountAmount - (recGross * discountPercentGlobal) / 100) * 100) /
            100
        )
      : 0;

  const oneTimeSetupTotal =
    recGross > 0
      ? Math.max(0, Math.round((setupGross + shippingCost) * 100) / 100)
      : Math.max(
          0,
          Math.round(
            (setupGross - discountAmount - (setupGross * discountPercentGlobal) / 100 + shippingCost) *
              100
          ) / 100
        );

  const totalContractValue =
    Math.round((monthlyRecurringTotal * contractMonths + oneTimeSetupTotal) * 100) / 100;

  const inferredBudgetType =
    next.budgetType ||
    (productsSubtotal > 0 && servicesSubtotal > 0
      ? 'CONJUNTO'
      : servicesSubtotal > 0 && productsSubtotal === 0
        ? 'SERVICOS'
        : items.some((i) => i.fiscalNature === 'LOCACAO_BENS_MOVEIS')
          ? 'LOCACAO'
          : 'PRODUTOS');

  return {
    ...next,
    budgetType: inferredBudgetType,
    items,
    contractMonths,
    discountAmount,
    discountPercentGlobal,
    shippingCost,
    productsSubtotal,
    servicesSubtotal,
    monthlyRecurringTotal,
    oneTimeSetupTotal,
    totalContractValue,
  };
}

export interface CompactProposalPayload {
  i: string; // id
  v?: number; // version
  c: string; // code
  t: string; // title
  bt?: string; // budgetType
  sn?: string; // storeName
  sc?: string; // salesChannel
  co?: string; // costCenter
  pd?: string; // proposalDate
  df?: string; // deliveryForecast
  cf?: string; // careOf
  ce?: string; // contactEmail
  in?: string; // introductionText
  sh?: number; // shippingCost
  cr?: string; // shippingCarrier
  da?: string; // deliveryAddress
  dc?: number; // discountAmount
  dp?: number; // discountPercentGlobal
  ps?: number; // productsSubtotal
  ss?: number; // servicesSubtotal
  md?: string; // modality
  ri?: string; // readjustmentIndex
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
    ty?: string; // itemType
    un?: string; // unit
    fn: string; // fiscalNature
    nc: string; // ncmOrServiceCode
    q: number; // quantity
    u: number; // unitPrice
    dp?: number; // discountPercent
    da?: number; // discountAmount
    sb?: number; // subtotal
    r: number; // isRecurring (1 or 0)
    tm: number; // totalMonthly
  }>;
  ins?: Array<{
    n: number;
    d: string;
    a: number;
    p: string;
    o?: string;
  }>;
}

export function encodeProposalToQueryParam(prop: ErpCommercialProposal): string {
  try {
    const computed = computeProposalTotals(prop);
    const compact: CompactProposalPayload = {
      i: computed.id,
      v: computed.version || 1,
      c: computed.code,
      t: computed.title,
      bt: computed.budgetType,
      sn: computed.storeName,
      sc: computed.salesChannel,
      co: computed.costCenter,
      pd: computed.proposalDate,
      df: computed.deliveryForecast,
      cf: computed.careOf,
      ce: computed.contactEmail,
      in: computed.introductionText ? computed.introductionText.slice(0, 450) : undefined,
      sh: computed.shippingCost || undefined,
      cr: computed.shippingCarrier,
      da: computed.deliveryAddress ? computed.deliveryAddress.slice(0, 250) : undefined,
      dc: computed.discountAmount || undefined,
      dp: computed.discountPercentGlobal || undefined,
      ps: computed.productsSubtotal,
      ss: computed.servicesSubtotal,
      md: computed.modality,
      ri: computed.readjustmentIndex,
      cn: computed.companyName,
      cc: computed.companyCnpj || '00.000.000/0001-00',
      ct: computed.contactName || 'Decisor Comercial',
      s: computed.sellerName || 'Marcelo Lopes Mira',
      st: computed.status,
      m: computed.contractMonths || 24,
      pc: computed.paymentCondition || 'Boleto / PIX — Vencimento dia 10',
      vu: computed.validUntil || new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
      mr: computed.monthlyRecurringTotal,
      ot: computed.oneTimeSetupTotal || 0,
      tv: computed.totalContractValue,
      no: (computed.commercialNotes || '').slice(0, 500),
      tc: (computed.technicalClauses || '').slice(0, 500),
      ca: computed.createdAt || new Date().toISOString(),
      it: (computed.items || []).map((item) => ({
        k: item.sku,
        d: item.description,
        ty: item.itemType,
        un: item.unit,
        fn: item.fiscalNature,
        nc: item.ncmOrServiceCode,
        q: item.quantity,
        u: item.unitPrice,
        dp: item.discountPercent || undefined,
        da: item.discountAmount || undefined,
        sb: item.subtotal ?? item.totalMonthly,
        r: item.isRecurring ? 1 : 0,
        tm: item.totalMonthly,
      })),
      ins:
        Array.isArray(computed.installments) && computed.installments.length > 0
          ? computed.installments.slice(0, 36).map((inst) => ({
              n: inst.number,
              d: inst.dueDate,
              a: inst.amount,
              p: inst.paymentMethod,
              o: inst.notes,
            }))
          : undefined,
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
      ? p.it.map((it, idx) => {
          const fn = (it.fn as ErpProposalItem['fiscalNature']) || 'LOCACAO_BENS_MOVEIS';
          const itemType =
            (it.ty as 'PRODUCT' | 'SERVICE') ||
            (fn === 'SERVICO_TECNICO_TI_TELECOM' || fn === 'SERVICO_COMUNICACAO_SCM_SVA'
              ? 'SERVICE'
              : 'PRODUCT');
          const qty = Number(it.q || 1);
          const unitPrice = Number(it.u || 0);
          const discPct = Number(it.dp || 0);
          const discAmt = Number(it.da || 0);
          const fallbackTotal = Math.max(
            0,
            Math.round((qty * unitPrice * (1 - discPct / 100) - discAmt) * 100) / 100
          );
          const tm = Number(it.tm ?? it.sb ?? fallbackTotal);
          return {
            id: `item-${idx + 1}`,
            sku: it.k || `GC-${idx + 1}`,
            description: it.d || 'Item da Proposta',
            itemType,
            unit: it.un || (itemType === 'SERVICE' ? 'SV' : it.r !== 0 ? 'MÊS' : 'UN'),
            fiscalNature: fn,
            ncmOrServiceCode: it.nc || 'NCM 8517.62.59',
            quantity: qty,
            unitPrice,
            discountPercent: discPct,
            discountAmount: discAmt,
            subtotal: Number(it.sb ?? tm),
            isRecurring: it.r !== 0,
            totalMonthly: tm,
          };
        })
      : [];

    const installments: ErpProposalInstallment[] = Array.isArray(p.ins)
      ? p.ins.map((inst, idx) => ({
          number: Number(inst.n || idx + 1),
          dueDate: inst.d || new Date().toISOString().slice(0, 10),
          amount: Number(inst.a || 0),
          paymentMethod: inst.p || 'BOLETO',
          notes: inst.o,
        }))
      : [];

    return computeProposalTotals({
      id: p.i || 'prop-shared',
      version: p.v ? Number(p.v) : 1,
      code: p.c || 'PROP-SETA',
      title: p.t,
      budgetType: (p.bt as ErpCommercialProposal['budgetType']) || undefined,
      storeName: p.sn || 'Matriz',
      salesChannel: p.sc || 'Comercial B2B / Consultivo',
      costCenter: p.co || 'Comercial Telecom & TI',
      proposalDate: p.pd || (p.ca ? p.ca.slice(0, 10) : new Date().toISOString().slice(0, 10)),
      deliveryForecast: p.df || 'Imediato (até 48h úteis após aceite)',
      careOf: p.cf || p.ct || 'Decisor Comercial',
      contactEmail: p.ce || undefined,
      introductionText: p.in || undefined,
      shippingCost: Number(p.sh || 0),
      shippingCarrier: p.cr || undefined,
      deliveryAddress: p.da || undefined,
      discountAmount: Number(p.dc || 0),
      discountPercentGlobal: Number(p.dp || 0),
      productsSubtotal: p.ps !== undefined ? Number(p.ps) : undefined,
      servicesSubtotal: p.ss !== undefined ? Number(p.ss) : undefined,
      modality: (p.md as ErpCommercialProposal['modality']) || undefined,
      readjustmentIndex: (p.ri as ErpCommercialProposal['readjustmentIndex']) || undefined,
      installments,
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
    });
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
    (typeof window !== 'undefined' ? window.location.origin : 'https://sti-hub.vercel.app');
  const encoded = encodeProposalToQueryParam(prop);
  const params = new URLSearchParams();
  if (encoded) params.set('d', encoded);
  if (options?.autoPrint) params.set('print', '1');
  const qs = params.toString();
  return `${baseOrigin}/proposta/${encodeURIComponent(prop.id)}${qs ? `?${qs}` : ''}`;
}
