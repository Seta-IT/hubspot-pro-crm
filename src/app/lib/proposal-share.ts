import {
  ErpCommercialProposal,
  ErpProposalDigitalSignature,
  ErpProposalInstallment,
  ErpProposalItem,
  ErpProposalVersionEntry,
  ErpProposalVersionSnapshot,
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
    id: 'CORPORATIVO_8X5_NBD',
    label: 'SLA 8x5 NBD',
    shortLabel: 'SLA 8x5 NBD',
    slaAvailabilityPercent: '99,50%',
    slaResponseHours: 4,
    defaultClauseSnippet:
      'SLA 8x5 NBD — Atendimento comercial 8x5 com reposição NBD (Next Business Day).',
  },
  {
    id: 'PADRAO_COMERCIAL_8H',
    label: 'SLA 8x5 NBD',
    shortLabel: 'SLA 8x5 NBD',
    slaAvailabilityPercent: '99,00%',
    slaResponseHours: 8,
    defaultClauseSnippet:
      'SLA 8x5 NBD — Atendimento comercial 8x5 com suporte técnico e reposição NBD.',
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
      'SLA Missão Crítica 24x7 com primeiro atendimento em até 2h.',
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

export type ProposalLightTemplateId =
  | 'CLEAN_CORPORATE_LIGHT'
  | 'MINIMAL_SWISS_PAPER'
  | 'EXECUTIVE_SOFT_INDIGO';

export type ProposalLegacyTemplateId =
  | 'FOLHA_ORCAMENTO'
  | 'EXECUTIVO_CORPORATIVO'
  | 'DESIGN_CONSULTORIA'
  | 'INSTITUCIONAL_SETA_TELECOM'
  | 'SETA_PREMIUM_TELECOM'
  | 'LOCACAO_DETALHADA_SLA';

export interface ProposalTemplateOptionSpec {
  id: ProposalLightTemplateId;
  label: string;
  shortLabel: string;
  description: string;
}

export const PROPOSAL_TEMPLATE_STYLE_OPTIONS: ProposalTemplateOptionSpec[] = [
  {
    id: 'CLEAN_CORPORATE_LIGHT',
    label: 'Opção 1 — Clean Corporate Light (Azul Suave & Ardósia Clara) [Padrão]',
    shortLabel: 'Opção 1 • Clean Corporate Light',
    description:
      'Cabeçalho em azul-claro acetinado, tabelas em ardósia suave (#f8fafc), linhas finas (1px), apresentação institucional Seta Telecom e fluxo de contratação em 7 etapas.',
  },
  {
    id: 'MINIMAL_SWISS_PAPER',
    label: 'Opção 2 — Minimal Swiss Paper (Branco Puro & Linhas Finas Cinza/Esmeralda)',
    shortLabel: 'Opção 2 • Minimal Swiss Paper',
    description:
      'Estética editorial 100% fundo branco, linhas horizontais ultra-finas (#e5e7eb), apresentação institucional Seta Telecom, fluxo em 7 etapas e máxima economia de impressão.',
  },
  {
    id: 'EXECUTIVE_SOFT_INDIGO',
    label: 'Opção 3 — Executive Soft Indigo (Tons Pastéis de Índigo & Tabelas Arejadas)',
    shortLabel: 'Opção 3 • Executive Soft Indigo',
    description:
      'Design consultivo B2B em tons pastéis de índigo (#eef2ff), bordas suaves (#e0e7ff), apresentação institucional Seta Telecom e fluxo de contratação em 7 etapas.',
  },
];

export const SETA_TELECOM_INSTITUTIONAL_SUMMARY = {
  eyebrow: 'Apresentação Institucional — Seta Telecom (setatelecom.com.br)',
  headline:
    'Seta Telecom & Seta | IT — Infraestrutura de TI, Redes, Segurança & Locação Corporativa (HaaS)',
  marketTimeLabel: 'Tempo de mercado',
  marketTime: 'Mais de 18 anos de atuação no mercado corporativo brasileiro;',
  locationLabel: 'Localização',
  location:
    'Sede em Alphaville, Campinas/SP (Rua Guapuruvu, 242 — 3º andar, CEP 13098-323), com estoque próprio de Spare Parts (+500 SKUs) em São Paulo e atendimento em todo o Brasil;',
  partnersLabel: 'Parceiros estratégicos (Multi-Vendor)',
  partners:
    'Cisco, Dell, HPE, Fortinet, Aruba, Palo Alto, SonicWall, Juniper, NetApp, Acronis, Lenovo e Meraki;',
  servicesTitle:
    'Serviços e Soluções — Portfólio Oficial Seta Telecom (setatelecom.com.br)',
} as const;

export const SETA_TELECOM_OFFICIAL_SERVICES_TOPICS: readonly string[] = [
  'Locação de Equipamentos de TI (HaaS — CAPEX Zero / OPEX)',
  'Switching Corporativo & Data Center (Cisco Catalyst, Nexus, Aruba, Fortinet)',
  'Roteadores & SD-WAN',
  'Cybersecurity & Firewalls NGFW Multi-Vendor',
  'Access Points & Wi-Fi Corporativo (Wi-Fi 6 / 6E / 7)',
  'Servidores (Dell PowerEdge, HPE ProLiant, Lenovo, Cisco UCS), Storages & Nobreaks',
  'Endpoints Corporativos (Notebooks & Desktops)',
  'NOC Gerenciado 24/7, Suporte Técnico L1+L2 & Manutenção de Redes',
  'Spare Parts Premium (+500 SKUs para substituição rápida) & Cobertura SmartNet / ProSupport',
  'Backup Imutável & Disaster Recovery (Acronis Cyber Protect / Compliance LGPD)',
] as const;

export const SETA_TELECOM_PORTFOLIO_PILLARS = [
  {
    code: 'HAAS_SERVERS_ENDPOINTS',
    title: 'Locação de Equipamentos de TI (HaaS — CAPEX Zero / OPEX)',
    subtitle: 'Servidores, Storages, Nobreaks & Endpoints Corporativos',
    items: [
      'Locação de Equipamentos de TI (HaaS — CAPEX Zero / OPEX)',
      'Servidores (Dell PowerEdge, HPE ProLiant, Lenovo, Cisco UCS), Storages & Nobreaks',
      'Endpoints Corporativos (Notebooks & Desktops)',
    ],
  },
  {
    code: 'SWITCHING_WIFI_ROUTING',
    title: 'Switching Corporativo, Roteadores, SD-WAN & Wi-Fi 6 / 6E / 7',
    subtitle: 'Infraestrutura de Redes & Data Center Multi-Vendor',
    items: [
      'Switching Corporativo & Data Center (Cisco Catalyst, Nexus, Aruba, Fortinet)',
      'Roteadores & SD-WAN',
      'Access Points & Wi-Fi Corporativo (Wi-Fi 6 / 6E / 7)',
    ],
  },
  {
    code: 'CYBERSECURITY_BACKUP_DR',
    title: 'Cybersecurity NGFW, Backup Imutável & Disaster Recovery',
    subtitle: 'Proteção de Borda & Continuidade de Negócios LGPD',
    items: [
      'Cybersecurity & Firewalls NGFW Multi-Vendor',
      'Backup Imutável & Disaster Recovery (Acronis Cyber Protect / Compliance LGPD)',
    ],
  },
  {
    code: 'NOC_24X7_SPARE_PARTS',
    title: 'NOC Gerenciado 24/7, Suporte L1+L2 & Spare Parts (+500 SKUs)',
    subtitle: 'Manutenção de Redes & Cobertura SmartNet / ProSupport',
    items: [
      'NOC Gerenciado 24/7, Suporte Técnico L1+L2 & Manutenção de Redes',
      'Spare Parts Premium (+500 SKUs para substituição rápida) & Cobertura SmartNet / ProSupport',
    ],
  },
] as const;

export const SETA_TELECOM_HIRING_FLOW_TITLE =
  'Fluxo de contratação de locação — Cliente Seta Telecom';

export interface SetaHiringFlowStep {
  step: number;
  title: string;
  description: string;
  fullText: string;
}

export const SETA_TELECOM_HIRING_FLOW_STEPS: readonly SetaHiringFlowStep[] = [
  {
    step: 1,
    title: 'Solicitar uma cotação',
    description:
      'O cliente informa quais equipamentos ou soluções precisa, as quantidades e o período desejado de locação.',
    fullText:
      '1. Solicitar uma cotação — O cliente informa quais equipamentos ou soluções precisa, as quantidades e o período desejado de locação.',
  },
  {
    step: 2,
    title: 'Receber a proposta comercial',
    description:
      'A Seta apresenta equipamentos, valores mensais, prazo contratual, SLA e condições de entrega.',
    fullText:
      '2. Receber a proposta comercial — A Seta apresenta equipamentos, valores mensais, prazo contratual, SLA e condições de entrega.',
  },
  {
    step: 3,
    title: 'Aprovar a proposta',
    description: 'O cliente confirma formalmente o aceite das condições comerciais.',
    fullText:
      '3. Aprovar a proposta — O cliente confirma formalmente o aceite das condições comerciais.',
  },
  {
    step: 4,
    title: 'Enviar documentação cadastral',
    description:
      'O cliente fornece dados da empresa, documentação necessária e informações do responsável legal para análise cadastral e financeira.',
    fullText:
      '4. Enviar documentação cadastral — O cliente fornece dados da empresa, documentação necessária e informações do responsável legal para análise cadastral e financeira.',
  },
  {
    step: 5,
    title: 'Assinar o contrato de locação',
    description:
      'Após aprovação cadastral, o representante legal assina eletronicamente o contrato.',
    fullText:
      '5. Assinar o contrato de locação — Após aprovação cadastral, o representante legal assina eletronicamente o contrato.',
  },
  {
    step: 6,
    title: 'Receber os equipamentos',
    description:
      'A Seta realiza a entrega no endereço acordado. O cliente confere e formaliza o recebimento.',
    fullText:
      '6. Receber os equipamentos — A Seta realiza a entrega no endereço acordado. O cliente confere e formaliza o recebimento.',
  },
  {
    step: 7,
    title: 'Iniciar a locação',
    description:
      'Começa a vigência operacional e o faturamento conforme as condições estabelecidas no contrato.',
    fullText:
      '7. Iniciar a locação — Começa a vigência operacional e o faturamento conforme as condições estabelecidas no contrato.',
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
): ProposalLightTemplateId {
  if (
    templateStyle === 'MINIMAL_SWISS_PAPER' ||
    templateStyle === 'FOLHA_ORCAMENTO'
  ) {
    return 'MINIMAL_SWISS_PAPER';
  }
  if (
    templateStyle === 'EXECUTIVE_SOFT_INDIGO' ||
    templateStyle === 'DESIGN_CONSULTORIA'
  ) {
    return 'EXECUTIVE_SOFT_INDIGO';
  }
  return 'CLEAN_CORPORATE_LIGHT';
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

export function cleanProposalTechnicalClauses(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .replace(
      /SLA\s*99,95%\s*com\s*substituiç[aã]o\s*expressa\s*de\s*hardware\s*\(Advance\s*Replacement\s*em\s*at[eé]\s*4h\s*na\s*Grande\s*SP\)\.\s*Vig[eê]ncia\s*de\s*24\s*meses\s*com\s*reajuste\s*anual\s*pelo\s*IPCA\.?/gi,
      ''
    )
    .replace(
      /SLA\s*99,95%\s*Seta\s*Telecom\s*com\s*substituiç[aã]o\s*expressa\s*de\s*hardware\.\s*Vig[eê]ncia\s*contratual\s*de\s*\d+\s*meses\.?/gi,
      ''
    )
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
  const cleanedTechnicalClauses = cleanProposalTechnicalClauses(next.technicalClauses);
  const resolvedDeliveryLeadTime = resolveProposalDeliveryLeadTime(next);

  return {
    ...next,
    sellerName: sellerInfo.name,
    sellerEmail: next.sellerEmail ? sellerInfo.email : sellerInfo.email,
    sellerPhone: next.sellerPhone ? sellerInfo.phone : sellerInfo.phone,
    paymentCondition: cleanedPaymentCondition || next.paymentCondition || '',
    technicalClauses: cleanedTechnicalClauses,
    deliveryLeadTime: resolvedDeliveryLeadTime,
    deliveryForecast: resolvedDeliveryLeadTime,
    templateStyle: next.templateStyle || 'CLEAN_CORPORATE_LIGHT',
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
      ts: computed.templateStyle || 'CLEAN_CORPORATE_LIGHT',
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
        (p.ts as ErpCommercialProposal['templateStyle']) || 'CLEAN_CORPORATE_LIGHT',
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
      technicalClauses: cleanProposalTechnicalClauses(p.tc),
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


export function buildSnapshotFromProposal(prop: ErpCommercialProposal): ErpProposalVersionSnapshot {
  const c = computeProposalTotals(prop);
  return {
    title: c.title || "",
    status: c.status || "ENVIADA",
    budgetType: c.budgetType,
    companyId: c.companyId ?? null,
    companyName: c.companyName || "",
    companyCnpj: c.companyCnpj || "",
    contactId: c.contactId ?? null,
    contactName: c.contactName || "",
    careOf: c.careOf || c.contactName || "",
    contactEmail: c.contactEmail,
    sellerName: c.sellerName || "Marcelo Lopes Mira",
    sellerEmail: c.sellerEmail,
    sellerPhone: c.sellerPhone,
    contractMonths: Number(c.contractMonths || 24),
    readjustmentIndex: c.readjustmentIndex || "IPCA",
    paymentCondition: c.paymentCondition || "",
    validUntil: c.validUntil || "",
    deliveryLeadTime: c.deliveryLeadTime ?? c.deliveryForecast ?? "",
    deliveryForecast: c.deliveryForecast ?? c.deliveryLeadTime ?? "",
    shippingCarrier: c.shippingCarrier || "",
    shippingCost: Number(c.shippingCost || 0),
    setupFee: Number(c.setupFee || 0),
    templateStyle: c.templateStyle,
    slaTier: c.slaTier,
    slaResponseHours: c.slaResponseHours,
    slaAvailabilityPercent: c.slaAvailabilityPercent,
    deliveryAddress: c.deliveryAddress || "",
    discountAmount: Number(c.discountAmount || 0),
    discountPercentGlobal: Number(c.discountPercentGlobal || 0),
    productsSubtotal: Number(c.productsSubtotal || 0),
    servicesSubtotal: Number(c.servicesSubtotal || 0),
    monthlyRecurringTotal: Number(c.monthlyRecurringTotal || 0),
    oneTimeSetupTotal: Number(c.oneTimeSetupTotal || 0),
    totalContractValue: Number(c.totalContractValue || 0),
    commercialNotes: c.commercialNotes || "",
    technicalClauses: c.technicalClauses || "",
    internalNotes: c.internalNotes || "",
    installments: Array.isArray(c.installments) ? structuredClone(c.installments) : [],
    items: Array.isArray(c.items) ? structuredClone(c.items) : [],
  };
}

export function proposalFromVersionSnapshot(
  baseProposal: ErpCommercialProposal,
  entry: ErpProposalVersionEntry
): ErpCommercialProposal {
  const s = entry.snapshot;
  return computeProposalTotals({
    ...baseProposal,
    version: entry.version,
    title: s.title || baseProposal.title,
    status: s.status || baseProposal.status,
    budgetType: s.budgetType || baseProposal.budgetType,
    companyId: s.companyId ?? baseProposal.companyId,
    companyName: s.companyName || baseProposal.companyName,
    companyCnpj: s.companyCnpj || baseProposal.companyCnpj,
    contactId: s.contactId ?? baseProposal.contactId,
    contactName: s.contactName || baseProposal.contactName,
    careOf: s.careOf || s.contactName || baseProposal.careOf,
    contactEmail: s.contactEmail ?? baseProposal.contactEmail,
    sellerName: s.sellerName || baseProposal.sellerName,
    sellerEmail: s.sellerEmail ?? baseProposal.sellerEmail,
    sellerPhone: s.sellerPhone ?? baseProposal.sellerPhone,
    contractMonths: Number(s.contractMonths || baseProposal.contractMonths || 24),
    readjustmentIndex: s.readjustmentIndex || baseProposal.readjustmentIndex || "IPCA",
    paymentCondition: s.paymentCondition ?? baseProposal.paymentCondition,
    validUntil: s.validUntil || baseProposal.validUntil,
    deliveryLeadTime: s.deliveryLeadTime ?? s.deliveryForecast ?? baseProposal.deliveryLeadTime,
    deliveryForecast: s.deliveryForecast ?? s.deliveryLeadTime ?? baseProposal.deliveryForecast,
    shippingCarrier: s.shippingCarrier ?? baseProposal.shippingCarrier,
    shippingCost: Number(s.shippingCost ?? baseProposal.shippingCost ?? 0),
    setupFee: s.setupFee !== undefined ? Number(s.setupFee) : baseProposal.setupFee,
    templateStyle: s.templateStyle || baseProposal.templateStyle || "CLEAN_CORPORATE_LIGHT",
    slaTier: s.slaTier || baseProposal.slaTier,
    slaResponseHours: s.slaResponseHours ?? baseProposal.slaResponseHours,
    slaAvailabilityPercent: s.slaAvailabilityPercent ?? baseProposal.slaAvailabilityPercent,
    deliveryAddress: s.deliveryAddress ?? baseProposal.deliveryAddress,
    discountAmount: Number(s.discountAmount ?? 0),
    discountPercentGlobal: Number(s.discountPercentGlobal ?? 0),
    productsSubtotal: s.productsSubtotal,
    servicesSubtotal: s.servicesSubtotal,
    monthlyRecurringTotal: Number(s.monthlyRecurringTotal || 0),
    oneTimeSetupTotal: Number(s.oneTimeSetupTotal || 0),
    totalContractValue: Number(s.totalContractValue || 0),
    commercialNotes: s.commercialNotes ?? baseProposal.commercialNotes,
    technicalClauses: s.technicalClauses ?? baseProposal.technicalClauses,
    internalNotes: s.internalNotes ?? baseProposal.internalNotes,
    installments: Array.isArray(s.installments) ? structuredClone(s.installments) : [],
    items: Array.isArray(s.items) ? structuredClone(s.items) : [],
  });
}

export function buildProposalVersionUrl(
  baseProposal: ErpCommercialProposal,
  entry: ErpProposalVersionEntry,
  options?: { autoPrint?: boolean; origin?: string }
): string {
  const baseOrigin =
    options?.origin ||
    (typeof window !== "undefined" ? window.location.origin : "https://sti-hub.vercel.app");
  const snapProposal = proposalFromVersionSnapshot(baseProposal, entry);
  const encoded = encodeProposalToQueryParam(snapProposal);
  const params = new URLSearchParams();
  if (encoded) params.set("d", encoded);
  params.set("v", String(entry.version));
  if (options?.autoPrint) params.set("print", "1");
  return `${baseOrigin}/proposta/${encodeURIComponent(baseProposal.id)}?${params.toString()}`;
}


export function appendClientProposalVersion(
  prev: ErpCommercialProposal,
  next: ErpCommercialProposal,
  customSummary?: string
): ErpCommercialProposal {
  const computedNext = computeProposalTotals(next);
  const existingHistory: ErpProposalVersionEntry[] =
    Array.isArray(prev.versionHistory) && prev.versionHistory.length > 0
      ? [...prev.versionHistory]
      : [
          {
            version: prev.version || 1,
            versionLabel: `v${prev.version || 1}.0`,
            savedAt: prev.createdAt || prev.updatedAt || new Date().toISOString(),
            savedBy: prev.sellerName || "Marcelo Lopes Mira",
            changedFields: ["Versão Original"],
            changeSummary: `Versão 1 (Original) — ${prev.contractMonths || 24} meses`,
            snapshot: buildSnapshotFromProposal(prev),
          },
        ];

  const maxVer = existingHistory.reduce((m, e) => Math.max(m, Number(e.version || 1)), Number(prev.version || 1));
  const nextVer = maxVer + 1;
  const nowIso = new Date().toISOString();
  const newEntry: ErpProposalVersionEntry = {
    version: nextVer,
    versionLabel: `v${nextVer}.0`,
    savedAt: nowIso,
    savedBy: computedNext.sellerName || prev.sellerName || "Marcelo Lopes Mira",
    changedFields: ["Revisão da Proposta"],
    changeSummary:
      customSummary ||
      `Versão ${nextVer} — ${computedNext.contractMonths} meses • ${(computedNext.items || []).length} item(ns)`,
    snapshot: buildSnapshotFromProposal(computedNext),
  };

  return {
    ...computedNext,
    version: nextVer,
    versionHistory: [...existingHistory, newEntry],
    updatedAt: nowIso,
  };
}
