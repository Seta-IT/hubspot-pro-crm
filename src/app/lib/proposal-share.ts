import {
  ErpCommercialProposal,
  ErpProposalDigitalSignature,
  ErpProposalInstallment,
  ErpProposalItem,
} from '../../db/types';

export interface ProposalSlaOptionSpec {
  id: string;
  label: string;
  shortLabel: string;
  slaAvailabilityPercent: string;
  slaResponseHours: number;
  defaultClauseSnippet: string;
}

export const PROPOSAL_SLA_OPTIONS: ProposalSlaOptionSpec[] = [
  {
    id: 'SEM_SLA_ESPECIFICO',
    label: 'Selecione a opção de SLA... (Sem SLA específico por padrão)',
    shortLabel: '',
    slaAvailabilityPercent: '',
    slaResponseHours: 0,
    defaultClauseSnippet:
      'Suporte técnico conforme condições comerciais contratadas.',
  },
  {
    id: 'PADRAO_COMERCIAL_8H',
    label: 'SLA Padrão Comercial — Horário Comercial 8x5 (Atend. em até 8h úteis)',
    shortLabel: 'SLA Padrão Comercial (Atend. até 8h úteis)',
    slaAvailabilityPercent: '99,00%',
    slaResponseHours: 8,
    defaultClauseSnippet:
      'SLA Padrão Comercial (8x5, Seg-Sex das 08h às 18h) com atendimento remoto e presencial em até 8 horas úteis.',
  },
  {
    id: 'SLA_ESTENDIDO_6H',
    label: 'SLA Estendido 8x5 — Atendimento em até 6h úteis',
    shortLabel: 'SLA Estendido 8x5 (Atend. até 6h úteis)',
    slaAvailabilityPercent: '99,20%',
    slaResponseHours: 6,
    defaultClauseSnippet:
      'SLA Estendido 8x5 com atendimento técnico em até 6 horas úteis.',
  },
  {
    id: 'CORPORATIVO_8X5_NBD',
    label: 'SLA Corporativo 8x5 — Atendimento até 4h úteis / Reposição NBD (Dia Útil Seguinte)',
    shortLabel: 'SLA Corporativo 8x5 (Atend. 4h úteis / NBD)',
    slaAvailabilityPercent: '99,50%',
    slaResponseHours: 4,
    defaultClauseSnippet:
      'SLA Corporativo 8x5 (Seg-Sex 08h às 18h) com atendimento em até 4h úteis e reposição NBD (Next Business Day).',
  },
  {
    id: 'SLA_PRIORITARIO_4H',
    label: 'SLA Prioritário — Atendimento até 4h (Sob contratação / Custo adicional)',
    shortLabel: 'SLA Prioritário (Atend. até 4h)',
    slaAvailabilityPercent: '99,50%',
    slaResponseHours: 4,
    defaultClauseSnippet:
      'SLA Prioritário contratado com atendimento técnico em até 4h e substituição expressa de hardware.',
  },
  {
    id: 'NOC_24X7_CRITICO_2H',
    label: 'SLA Missão Crítica 24x7 — Atendimento até 2h (Sob contratação especial)',
    shortLabel: 'SLA Missão Crítica 24x7 (Atend. até 2h)',
    slaAvailabilityPercent: '99,98%',
    slaResponseHours: 2,
    defaultClauseSnippet:
      'SLA Missão Crítica 24x7 com primeiro atendimento em até 2h e Advance Replacement.',
  },
  {
    id: 'SEM_SLA_AVULSO',
    label: 'Garantia Padrão / Atendimento Avulso sob Demanda',
    shortLabel: 'Garantia Padrão (Sob Demanda)',
    slaAvailabilityPercent: 'Sob Demanda',
    slaResponseHours: 24,
    defaultClauseSnippet:
      'Garantia técnica legal do fabricante/fornecedor com suporte avulso sob demanda.',
  },
];


export interface ProposalTemplateOptionSpec {
  id:
    | 'FOLHA_ORCAMENTO'
    | 'EXECUTIVO_CORPORATIVO'
    | 'DESIGN_CONSULTORIA'
    | 'INSTITUCIONAL_SETA_TELECOM';
  label: string;
  shortLabel: string;
  description: string;
}

export const PROPOSAL_TEMPLATE_STYLE_OPTIONS: ProposalTemplateOptionSpec[] = [
  {
    id: 'FOLHA_ORCAMENTO',
    label: '1. Folha de Orçamento Direta (Comercial & Objetiva)',
    shortLabel: 'Folha de Orçamento Direta',
    description:
      'Design estilo folha de orçamento comercial: cabeçalho compacto em grade, tabela direta de itens e quantidades, totalização imediata e aceite na mesma folha.',
  },
  {
    id: 'EXECUTIVO_CORPORATIVO',
    label: '2. Proposta Corporativa Executiva (B2B Formal)',
    shortLabel: 'Corporativo Executivo B2B',
    description:
      'Layout executivo formal com Quadro de Resumo Financeiro em destaque no topo, blocos de Proponente e Destinatário, condições contratuais e assinatura digital.',
  },
  {
    id: 'DESIGN_CONSULTORIA',
    label: '3. Proposta de Consultoria & Arquitetura Técnica',
    shortLabel: 'Design de Consultoria Técnica',
    description:
      'Estrutura consultiva numerada por seções (01. Diagnóstico & Escopo, 02. Metodologia de Implantação em 4 Etapas, 03. Investimento & Ativos, 04. Formalização).',
  },
  {
    id: 'INSTITUCIONAL_SETA_TELECOM',
    label: '4. Institucional Seta Telecom + Portfólio de Tecnologias + Folha de Orçamento',
    shortLabel: 'Institucional Seta + Tecnologias + Orçamento',
    description:
      'Apresenta no início uma introdução sobre a Seta Telecom e os serviços e tecnologias em que atua (PABX IP/VoIP, SD-WAN/Redes, Wi-Fi 6/Switches PoE, Locação HaaS & Suporte) antes de trazer a Folha de Orçamento completa.',
  },
];

export const SETA_TELECOM_PORTFOLIO_PILLARS = [
  {
    code: 'VOIP_PABX_UC',
    title: 'Telefonia IP, PABX Cloud & Comunicação Unificada',
    subtitle: 'Voz Corporativa de Alta Disponibilidade',
    items: [
      'Centrais PABX IP Seta Cloud (Cluster / High-Availability) e Appliances dedicados',
      'Gateways de Voz E1 / SIP / FXO / FXS e sobrevivência de chamadas',
      'Terminais IP Gigabit PoE (Yealink, Grandstream, Cisco) e headsets corporativos',
      'URA inteligente, gravação de chamadas, filas de atendimento e tarifação',
    ],
  },
  {
    code: 'SDWAN_SECURITY',
    title: 'Conectividade Corporativa, SD-WAN & Segurança de Borda',
    subtitle: 'Continuidade de Negócios e Tráfego Crítico',
    items: [
      'Roteadores Corporativos (Cisco ISR, FortiGate, Mikrotik Enterprise)',
      'Arquitetura SD-WAN com balanceamento e failover automático Dual-WAN / 5G',
      'Firewalls Next-Generation (NGFW / UTM), VPN Site-to-Site e Client-to-Site',
      'Priorização inteligente de tráfego (QoS) para voz, vídeo e ERP em nuvem',
    ],
  },
  {
    code: 'INFRA_SWITCH_WIFI',
    title: 'Infraestrutura de Redes, Switches PoE+ & Wi-Fi 6 Corporativo',
    subtitle: 'Switching L2/L3 e Cobertura de Alta Densidade',
    items: [
      'Switches Gerenciáveis L2/L3 Gigabit e 10G com alimentação PoE/PoE+',
      'Projetos de Wi-Fi 6 Corporativo para escritórios, indústrias e centros logísticos',
      'Segmentação lógica de redes (VLANs), cabeamento estruturado e certificação',
      'Sistemas de energia ininterrupta (Nobreaks Online Dupla Conversão para racks)',
    ],
  },
  {
    code: 'HAAS_NOC_SERVICES',
    title: 'Locação de Ativos (HaaS) & Engenharia / Suporte Especializado',
    subtitle: 'Outsourcing de Hardware e Gestão Fim a Fim',
    items: [
      'Locação pura de equipamentos TI/Telecom (100% OPEX • Súmula Vinculante 31 STF)',
      'Implantação técnica assistida, homologação de troncos SIP e migração sem parada',
      'Monitoramento proativo, manutenção preventiva e corretiva especializada',
      'Substituição expressa de equipamentos e gestão completa do ciclo de vida',
    ],
  },
] as const;

export const PROPOSAL_DELIVERY_SUGGESTIONS: string[] = [
  '5 dias úteis após o aceite',
  '7 dias úteis após o aceite',
  '10 dias úteis após o aceite',
  '15 dias úteis após o aceite',
  '20 dias úteis após o aceite',
  '30 dias corridos após o aceite',
  'Entrega imediata (estoque disponível)',
  'A definir conforme cronograma do projeto',
];

export function resolveProposalDeliveryLeadTime(
  prop: Partial<ErpCommercialProposal>
): string {
  const raw = String(prop.deliveryLeadTime ?? prop.deliveryForecast ?? '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (
    lower.includes('até 48') ||
    lower.includes('ate 48') ||
    lower.includes('48 horas') ||
    lower.includes('48h')
  ) {
    return '';
  }
  return raw;
}

export function resolveProposalLayoutKind(
  templateStyle?: string
): 'FOLHA_ORCAMENTO' | 'EXECUTIVO_CORPORATIVO' | 'DESIGN_CONSULTORIA' | 'INSTITUCIONAL_SETA_TELECOM' {
  if (templateStyle === 'FOLHA_ORCAMENTO') return 'FOLHA_ORCAMENTO';
  if (templateStyle === 'EXECUTIVO_CORPORATIVO') return 'EXECUTIVO_CORPORATIVO';
  if (templateStyle === 'DESIGN_CONSULTORIA' || templateStyle === 'LOCACAO_DETALHADA_SLA') {
    return 'DESIGN_CONSULTORIA';
  }
  return 'INSTITUCIONAL_SETA_TELECOM';
}

export interface ProposalSellerContactInfo {
  name: string;
  email: string;
  phone: string;
}

export const PROPOSAL_SELLER_DIRECTORY: ProposalSellerContactInfo[] = [
  {
    name: 'Marcelo Lopes Mira',
    email: 'marcelo.mira@setatelecom.com.br',
    phone: '(11) 99999-4929',
  },
  {
    name: 'Marcelo Mira',
    email: 'marcelo.mira@setatelecom.com.br',
    phone: '(11) 99999-4929',
  },
  {
    name: 'Evelyn Olivia de Rosa Ternero',
    email: 'evelyn@setatelecom.com.br',
    phone: '(11) 98888-4929',
  },
  {
    name: 'Evelyn Ternero Seta Telecom',
    email: 'evelyn@setatelecom.com.br',
    phone: '(11) 98888-4929',
  },
  {
    name: 'Maria Luiza',
    email: 'marialuiza@setatelecom.com.br',
    phone: '(11) 98888-4930',
  },
  {
    name: 'Michelle da Rocha',
    email: 'michelle.rocha@setatelecom.com.br',
    phone: '(11) 3957-0498',
  },
  {
    name: 'Paula Campos',
    email: 'paula.campos@setatelecom.com.br',
    phone: '(11) 98888-4931',
  },
  {
    name: 'Wesley Brito',
    email: 'wesley@setatelecom.com.br',
    phone: '(11) 98888-4932',
  },
  {
    name: 'Dauana Magnavita de Alencar',
    email: 'dauana@setatelecom.com.br',
    phone: '(11) 98888-4933',
  },
];

export function resolveProposalSellerContact(
  prop: Partial<ErpCommercialProposal>
): ProposalSellerContactInfo {
  const rawName = String(prop.sellerName || '').trim() || 'Marcelo Lopes Mira';
  const lower = rawName.toLowerCase();
  const matched =
    PROPOSAL_SELLER_DIRECTORY.find(
      (s) =>
        s.name.toLowerCase() === lower ||
        lower.includes(s.name.toLowerCase()) ||
        s.name.toLowerCase().includes(lower)
    ) || PROPOSAL_SELLER_DIRECTORY[0];

  const rawEmail = String(prop.sellerEmail || '').trim();
  const email =
    rawEmail && rawEmail.toLowerCase() !== 'comercial@setatelecom.com.br'
      ? rawEmail
      : matched.email;

  const rawPhone = String(prop.sellerPhone || '').trim();
  const phone =
    rawPhone && rawPhone !== '(11) 3958-4929'
      ? rawPhone
      : matched.phone;

  return {
    name: rawName,
    email,
    phone,
  };
}

export function cleanProposalPaymentCondition(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/\s*•?\s*Canal:\s*[^•]+/gi, '')
    .replace(/\s*•?\s*Centro de Custo:\s*[^•]+/gi, '')
    .replace(/\s*•?\s*Cliente Recorrente/gi, '')
    .replace(/^[\s•]+|[\s•]+$/g, '')
    .trim();
}

export function resolveProposalSlaOption(
  prop: Partial<ErpCommercialProposal>
): ProposalSlaOptionSpec {
  if (
    !prop.slaTier ||
    prop.slaTier === 'SEM_SLA_ESPECIFICO' ||
    prop.slaTier === 'NOC_24X7_ALTA_DISP_4H' ||
    prop.slaTier.includes('NOC 24x7 • 99,95%')
  ) {
    return PROPOSAL_SLA_OPTIONS[0];
  }
  const byIdOrLabel = PROPOSAL_SLA_OPTIONS.find(
    (o) =>
      o.id === prop.slaTier ||
      o.label.toLowerCase() === prop.slaTier?.toLowerCase() ||
      (o.shortLabel && o.shortLabel.toLowerCase() === prop.slaTier?.toLowerCase())
  );
  if (byIdOrLabel) return byIdOrLabel;
  return PROPOSAL_SLA_OPTIONS[0];
}

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

export function normalizeProposalItemUnit(
  rawUnit: string | undefined,
  itemType: 'PRODUCT' | 'SERVICE'
): string {
  const upper = String(rawUnit || '').trim().toUpperCase();
  if (!upper || upper === 'MÊS' || upper === 'MES' || upper === 'MESES') {
    return itemType === 'SERVICE' ? 'SV' : 'UN';
  }
  return String(rawUnit).trim();
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
      unit: normalizeProposalItemUnit(it.unit, itemType),
      quantity: qty,
      unitPrice,
      discountPercent: discPct,
      discountAmount: discAmt,
      subtotal: net,
      totalMonthly: net,
    };
  });

  const productsSubtotal =
    Math.round(
      items
        .filter((i) => inferProposalItemType(i) === 'PRODUCT')
        .reduce((s, i) => s + Number(i.subtotal ?? i.totalMonthly ?? 0), 0) * 100
    ) / 100;

  const servicesSubtotal =
    Math.round(
      items
        .filter((i) => inferProposalItemType(i) === 'SERVICE')
        .reduce((s, i) => s + Number(i.subtotal ?? i.totalMonthly ?? 0), 0) * 100
    ) / 100;

  const recGross = items
    .filter((i) => i.isRecurring !== false)
    .reduce((s, i) => s + Number(i.totalMonthly || 0), 0);
  const setupItemsGross = items
    .filter((i) => i.isRecurring === false)
    .reduce((s, i) => s + Number(i.totalMonthly || 0), 0);

  const discountAmount = Math.max(0, Number(next.discountAmount || 0));
  const discountPercentGlobal = Math.max(0, Math.min(100, Number(next.discountPercentGlobal || 0)));
  const shippingCost = Math.max(0, Number(next.shippingCost || 0));
  const contractMonths = Math.max(1, Number(next.contractMonths || 24));

  // Setup isolado do frete:
  const explicitSetupFee =
    next.setupFee !== undefined
      ? Math.max(0, Number(next.setupFee || 0))
      : setupItemsGross === 0 && Number(next.oneTimeSetupTotal || 0) > 0
        ? Math.max(0, Number(next.oneTimeSetupTotal || 0))
        : 0;

  const rawSetupSum = setupItemsGross + explicitSetupFee;

  const monthlyRecurringTotal =
    recGross > 0
      ? Math.max(
          0,
          Math.round((recGross - discountAmount - (recGross * discountPercentGlobal) / 100) * 100) /
            100
        )
      : 0;

  // Setup NUNCA é somado ao frete:
  const oneTimeSetupTotal =
    recGross > 0
      ? Math.max(0, Math.round(rawSetupSum * 100) / 100)
      : Math.max(
          0,
          Math.round(
            (rawSetupSum - discountAmount - (rawSetupSum * discountPercentGlobal) / 100) * 100
          ) / 100
        );

  const totalContractValue =
    Math.round((monthlyRecurringTotal * contractMonths + oneTimeSetupTotal + shippingCost) * 100) /
    100;

  const inferredBudgetType =
    next.budgetType ||
    (productsSubtotal > 0 && servicesSubtotal > 0
      ? 'CONJUNTO'
      : servicesSubtotal > 0 && productsSubtotal === 0
        ? 'SERVICOS'
        : items.some((i) => i.fiscalNature === 'LOCACAO_BENS_MOVEIS')
          ? 'LOCACAO'
          : 'PRODUTOS');

  const resolvedSla = resolveProposalSlaOption(next);
  const sellerInfo = resolveProposalSellerContact(next);
  const cleanedPaymentCondition = cleanProposalPaymentCondition(next.paymentCondition);
  const resolvedDeliveryLeadTime = resolveProposalDeliveryLeadTime(next);

  return {
    ...next,
    sellerName: sellerInfo.name,
    sellerEmail: next.sellerEmail ? sellerInfo.email : sellerInfo.email,
    sellerPhone: next.sellerPhone ? sellerInfo.phone : sellerInfo.phone,
    paymentCondition: cleanedPaymentCondition || next.paymentCondition || '',
    deliveryLeadTime: resolvedDeliveryLeadTime,
    deliveryForecast: resolvedDeliveryLeadTime,
    templateStyle: next.templateStyle || 'INSTITUCIONAL_SETA_TELECOM',
    slaTier: resolvedSla.id,
    slaAvailabilityPercent: resolvedSla.slaAvailabilityPercent,
    slaResponseHours: resolvedSla.slaResponseHours,
    setupFee: explicitSetupFee,
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
  ts?: string; // templateStyle
  sl?: string; // slaTier
  sa?: string; // slaAvailabilityPercent
  sr?: number; // slaResponseHours
  sf?: number; // setupFee
  sn?: string; // storeName
  sc?: string; // salesChannel
  co?: string; // costCenter
  pd?: string; // proposalDate
  dl?: string; // deliveryLeadTime
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
  se?: string; // sellerEmail
  sp?: string; // sellerPhone
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
  ci?: string; // convertedContractId
  ds?: ErpProposalDigitalSignature | null; // digitalSignature
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
      ts: computed.templateStyle || 'INSTITUCIONAL_SETA_TELECOM',
      sl: computed.slaTier,
      sa: computed.slaAvailabilityPercent,
      sr: computed.slaResponseHours,
      sf: computed.setupFee || undefined,
      sn: computed.storeName,
      sc: computed.salesChannel,
      co: computed.costCenter,
      pd: computed.proposalDate,
      dl: computed.deliveryLeadTime || computed.deliveryForecast || undefined,
      df: computed.deliveryLeadTime || computed.deliveryForecast || undefined,
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
      se: computed.sellerEmail,
      sp: computed.sellerPhone,
      st: computed.status,
      m: computed.contractMonths || 24,
      pc: cleanProposalPaymentCondition(computed.paymentCondition) || 'Boleto / PIX — Vencimento dia 10',
      vu: computed.validUntil || new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
      mr: computed.monthlyRecurringTotal,
      ot: computed.oneTimeSetupTotal || 0,
      tv: computed.totalContractValue,
      no: (computed.commercialNotes || '').slice(0, 500),
      tc: (computed.technicalClauses || '').slice(0, 500),
      ca: computed.createdAt || new Date().toISOString(),
      ci: computed.convertedContractId || undefined,
      ds: computed.digitalSignature || undefined,
      it: (computed.items || []).map((item) => ({
        k: item.sku,
        d: item.description,
        ty: item.itemType,
        un: normalizeProposalItemUnit(item.unit, inferProposalItemType(item)),
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
            unit: normalizeProposalItemUnit(it.un, itemType),
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
      templateStyle:
        (p.ts as ErpCommercialProposal['templateStyle']) || 'INSTITUCIONAL_SETA_TELECOM',
      slaTier: p.sl || undefined,
      slaAvailabilityPercent: p.sa || undefined,
      slaResponseHours: p.sr !== undefined ? Number(p.sr) : undefined,
      setupFee: p.sf !== undefined ? Number(p.sf) : undefined,
      storeName: p.sn || undefined,
      salesChannel: p.sc || undefined,
      costCenter: p.co || undefined,
      proposalDate: p.pd || (p.ca ? p.ca.slice(0, 10) : new Date().toISOString().slice(0, 10)),
      deliveryLeadTime: resolveProposalDeliveryLeadTime({ deliveryLeadTime: p.dl, deliveryForecast: p.df }),
      deliveryForecast: resolveProposalDeliveryLeadTime({ deliveryLeadTime: p.dl, deliveryForecast: p.df }),
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
      sellerEmail: p.se || undefined,
      sellerPhone: p.sp || undefined,
      status: (p.st as ErpCommercialProposal['status']) || 'ENVIADA',
      contractMonths: Number(p.m || 24),
      paymentCondition: cleanProposalPaymentCondition(p.pc) || 'Boleto / PIX — Vencimento dia 10',
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
        'Condições comerciais e técnicas conforme escopo contratado.',
      convertedContractId: p.ci || null,
      convertedInvoiceId: null,
      digitalSignature: p.ds || null,
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

export const normalizeProposalTemplateStyle = resolveProposalLayoutKind;
export const PROPOSAL_DELIVERY_LEAD_TIME_OPTIONS = PROPOSAL_DELIVERY_SUGGESTIONS;
export const SETA_TELECOM_INSTITUTIONAL_PILLARS = SETA_TELECOM_PORTFOLIO_PILLARS;
